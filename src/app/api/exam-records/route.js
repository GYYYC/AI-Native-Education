import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const { analyzeStudentLearning, explainWrongQuestion } = require('../../../lib/ai-service');
const { detectStudentAnomaly, detectClassAnomaly, detectRepeatedWrongQuestions } = require('../../../lib/alert-service');
const { autoIngestExamData } = require('../../../lib/rag-service');

// POST - 录入考试成绩和错题
export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const { studentId, examId, score, wrongQuestions = [] } = body;

    if (!studentId || !examId || score === undefined) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const parsedStudentId = parseInt(studentId, 10);
    const parsedExamId = parseInt(examId, 10);

    // 验证该学生属于此教师的某个班级
    const student = db.prepare(`
      SELECT s.*
      FROM students s
      JOIN teachers t ON s.teacher_id = t.id
      WHERE s.id = ? AND t.user_id = ?
    `).get(parsedStudentId, user.id);
    if (!student) return NextResponse.json({ error: '学生不存在或无权操作' }, { status: 403 });

    // 插入或更新成绩记录
    const existing = db.prepare('SELECT id FROM exam_records WHERE student_id = ? AND exam_id = ?').get(parsedStudentId, parsedExamId);
    let recordId;

    if (existing) {
      db.prepare('UPDATE exam_records SET score = ? WHERE id = ?').run(score, existing.id);
      recordId = existing.id;
      db.prepare('DELETE FROM wrong_questions WHERE exam_record_id = ?').run(recordId);
    } else {
      const result = db.prepare('INSERT INTO exam_records (student_id, exam_id, score) VALUES (?, ?, ?)')
        .run(parsedStudentId, parsedExamId, score);
      recordId = result.lastInsertRowid;
    }

    // 插入错题
    const insertWQ = db.prepare(`
      INSERT INTO wrong_questions (exam_record_id, question_number, question_content, student_answer, correct_answer, knowledge_point)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const wq of wrongQuestions) {
      insertWQ.run(recordId, wq.question_number || null, wq.question_content || '', wq.student_answer || '', wq.correct_answer || '', wq.knowledge_point || '');
    }

    // 异步触发 AI 分析和异常检测（不阻塞响应）
    setImmediate(async () => {
      try {
        // AI 分析学生
        const examRecords = db.prepare(`
          SELECT er.*, e.name as exam_name, e.subject, e.exam_date, e.total_score
          FROM exam_records er JOIN exams e ON er.exam_id = e.id
          WHERE er.student_id = ? ORDER BY e.exam_date ASC
        `).all(parsedStudentId);
        
        const allWQ = db.prepare(`
          SELECT wq.* FROM wrong_questions wq
          JOIN exam_records er ON wq.exam_record_id = er.id
          WHERE er.student_id = ?
        `).all(parsedStudentId);

        const analysis = await analyzeStudentLearning(student, examRecords, allWQ);
        db.prepare('UPDATE exam_records SET ai_analysis = ? WHERE id = ?').run(analysis, recordId);

        // 自动将考试数据写入 RAG 知识库
        const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(parsedExamId);
        if (exam) {
          const latestWQ = db.prepare('SELECT * FROM wrong_questions WHERE exam_record_id = ?').all(recordId);
          await autoIngestExamData(student, {
            exam_id: examId,
            exam_name: exam.name,
            subject: exam.subject,
            exam_date: exam.exam_date,
            score: score,
            total_score: exam.total_score,
          }, latestWQ, analysis);
        }

        // 异常检测
        await detectStudentAnomaly(parsedStudentId, recordId);
        await detectClassAnomaly(student.teacher_id);
        // 错题重复出错检测
        await detectRepeatedWrongQuestions(parsedStudentId, recordId);
      } catch (err) {
        console.error('AI 分析/异常检测失败:', err.message);
      }
    });

    return NextResponse.json({ success: true, recordId }, { status: 201 });
  } catch (err) {
    console.error('录入成绩错误:', err);
    return NextResponse.json({ error: '录入失败: ' + err.message }, { status: 500 });
  }
}

// GET - 获取成绩记录
export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId') ? parseInt(searchParams.get('studentId'), 10) : null;
  const examId = searchParams.get('examId') ? parseInt(searchParams.get('examId'), 10) : null;

  if (studentId) {
    const records = db.prepare(`
      SELECT er.*, e.name as exam_name, e.subject, e.exam_date, e.total_score
      FROM exam_records er JOIN exams e ON er.exam_id = e.id
      WHERE er.student_id = ?
      ORDER BY e.exam_date ASC
    `).all(studentId);
    return NextResponse.json({ records });
  }

  if (examId) {
    const records = db.prepare(`
      SELECT er.*, s.name as student_name, s.student_code
      FROM exam_records er JOIN students s ON er.student_id = s.id
      WHERE er.exam_id = ?
      ORDER BY er.score DESC
    `).all(examId);
    return NextResponse.json({ records });
  }

  return NextResponse.json({ error: '请指定 studentId 或 examId' }, { status: 400 });
}

import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const { analyzeStudentLearning } = require('../../../lib/ai-service');

// POST - 触发/重新生成 AI 分析
export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { studentId } = await request.json();
  if (!studentId) return NextResponse.json({ error: '缺少 studentId' }, { status: 400 });

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return NextResponse.json({ error: '学生不存在' }, { status: 404 });

  const examRecords = db.prepare(`
    SELECT er.*, e.name as exam_name, e.subject, e.exam_date, e.total_score
    FROM exam_records er JOIN exams e ON er.exam_id = e.id
    WHERE er.student_id = ? ORDER BY e.exam_date ASC
  `).all(studentId);

  const wrongQuestions = db.prepare(`
    SELECT wq.* FROM wrong_questions wq
    JOIN exam_records er ON wq.exam_record_id = er.id
    WHERE er.student_id = ?
  `).all(studentId);

  try {
    const analysis = await analyzeStudentLearning(student, examRecords, wrongQuestions);
    
    // 更新最新的考试记录
    const lastRecord = db.prepare('SELECT id FROM exam_records WHERE student_id = ? ORDER BY created_at DESC LIMIT 1').get(studentId);
    if (lastRecord) {
      db.prepare('UPDATE exam_records SET ai_analysis = ? WHERE id = ?').run(analysis, lastRecord.id);
    }

    return NextResponse.json({ success: true, analysis });
  } catch (err) {
    return NextResponse.json({ error: 'AI 分析失败: ' + err.message }, { status: 500 });
  }
}

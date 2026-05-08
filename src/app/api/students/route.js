import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');

// 生成学生ID: STU + 年份 + 6位随机数
function generateStudentCode() {
  const year = new Date().getFullYear().toString().slice(-2);
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `STU${year}${rand}`;
}

function normalizeStudentCode(code) {
  return String(code || '').trim().toUpperCase();
}

function generateUniqueInternalCode() {
  let code = '';
  do {
    code = generateStudentCode();
  } while (db.prepare('SELECT id FROM students WHERE student_code = ?').get(code));
  return code;
}

// GET - 获取学生列表
export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get('teacherId');
  const search = searchParams.get('search') || '';

  let query, params;
  if (user.role === 'boss') {
    query = `
      SELECT s.*, COALESCE(s.global_student_id, s.student_code) as display_student_id,
             u.id as user_id, u.name as teacher_name, t.subject, t.class_name as teacher_class
      FROM students s
      JOIN teachers t ON s.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      ${search ? "WHERE s.name LIKE ? OR s.student_code LIKE ?" : ""}
      ORDER BY s.created_at DESC
    `;
    params = search ? [`%${search}%`, `%${search}%`] : [];
  } else {
    query = `
      SELECT s.*, COALESCE(s.global_student_id, s.student_code) as display_student_id,
             u.id as user_id, u.name as teacher_name, t.subject, t.class_name as teacher_class
      FROM students s
      JOIN teachers t ON s.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE u.id = ?
      ${search ? "AND (s.name LIKE ? OR s.student_code LIKE ?)" : ""}
      ORDER BY s.created_at DESC
    `;
    params = search ? [user.id, `%${search}%`, `%${search}%`] : [user.id];
  }

  const students = db.prepare(query).all(...params);
  
  // 附加最近成绩
  const withScores = students.map(s => {
    const lastExam = db.prepare(`
      SELECT er.score, e.total_score, e.name as exam_name, e.exam_date
      FROM exam_records er
      JOIN exams e ON er.exam_id = e.id
      WHERE er.student_id = ?
      ORDER BY e.exam_date DESC LIMIT 1
    `).get(s.id);
    return { ...s, lastExam };
  });

  return NextResponse.json({ students: withScores });
}

// POST - 创建学生
export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, student_code, grade, class_name, teacher_id, birth_date, parent_name, parent_phone, notes } = body;
    
    if (!name) return NextResponse.json({ error: '学生姓名不能为空' }, { status: 400 });
    // 兼容旧 token 与多班级场景：支持 user.id / user.teacherIds 两种授权来源
    const tokenTeacherIds = Array.isArray(user.teacherIds)
      ? user.teacherIds.map(v => parseInt(v, 10)).filter(v => !Number.isNaN(v))
      : [];

    let parsedTeacherId = teacher_id ? parseInt(teacher_id, 10) : NaN;
    if (Number.isNaN(parsedTeacherId)) {
      if (tokenTeacherIds.length === 1) {
        parsedTeacherId = tokenTeacherIds[0];
      } else {
        return NextResponse.json({ error: '必须选择归属班级' }, { status: 400 });
      }
    }

    let isOwner = null;
    if (user.id !== undefined && user.id !== null) {
      isOwner = db.prepare('SELECT id FROM teachers WHERE id = ? AND user_id = ?').get(parsedTeacherId, user.id);
    }
    if (!isOwner && tokenTeacherIds.length > 0) {
      isOwner = tokenTeacherIds.includes(parsedTeacherId) ? { id: parsedTeacherId } : null;
    }
    if (!isOwner) return NextResponse.json({ error: '无权操作该班级，请重新登录后重试' }, { status: 403 });

    const globalStudentId = normalizeStudentCode(student_code) || null;
    const studentCode = generateUniqueInternalCode();

    // 同一班级下不允许重复绑定同一 global_student_id（避免重复录入）
    if (globalStudentId) {
      const duplicatedInSameClass = db.prepare(`
        SELECT id FROM students
        WHERE teacher_id = ? AND global_student_id = ?
      `).get(parsedTeacherId, globalStudentId);
      if (duplicatedInSameClass) {
        return NextResponse.json({ error: `该班级已存在学生ID：${globalStudentId}` }, { status: 409 });
      }
    }
    
    const result = db.prepare(`
      INSERT INTO students (student_code, global_student_id, teacher_id, name, grade, class_name, birth_date, parent_name, parent_phone, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(studentCode, globalStudentId, parsedTeacherId, name, grade || '', class_name || '', birth_date || '', parent_name || '', parent_phone || '', notes || '');

    const student = db.prepare('SELECT *, COALESCE(global_student_id, student_code) as display_student_id FROM students WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json({ success: true, student }, { status: 201 });
  } catch (err) {
    console.error('创建学生错误:', err);
    return NextResponse.json({ error: '创建学生失败' }, { status: 500 });
  }
}

// DELETE - 批量删除学生
export async function DELETE(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
    const parsedIds = [...new Set(
      studentIds
        .map(v => parseInt(v, 10))
        .filter(v => !Number.isNaN(v))
    )];
    if (parsedIds.length === 0) {
      return NextResponse.json({ error: 'studentIds 不能为空' }, { status: 400 });
    }

    const placeholders = parsedIds.map(() => '?').join(',');
    let accessibleIds = [];
    if (user.role === 'boss') {
      accessibleIds = db.prepare(`
        SELECT id
        FROM students
        WHERE id IN (${placeholders})
      `).all(...parsedIds).map(r => r.id);
    } else {
      accessibleIds = db.prepare(`
        SELECT s.id
        FROM students s
        JOIN teachers t ON s.teacher_id = t.id
        WHERE t.user_id = ? AND s.id IN (${placeholders})
      `).all(user.id, ...parsedIds).map(r => r.id);
    }

    if (accessibleIds.length === 0) {
      return NextResponse.json({ error: '没有可删除的学生或无权限' }, { status: 403 });
    }

    const delPlaceholders = accessibleIds.map(() => '?').join(',');
    const delResult = db.prepare(`
      DELETE FROM students
      WHERE id IN (${delPlaceholders})
    `).run(...accessibleIds);

    const deletedSet = new Set(accessibleIds.map(Number));
    const skippedIds = parsedIds.filter(id => !deletedSet.has(Number(id)));
    return NextResponse.json({
      success: true,
      requestedCount: parsedIds.length,
      deletedCount: delResult.changes || 0,
      skippedIds,
    });
  } catch (err) {
    console.error('批量删除学生错误:', err);
    return NextResponse.json({ error: '批量删除失败: ' + err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');

// GET - 获取考试列表
export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  let exams;
  if (user.role === 'boss') {
    exams = db.prepare(`
      SELECT e.*, u.name as teacher_name, t.subject, t.class_name as teacher_class
      FROM exams e 
      JOIN teachers t ON e.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      ORDER BY e.exam_date DESC
    `).all();
  } else {
    // Teacher sees all exams for all their classes
    exams = db.prepare(`
      SELECT e.*, u.name as teacher_name, t.subject, t.class_name as teacher_class
      FROM exams e 
      JOIN teachers t ON e.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE u.id = ?
      ORDER BY e.exam_date DESC
    `).all(user.id);
  }

  return NextResponse.json({ exams });
}

// POST - 创建考试
export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, subject, exam_date, total_score, teacher_id } = body;
    
    if (!name || !subject || !exam_date || !teacher_id) {
      return NextResponse.json({ error: '请填写全部必填信息(含考试归属班级)' }, { status: 400 });
    }

    const parsedTeacherId = parseInt(teacher_id, 10);
    // Verify ownership
    const isOwner = db.prepare('SELECT id FROM teachers WHERE id = ? AND user_id = ?').get(parsedTeacherId, user.id);
    if (!isOwner) return NextResponse.json({ error: '无权操作该班级' }, { status: 403 });

    const result = db.prepare(`
      INSERT INTO exams (teacher_id, name, subject, exam_date, total_score)
      VALUES (?, ?, ?, ?, ?)
    `).run(parsedTeacherId, name, subject, exam_date, total_score || 100);

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json({ success: true, exam }, { status: 201 });
  } catch (error) {
    console.error('Error creating exam:', error);
    return NextResponse.json({ error: '请求处理失败' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');

export async function GET(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const classes = db.prepare(`
      SELECT t.id, t.subject, t.class_name, t.feishu_webhook,
             COUNT(s.id) as student_count
      FROM teachers t
      LEFT JOIN students s ON s.teacher_id = t.id
      WHERE t.user_id = ?
      GROUP BY t.id
      ORDER BY t.id ASC
    `).all(user.id);

    return NextResponse.json({ success: true, classes });
  } catch (err) {
    console.error('获取班级列表失败:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { subject, className, webhookUrl } = await request.json();

    if (!subject || !className) {
      return NextResponse.json({ error: '科目和班级名称必填' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO teachers (user_id, subject, class_name, feishu_webhook)
      VALUES (?, ?, ?, ?)
    `).run(user.id, subject.trim(), className.trim(), webhookUrl?.trim() || null);

    return NextResponse.json({ success: true, classId: result.lastInsertRowid });
  } catch (err) {
    console.error('新建班级失败:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

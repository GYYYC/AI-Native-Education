import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');

// GET - 获取告警列表
export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === '1';
  const limit = parseInt(searchParams.get('limit') || '50');

  let alerts;
  if (user.role === 'boss') {
    // 老板看所有告警
    alerts = db.prepare(`
      SELECT * FROM alerts
      ${unreadOnly ? 'WHERE is_read = 0' : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  } else {
    // 教师只看自己所有班级学生的告警（student_abnormal 类型）
    const studentIds = db.prepare(`
      SELECT s.id 
      FROM students s
      JOIN teachers t ON s.teacher_id = t.id
      WHERE t.user_id = ?
    `).all(user.id).map(s => s.id);
    
    if (studentIds.length === 0) return NextResponse.json({ alerts: [] });
    
    const placeholders = studentIds.map(() => '?').join(',');
    alerts = db.prepare(`
      SELECT * FROM alerts
      WHERE type = 'student_abnormal' AND target_id IN (${placeholders})
      ${unreadOnly ? 'AND is_read = 0' : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...studentIds, limit);
  }

  return NextResponse.json({ alerts });
}

// PUT - 标记告警已读
export async function PUT(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { id, all } = await request.json();
  if (all) {
    db.prepare('UPDATE alerts SET is_read = 1').run();
  } else if (id) {
    db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(id);
  }
  return NextResponse.json({ success: true });
}

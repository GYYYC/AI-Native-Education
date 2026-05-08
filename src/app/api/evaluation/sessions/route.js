import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');

export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = parseInt(searchParams.get('studentId') || '', 10);
  if (Number.isNaN(studentId)) return NextResponse.json({ error: 'studentId 必填' }, { status: 400 });

  const hasStudent = db.prepare(`
    SELECT s.id
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(studentId, user.id, user.role);
  if (!hasStudent) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

  const sessions = db.prepare(`
    SELECT es.*, et.name as template_name, et.template_type, u.name as evaluator_name
    FROM evaluation_sessions es
    JOIN evaluation_templates et ON es.template_id = et.id
    JOIN users u ON es.evaluator_id = u.id
    WHERE es.student_id = ?
    ORDER BY es.created_at DESC
  `).all(studentId);

  return NextResponse.json({ sessions });
}


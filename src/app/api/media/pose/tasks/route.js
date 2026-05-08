import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const studentId = parseInt(searchParams.get('studentId') || '', 10);
    const limit = Math.max(1, Math.min(20, parseInt(searchParams.get('limit') || '5', 10) || 5));

    if (Number.isNaN(studentId)) {
      return NextResponse.json({ error: 'studentId 无效' }, { status: 400 });
    }

    const rows = db.prepare(`
      SELECT pat.id, pat.student_id, pat.status, pat.error_message, pat.created_at, pat.updated_at
      FROM pose_analysis_tasks pat
      JOIN students s ON pat.student_id = s.id
      JOIN teachers t ON s.teacher_id = t.id
      WHERE pat.student_id = ? AND (t.user_id = ? OR ? = 'boss')
      ORDER BY pat.id DESC
      LIMIT ?
    `).all(studentId, user.id, user.role, limit);

    return NextResponse.json({
      tasks: rows.map(r => ({
        id: r.id,
        studentId: r.student_id,
        status: r.status,
        errorMessage: r.error_message || '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: '查询姿态任务失败: ' + err.message }, { status: 500 });
  }
}


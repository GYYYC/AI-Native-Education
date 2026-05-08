import { NextResponse } from 'next/server';
const db = require('../../../../../../lib/db');
const { requireAuth } = require('../../../../../../lib/auth');

function getTaskWithPermission(taskId, user) {
  return db.prepare(`
    SELECT pat.*, s.name as student_name, t.user_id
    FROM pose_analysis_tasks pat
    JOIN students s ON pat.student_id = s.id
    JOIN teachers t ON s.teacher_id = t.id
    WHERE pat.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(taskId, user.id, user.role);
}

function getTaskById(taskId) {
  return db.prepare(`
    SELECT id, student_id, status, result_json
    FROM pose_analysis_tasks
    WHERE id = ?
  `).get(taskId);
}

export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const taskId = parseInt(params.id, 10);
  if (Number.isNaN(taskId)) return NextResponse.json({ error: 'taskId 无效' }, { status: 400 });

  const task = getTaskWithPermission(taskId, user);
  if (!task) return NextResponse.json({ error: '任务不存在或无权限' }, { status: 404 });

  let source = null;
  let result = null;
  try { source = task.source_json ? JSON.parse(task.source_json) : null; } catch {}
  try { result = task.result_json ? JSON.parse(task.result_json) : null; } catch {}

  return NextResponse.json({
    task: {
      id: task.id,
      studentId: task.student_id,
      studentName: task.student_name,
      status: task.status,
      source,
      result,
      errorMessage: task.error_message || '',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    },
  });
}

export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  const callbackToken = String(request.headers.get('x-pose-callback-token') || '').trim();
  const expectedCallbackToken = String(process.env.POSE_CALLBACK_TOKEN || '').trim();
  const callbackAuthorized = !!expectedCallbackToken && callbackToken === expectedCallbackToken;
  if (!user && !callbackAuthorized) {
    return NextResponse.json({ error: '未授权（需教师JWT或有效回调令牌）' }, { status: 401 });
  }

  const taskId = parseInt(params.id, 10);
  if (Number.isNaN(taskId)) return NextResponse.json({ error: 'taskId 无效' }, { status: 400 });

  const task = user ? getTaskWithPermission(taskId, user) : getTaskById(taskId);
  if (!task) return NextResponse.json({ error: '任务不存在或无权限' }, { status: 404 });

  try {
    const body = await request.json();
    const status = String(body.status || '').trim();
    const allowed = ['pending', 'processing', 'completed', 'failed'];
    if (!allowed.includes(status)) return NextResponse.json({ error: 'status 无效' }, { status: 400 });

    const resultJson = body.result && typeof body.result === 'object' ? JSON.stringify(body.result) : task.result_json;
    const errorMessage = String(body.errorMessage || '').trim();
    db.prepare(`
      UPDATE pose_analysis_tasks
      SET status = ?, result_json = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, resultJson, errorMessage, taskId);

    return NextResponse.json({ success: true, taskId, status });
  } catch (err) {
    return NextResponse.json({ error: '更新任务失败: ' + err.message }, { status: 500 });
  }
}


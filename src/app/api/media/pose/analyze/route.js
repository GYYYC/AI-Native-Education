import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

function getStudentWithPermission(studentId, user) {
  return db.prepare(`
    SELECT s.id, s.name, t.user_id
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(studentId, user.id, user.role);
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const studentId = parseInt(body.studentId, 10);
    if (Number.isNaN(studentId)) return NextResponse.json({ error: 'studentId 无效' }, { status: 400 });

    const student = getStudentWithPermission(studentId, user);
    if (!student) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

    const inputMetrics = body.poseMetrics && typeof body.poseMetrics === 'object' ? body.poseMetrics : null;
    const source = {
      exerciseType: String(body.exerciseType || '').trim(),
      videoUrl: String(body.videoUrl || '').trim(),
      videoName: String(body.videoName || '').trim(),
      durationSec: Number(body.durationSec || 0),
      frameRate: Number(body.frameRate || 0),
      note: String(body.note || '').trim(),
    };
    const poseMetrics = inputMetrics || null;
    const status = poseMetrics ? 'completed' : 'pending';

    const result = db.prepare(`
      INSERT INTO pose_analysis_tasks (student_id, created_by, status, source_json, result_json, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      studentId,
      user.id,
      status,
      JSON.stringify(source),
      poseMetrics ? JSON.stringify(poseMetrics) : null,
    );
    const taskId = result.lastInsertRowid;

    return NextResponse.json({
      success: true,
      taskId,
      status,
      callbackPath: `/api/media/pose/tasks/${taskId}`,
      callbackAuthHeader: 'x-pose-callback-token',
      message: poseMetrics
        ? '已写入姿态分析结果，可用于评定证据入库'
        : '已创建姿态分析任务（待外部MediaPipe处理后回填）',
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: '创建姿态任务失败: ' + err.message }, { status: 500 });
  }
}


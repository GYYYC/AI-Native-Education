import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');
const { runAssessment } = require('../../../../lib/assessment-service');

// POST /api/boss/assessment — 上传文件并触发评估
export async function POST(request) {
  const user = requireAuth(request, ['boss', 'teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { studentId, courseId, hexagonType, uploadType, imageBase64, mimeType, generatedDocId } = await request.json();

  if (!studentId || !hexagonType || !uploadType || !imageBase64) {
    return NextResponse.json({ error: '缺少必填字段（studentId, hexagonType, uploadType, imageBase64）' }, { status: 400 });
  }

  // 验证学生存在
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(studentId);
  if (!student) return NextResponse.json({ error: '学生不存在' }, { status: 404 });

  try {
    const result = await runAssessment({
      studentId,
      courseId: courseId || null,
      hexagonType,
      uploadType,
      imageBase64,
      mimeType: mimeType || 'image/jpeg',
      generatedDocId: generatedDocId || null,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      uploadId: result.uploadId,
      totalScore: result.totalScore,
      scores: result.scores,
      aiSuggestion: result.aiSuggestion,
      personalizedSuggestion: result.personalizedSuggestion,
      status: result.status,
    });
  } catch (err) {
    console.error('评估失败:', err);
    return NextResponse.json({ error: '评估失败: ' + err.message }, { status: 500 });
  }
}

// GET /api/boss/assessment — 获取评估记录列表
export async function GET(request) {
  const user = requireAuth(request, ['boss', 'teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId') || '';
  const hexagonType = searchParams.get('hexagonType') || '';
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  let sql = `
    SELECT au.*, s.name as student_name, s.grade, s.class_name, c.name as course_name
    FROM assessment_uploads au
    JOIN students s ON au.student_id = s.id
    LEFT JOIN courses c ON au.course_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (studentId) { sql += ' AND au.student_id = ?'; params.push(parseInt(studentId)); }
  if (hexagonType) { sql += ' AND au.hexagon_type = ?'; params.push(hexagonType); }
  sql += ' ORDER BY au.id DESC LIMIT ?';
  params.push(limit);

  const uploads = db.prepare(sql).all(...params);

  // 附加六边形评分
  for (const u of uploads) {
    u.hexScores = db.prepare('SELECT dim_key, dim_name, score, rationale FROM assessment_hex_scores WHERE upload_id = ? ORDER BY id ASC').all(u.id);
  }

  return NextResponse.json({ uploads });
}

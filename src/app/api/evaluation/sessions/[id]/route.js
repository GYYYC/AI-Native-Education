import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const sessionId = parseInt(params.id, 10);
  if (Number.isNaN(sessionId)) return NextResponse.json({ error: 'sessionId 无效' }, { status: 400 });

  const session = db.prepare(`
    SELECT es.*, et.name as template_name, et.template_type, s.name as student_name, t.user_id
    FROM evaluation_sessions es
    JOIN evaluation_templates et ON es.template_id = et.id
    JOIN students s ON es.student_id = s.id
    JOIN teachers t ON s.teacher_id = t.id
    WHERE es.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(sessionId, user.id, user.role);
  if (!session) return NextResponse.json({ error: '评定记录不存在或无权限' }, { status: 404 });

  const scores = db.prepare(`
    SELECT eds.*, d.dim_key, d.dim_name, d.weight
    FROM evaluation_dimension_scores eds
    JOIN evaluation_dimensions d ON eds.dimension_id = d.id
    WHERE eds.session_id = ?
    ORDER BY d.sort_order ASC, d.id ASC
  `).all(sessionId);

  const evidence = db.prepare(`
    SELECT ee.*, d.dim_key, d.dim_name
    FROM evaluation_evidence ee
    LEFT JOIN evaluation_dimensions d ON ee.dimension_id = d.id
    WHERE ee.session_id = ?
    ORDER BY ee.id ASC
  `).all(sessionId);

  const feedback = db.prepare(`
    SELECT ef.*, u.name as reviewer_name
    FROM evaluation_feedback ef
    JOIN users u ON ef.reviewer_id = u.id
    WHERE ef.session_id = ?
    ORDER BY ef.created_at DESC
  `).all(sessionId);

  let retrievalSnapshot = [];
  try {
    retrievalSnapshot = session.retrieval_snapshot_json ? JSON.parse(session.retrieval_snapshot_json) : [];
  } catch {
    retrievalSnapshot = [];
  }

  return NextResponse.json({ session, scores, evidence, feedback, retrievalSnapshot });
}


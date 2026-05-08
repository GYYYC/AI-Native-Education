import { NextResponse } from 'next/server';
const db = require('../../../../../../lib/db');
const { requireAuth } = require('../../../../../../lib/auth');
const { autoIngestEvaluationCase } = require('../../../../../../lib/rag-service');

export async function POST(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const sessionId = parseInt(params.id, 10);
  if (Number.isNaN(sessionId)) return NextResponse.json({ error: 'sessionId 无效' }, { status: 400 });

  const session = db.prepare(`
    SELECT es.*, t.user_id
    FROM evaluation_sessions es
    JOIN students s ON es.student_id = s.id
    JOIN teachers t ON s.teacher_id = t.id
    WHERE es.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(sessionId, user.id, user.role);
  if (!session) return NextResponse.json({ error: '评定记录不存在或无权限' }, { status: 404 });
  if (session.status === 'final') return NextResponse.json({ error: '最终评定不可再次审核' }, { status: 400 });

  try {
    const { action, comment = '', revisedScores = [] } = await request.json();
    if (!['approve', 'edit', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action 无效' }, { status: 400 });
    }

    db.exec('BEGIN');
    if (action === 'edit') {
      const rows = Array.isArray(revisedScores) ? revisedScores : [];
      for (const item of rows) {
        const dimId = parseInt(item.dimensionId, 10);
        if (Number.isNaN(dimId)) continue;
        const score = Number(item.score);
        if (Number.isNaN(score)) continue;
        const grade = item.grade || (score >= 4.5 ? 'A' : score >= 3.5 ? 'B' : score >= 2.5 ? 'C' : 'D');
        db.prepare(`
          UPDATE evaluation_dimension_scores
          SET score = ?, grade = ?, confidence = COALESCE(?, confidence), rationale = COALESCE(?, rationale)
          WHERE session_id = ? AND dimension_id = ?
        `).run(score, grade, item.confidence ?? null, item.rationale ?? null, sessionId, dimId);
      }
    }

    const nextStatus = action === 'reject' ? 'draft' : 'reviewed';
    db.prepare('UPDATE evaluation_sessions SET status = ? WHERE id = ?').run(nextStatus, sessionId);
    db.prepare(`
      INSERT INTO evaluation_feedback (session_id, reviewer_id, action, comment, revised_payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, user.id, action, comment, JSON.stringify({ revisedScores }));

    // [New] AI Learning: Sync the manual correction to RAG
    if (action === 'edit' && revisedScores.length > 0) {
        setImmediate(() => {
            for (const item of revisedScores) {
              const dim = db.prepare('SELECT dim_key, dim_name FROM evaluation_dimensions WHERE id = ?').get(item.dimensionId);
              autoIngestEvaluationCase({
                sessionId,
                studentId: session.student_id,
                templateType: session.template_type,
                dimensionKey: dim?.dim_key || 'unknown',
                evidenceDetailType: 'manual_calibration',
                source: 'teacher_review',
                note: `老师手动调分：${comment || '调整了评分合理性'}`,
                metrics: {
                    revised_score: Number(item.score),
                    original_rationale: item.rationale || '',
                    reviewer_id: user.id
                },
                userId: user.id,
              });
            }
        });
    }

    db.exec('COMMIT');

    return NextResponse.json({ success: true, status: nextStatus });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('评定审核失败:', err);
    return NextResponse.json({ error: '评定审核失败: ' + err.message }, { status: 500 });
  }
}


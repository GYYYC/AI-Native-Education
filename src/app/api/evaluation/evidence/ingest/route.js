import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');
const { autoIngestEvaluationCase } = require('../../../../../lib/rag-service');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toFiveScale(raw) {
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  if (n <= 1) return clamp(n * 5, 1, 5);
  if (n <= 5) return clamp(n, 1, 5);
  if (n <= 100) return clamp(n / 20, 1, 5);
  return 5;
}

function scoreToGrade(score) {
  if (score >= 4.5) return 'A';
  if (score >= 3.5) return 'B';
  if (score >= 2.5) return 'C';
  return 'D';
}

function derivePoseScores(metrics = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (metrics[k] !== undefined && metrics[k] !== null) return toFiveScale(metrics[k]);
    }
    return null;
  };
  const overall = pick('score_overall', 'overall', 'total_score');
  return {
    flexibility: pick('flexibility', 'range_of_motion', 'rom') ?? overall,
    coordination: pick('coordination', 'rhythm', 'timing', 'balance') ?? overall,
    core_strength: pick('core_strength', 'core_control', 'stability') ?? overall,
    endurance: pick('endurance', 'stamina', 'holding_time') ?? overall,
    explosive_power: pick('explosive_power', 'power', 'jump_power') ?? overall,
    movement_quality: pick('movement_quality', 'posture', 'form', 'accuracy') ?? overall,
  };
}

function getSessionWithPermission(sessionId, user) {
  return db.prepare(`
    SELECT es.id, es.status, es.student_id, et.template_type, t.user_id
    FROM evaluation_sessions es
    JOIN evaluation_templates et ON es.template_id = et.id
    JOIN students s ON es.student_id = s.id
    JOIN teachers t ON s.teacher_id = t.id
    WHERE es.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(sessionId, user.id, user.role);
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const sessionId = parseInt(body.sessionId, 10);
    if (Number.isNaN(sessionId)) return NextResponse.json({ error: 'sessionId 无效' }, { status: 400 });

    const session = getSessionWithPermission(sessionId, user);
    if (!session) return NextResponse.json({ error: '评定会话不存在或无权限' }, { status: 404 });
    if (session.status === 'final') return NextResponse.json({ error: 'final 会话不可再写入证据' }, { status: 400 });

    const dimensionKey = String(body.dimensionKey || '').trim();
    let dimensionId = null;
    if (dimensionKey) {
      const dim = db.prepare(`
        SELECT d.id
        FROM evaluation_dimension_scores eds
        JOIN evaluation_dimensions d ON eds.dimension_id = d.id
        WHERE eds.session_id = ? AND d.dim_key = ?
        LIMIT 1
      `).get(sessionId, dimensionKey);
      dimensionId = dim?.id || null;
    }

    const evidenceDetailType = String(body.evidenceDetailType || 'pose_metric').trim();
    const poseTaskId = Number(body.poseTaskId || 0);
    let metrics = body.poseMetrics && typeof body.poseMetrics === 'object'
      ? body.poseMetrics
      : (body.metrics && typeof body.metrics === 'object' ? body.metrics : null);
    if (!metrics && poseTaskId > 0) {
      const task = db.prepare(`
        SELECT result_json
        FROM pose_analysis_tasks
        WHERE id = ? AND student_id = ?
      `).get(poseTaskId, session.student_id);
      if (task?.result_json) {
        try { metrics = JSON.parse(task.result_json); } catch {}
      }
    }
    if (!metrics) return NextResponse.json({ error: 'metrics 缺失，且任务结果不可用' }, { status: 400 });
    const allowedDetailTypes = ['pose_metric', 'calligraphy_metric', 'artwork_metric', 'objective_exam_metric'];
    if (!allowedDetailTypes.includes(evidenceDetailType)) {
      return NextResponse.json({ error: 'evidenceDetailType 无效' }, { status: 400 });
    }

    const payload = {
      evidence_detail_type: evidenceDetailType,
      source: String(body.source || (evidenceDetailType === 'pose_metric' ? 'mediapipe' : 'artwork_analyzer')),
      template_type: session.template_type,
      metrics,
      artType: String(body.artType || '').trim(),
      note: String(body.note || '').trim(),
      ingested_by: user.id,
      ingested_at: new Date().toISOString(),
    };
    db.prepare(`
      INSERT INTO evaluation_evidence (session_id, dimension_id, evidence_type, content, source_ref, cited_standard_clause)
      VALUES (?, ?, 'performance', ?, ?, ?)
    `).run(
      sessionId,
      dimensionId,
      JSON.stringify(payload),
      String(body.sourceRef || (poseTaskId > 0 ? `pose_task:${poseTaskId}` : 'manual_metric')),
      String(body.citedStandardClause || '').slice(0, 255),
    );

    setImmediate(() => {
      autoIngestEvaluationCase({
        sessionId,
        studentId: session.student_id,
        templateType: session.template_type,
        dimensionKey,
        evidenceDetailType,
        source: payload.source,
        sourceRef: String(body.sourceRef || (poseTaskId > 0 ? `pose_task:${poseTaskId}` : 'manual_metric')),
        note: payload.note,
        metrics,
        userId: user.id,
      });
    });

    if (evidenceDetailType === 'pose_metric' && session.template_type === 'fitness') {
      const byDim = derivePoseScores(metrics || {});
      const dimRows = db.prepare(`
        SELECT eds.id, eds.score as current_score, d.dim_key
        FROM evaluation_dimension_scores eds
        JOIN evaluation_dimensions d ON eds.dimension_id = d.id
        WHERE eds.session_id = ?
      `).all(sessionId);
      const updater = db.prepare(`
        UPDATE evaluation_dimension_scores
        SET score = ?, grade = ?, confidence = ?, rationale = ?
        WHERE id = ?
      `);
      for (const row of dimRows) {
        const metricScore = byDim[row.dim_key];
        if (metricScore === null || metricScore === undefined) continue;
        const base = Number(row.current_score || 1);
        const blended = Number((base * 0.35 + Number(metricScore) * 0.65).toFixed(2));
        const rationale = `基于姿态指标自动校准分数（原分:${base}，指标:${Number(metricScore).toFixed(2)}）`;
        updater.run(
          blended,
          scoreToGrade(blended),
          0.82,
          rationale,
          row.id,
        );
      }
    }

    return NextResponse.json({ success: true, sessionId, dimensionId, evidenceType: 'performance' }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: '证据入库失败: ' + err.message }, { status: 500 });
  }
}


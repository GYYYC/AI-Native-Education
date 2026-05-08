import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');

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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const sessionId = parseInt(body.sessionId, 10);
    if (Number.isNaN(sessionId)) return NextResponse.json({ error: 'sessionId 无效' }, { status: 400 });
    const subjectType = String(body.subjectType || '').trim();
    if (!['psychology', 'gratitude', 'classics', 'rule_of_law'].includes(subjectType)) {
      return NextResponse.json({ error: 'subjectType 无效' }, { status: 400 });
    }
    const session = getSessionWithPermission(sessionId, user);
    if (!session) return NextResponse.json({ error: '评定会话不存在或无权限' }, { status: 404 });
    if (session.status === 'final') return NextResponse.json({ error: 'final 会话不可再写入证据' }, { status: 400 });

    const items = Array.isArray(body.items) ? body.items : [];
    const normalized = items.map((it, idx) => ({
      index: idx + 1,
      questionNo: String(it?.questionNo || `Q${idx + 1}`).trim(),
      studentAnswer: String(it?.studentAnswer || '').trim(),
      correctAnswer: String(it?.correctAnswer || '').trim(),
    })).filter(it => it.correctAnswer !== '');
    if (!normalized.length) return NextResponse.json({ error: '至少提供一题正确答案' }, { status: 400 });

    let correct = 0;
    for (const item of normalized) {
      if (item.studentAnswer !== '' && item.studentAnswer.toLowerCase() === item.correctAnswer.toLowerCase()) {
        correct++;
      }
    }
    const total = normalized.length;
    const pct = (correct / total) * 100;
    const score1to5 = clamp(Math.round((pct / 100) * 4 + 1), 1, 5);

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

    const payload = {
      evidence_detail_type: 'objective_exam_metric',
      subjectType,
      totalQuestions: total,
      correctQuestions: correct,
      accuracyPct: Number(pct.toFixed(2)),
      mappedScore1to5: score1to5,
      items: normalized,
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
      `objective:${subjectType}`,
      String(body.citedStandardClause || '').slice(0, 255),
    );

    return NextResponse.json({
      success: true,
      metrics: {
        subjectType,
        totalQuestions: total,
        correctQuestions: correct,
        accuracyPct: Number(pct.toFixed(2)),
        mappedScore1to5: score1to5,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: '客观题判分失败: ' + err.message }, { status: 500 });
  }
}


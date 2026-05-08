import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');
const { runEvaluationAgent } = require('../../../../lib/evaluation-agent');

function getStudentWithPermission(studentId, user) {
  return db.prepare(`
    SELECT s.*, t.user_id
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(studentId, user.id, user.role);
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { studentId, templateId, triggerType = 'manual' } = await request.json();
    const parsedStudentId = parseInt(studentId, 10);
    const parsedTemplateId = parseInt(templateId, 10);

    if (Number.isNaN(parsedStudentId) || Number.isNaN(parsedTemplateId)) {
      return NextResponse.json({ error: 'studentId/templateId 无效' }, { status: 400 });
    }
    if (!['manual', 'scheduled', 'course_end'].includes(triggerType)) {
      return NextResponse.json({ error: 'triggerType 无效' }, { status: 400 });
    }

    const student = getStudentWithPermission(parsedStudentId, user);
    if (!student) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

    const template = db.prepare('SELECT * FROM evaluation_templates WHERE id = ? AND active = 1').get(parsedTemplateId);
    if (!template) return NextResponse.json({ error: '评定模板不存在或未启用' }, { status: 404 });

    const dimensions = db.prepare(`
      SELECT * FROM evaluation_dimensions
      WHERE template_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(parsedTemplateId);
    if (dimensions.length === 0) {
      return NextResponse.json({ error: '模板没有可用维度' }, { status: 400 });
    }

    const courses = db.prepare(`
      SELECT c.name, c.category, sc.status, sc.start_date, sc.end_date
      FROM student_courses sc
      JOIN courses c ON c.id = sc.course_id
      WHERE sc.student_id = ?
      ORDER BY sc.created_at DESC
    `).all(parsedStudentId);

    const priorSessions = db.prepare(`
      SELECT summary
      FROM evaluation_sessions
      WHERE student_id = ? AND status = 'final'
      ORDER BY created_at DESC
      LIMIT 5
    `).all(parsedStudentId).map(r => r.summary).filter(Boolean);

    const recentPoseMetrics = db.prepare(`
      SELECT result_json
      FROM pose_analysis_tasks
      WHERE student_id = ? AND status = 'completed' AND result_json IS NOT NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 8
    `).all(parsedStudentId).map(r => {
      try { return r.result_json ? JSON.parse(r.result_json) : null; } catch { return null; }
    }).filter(Boolean);

    const recentPerformanceEvidence = db.prepare(`
      SELECT ee.content
      FROM evaluation_evidence ee
      JOIN evaluation_sessions es ON ee.session_id = es.id
      WHERE es.student_id = ? AND ee.evidence_type = 'performance'
      ORDER BY ee.id DESC
      LIMIT 20
    `).all(parsedStudentId).map(r => String(r.content || '').slice(0, 500)).filter(Boolean);

    const agentOutput = await runEvaluationAgent({
      student,
      template,
      dimensions,
      courses,
      priorSummaries: priorSessions,
      recentPoseMetrics,
      recentPerformanceEvidence,
      requirePrivateStandards: true,
    });
    if (agentOutput.blocked) {
      return NextResponse.json({
        error: '机构私有标准不足，已阻止本次评定。请先补齐标准条款后重试。',
        missingDimensions: agentOutput.missingDimensions || [],
      }, { status: 400 });
    }

    db.exec('BEGIN');
    const sessionResult = db.prepare(`
      INSERT INTO evaluation_sessions (student_id, template_id, evaluator_id, trigger_type, status, model_name, standard_version, retrieval_snapshot_json, summary)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      parsedStudentId,
      parsedTemplateId,
      user.id,
      triggerType,
      process.env.AI_CHAT_MODEL || process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
      `org-private-v${template.version}`,
      JSON.stringify(agentOutput.retrievalSnapshot || []),
      agentOutput.summary,
    );
    const sessionId = sessionResult.lastInsertRowid;

    const insertScore = db.prepare(`
      INSERT INTO evaluation_dimension_scores (session_id, dimension_id, score, grade, confidence, rationale)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertEvidence = db.prepare(`
      INSERT INTO evaluation_evidence (session_id, dimension_id, evidence_type, content, source_ref, cited_standard_clause)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const d of agentOutput.dimensions) {
      insertScore.run(sessionId, d.dimensionId, d.score, d.grade, d.confidence, d.rationale);
      if (d.evidence_insufficient) {
        insertEvidence.run(sessionId, d.dimensionId, 'other', '证据不足，需老师补充观察记录', '', '');
      }
      for (const e of d.evidence) {
        insertEvidence.run(
          sessionId,
          d.dimensionId,
          ['course_note', 'work', 'performance', 'attendance', 'history_case', 'standard_clause', 'other'].includes(e?.type) ? e.type : 'other',
          String(e?.content || '').slice(0, 2000),
          String(e?.source_ref || '').slice(0, 255),
          String(e?.cited_standard_clause || '').slice(0, 255),
        );
      }
    }
    db.exec('COMMIT');

    return NextResponse.json({
      success: true,
      sessionId,
      status: 'draft',
      summary: agentOutput.summary,
      dimensions: agentOutput.dimensions.map(d => ({
        dim_key: d.dim_key,
        dim_name: d.dim_name,
        score: d.score,
        grade: d.grade,
        confidence: d.confidence,
      })),
      standardsCount: agentOutput.standardsCount,
      missingDimensions: [],
    }, { status: 201 });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('AI评定执行失败:', err);
    return NextResponse.json({ error: 'AI评定执行失败: ' + err.message }, { status: 500 });
  }
}


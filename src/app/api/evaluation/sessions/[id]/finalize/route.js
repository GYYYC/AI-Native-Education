import { NextResponse } from 'next/server';
const db = require('../../../../../../lib/db');
const { requireAuth } = require('../../../../../../lib/auth');
const { addDocument } = require('../../../../../../lib/rag-service');
const { sendEvaluationAbnormalAlert } = require('../../../../../../lib/feishu-service');

export async function POST(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const sessionId = parseInt(params.id, 10);
  if (Number.isNaN(sessionId)) return NextResponse.json({ error: 'sessionId 无效' }, { status: 400 });

  const session = db.prepare(`
    SELECT es.*, s.name as student_name, s.grade, s.class_name, t.user_id, t.feishu_webhook, u.name as teacher_name, et.name as template_name, et.template_type
    FROM evaluation_sessions es
    JOIN students s ON es.student_id = s.id
    JOIN teachers t ON s.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    JOIN evaluation_templates et ON es.template_id = et.id
    WHERE es.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(sessionId, user.id, user.role);
  if (!session) return NextResponse.json({ error: '评定记录不存在或无权限' }, { status: 404 });
  if (session.status === 'final') return NextResponse.json({ error: '该评定已生效' }, { status: 400 });
  if (session.status !== 'reviewed') return NextResponse.json({ error: '评定需先审核通过后才能生效' }, { status: 400 });

  try {
    const { note = '' } = await request.json().catch(() => ({}));
    const scores = db.prepare(`
      SELECT d.dim_key, d.dim_name, eds.score, eds.grade, eds.confidence, eds.rationale
      FROM evaluation_dimension_scores eds
      JOIN evaluation_dimensions d ON eds.dimension_id = d.id
      WHERE eds.session_id = ?
      ORDER BY d.sort_order ASC, d.id ASC
    `).all(sessionId);
    if (scores.length === 0) return NextResponse.json({ error: '评定明细为空，无法生效' }, { status: 400 });

    const evidence = db.prepare(`
      SELECT d.dim_name, ee.evidence_type, ee.content, ee.source_ref, ee.cited_standard_clause
      FROM evaluation_evidence ee
      LEFT JOIN evaluation_dimensions d ON ee.dimension_id = d.id
      WHERE ee.session_id = ?
      ORDER BY ee.id ASC
      LIMIT 50
    `).all(sessionId);

    db.prepare(`
      UPDATE evaluation_sessions
      SET status = 'final', finalized_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);

    const avgScore = scores.reduce((sum, s) => sum + Number(s.score || 0), 0) / scores.length;
    const docId = `auto_eval_final_${sessionId}`;
    const title = `评定归档：${session.student_name} - ${session.template_name}`;
    const content = [
      `【学生】${session.student_name}（${session.grade || '-'} / ${session.class_name || '-'}）`,
      `【模板】${session.template_name}（${session.template_type}）`,
      `【会话】#${sessionId}，状态：final`,
      `【总评】${session.summary || '无'}`,
      `【平均分】${avgScore.toFixed(2)}`,
      '',
      '【维度评分】',
      ...scores.map(s => `- ${s.dim_name}：${s.score}分（${s.grade || '-'}，置信度${(Number(s.confidence || 0) * 100).toFixed(0)}%）\n  说明：${s.rationale || '-'}`),
      '',
      '【证据引用】',
      ...(evidence.length
        ? evidence.map(e => `- [${e.dim_name || '通用'}] ${e.evidence_type}: ${e.content}（来源:${e.source_ref || '-'}；条款:${e.cited_standard_clause || '-'}）`)
        : ['- 无']),
      '',
      `【审核备注】${note || '无'}`,
    ].join('\n');

    await addDocument(title, content, docId, {
      docType: 'evaluation_result',
      metadata: { template_type: session.template_type, session_id: sessionId, status: 'final' },
    });
    db.prepare(`
      INSERT INTO rag_documents (title, content, doc_type, metadata_json, uploaded_by)
      VALUES (?, ?, 'evaluation_result', ?, ?)
    `).run(title, content, JSON.stringify({ sessionId, templateId: session.template_id, status: 'final' }), user.id);

    // 综合评定异常检测并推送飞书
    const lowDimensions = scores.filter(s => Number(s.score) < 2.5);
    const insufficientCount = evidence.filter(e => e.evidence_type === 'other' && String(e.content || '').includes('证据不足')).length;
    const isAbnormal = avgScore < 3 || lowDimensions.length >= 2 || insufficientCount >= 2;
    if (isAbnormal) {
      const existingRecentAlert = db.prepare(`
        SELECT id FROM alerts
        WHERE type = 'student_abnormal' AND target_id = ? AND created_at > datetime('now', '-12 hours')
      `).get(session.student_id);

      if (!existingRecentAlert) {
        const detail = `模板【${session.template_name}】评定发现风险：平均分 ${avgScore.toFixed(2)}，低分维度 ${lowDimensions.length} 个，证据不足 ${insufficientCount} 条。`;
        const alertResult = db.prepare(`
          INSERT INTO alerts (type, target_id, target_name, message, detail, sent_feishu, is_read)
          VALUES ('student_abnormal', ?, ?, ?, ?, 0, 0)
        `).run(
          session.student_id,
          session.student_name,
          `学生 ${session.student_name} 综合评定异常`,
          detail,
        );

        const sent = await sendEvaluationAbnormalAlert({
          webhookUrls: [session.feishu_webhook],
          studentName: session.student_name,
          teacherName: session.teacher_name,
          className: session.class_name || '',
          templateName: session.template_name,
          avgScore,
          lowDimensions,
          detail,
        });
        if (sent) {
          db.prepare('UPDATE alerts SET sent_feishu = 1 WHERE id = ?').run(alertResult.lastInsertRowid);
        }
      }
    }

    return NextResponse.json({ success: true, status: 'final' });
  } catch (err) {
    console.error('评定生效失败:', err);
    return NextResponse.json({ error: '评定生效失败: ' + err.message }, { status: 500 });
  }
}


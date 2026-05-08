const { callDeepSeek } = require('./ai-service');
const { retrieveRelevantChunks } = require('./rag-service');

function sanitizeScore(raw, min = 1, max = 5) {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toGrade(score) {
  if (score >= 4.5) return 'A';
  if (score >= 3.5) return 'B';
  if (score >= 2.5) return 'C';
  return 'D';
}

function normalizeToFiveScale(raw) {
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  if (n <= 0) return 0;
  if (n <= 1) return n * 5;
  if (n <= 5) return n;
  if (n <= 100) return n / 20;
  return 5;
}

function averageNumbers(arr) {
  const vals = arr.map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function getMetricByAliases(metricsList, aliases = []) {
  if (!Array.isArray(metricsList) || metricsList.length === 0) return null;
  const out = [];
  for (const m of metricsList) {
    if (!m || typeof m !== 'object') continue;
    for (const key of aliases) {
      if (m[key] === undefined || m[key] === null) continue;
      const scaled = normalizeToFiveScale(m[key]);
      if (scaled !== null) out.push(scaled);
    }
  }
  return averageNumbers(out);
}

function applyPoseMetricAdjustment(dimKey, aiScore, recentPoseMetrics = []) {
  const aliasMap = {
    flexibility: ['flexibility', 'range_of_motion', 'rom', 'flex'],
    coordination: ['coordination', 'rhythm', 'timing', 'balance'],
    core_strength: ['core_strength', 'core_control', 'core', 'stability'],
    endurance: ['endurance', 'stamina', 'holding_time'],
    explosive_power: ['explosive_power', 'power', 'jump_power'],
    movement_quality: ['movement_quality', 'posture', 'form', 'accuracy'],
  };
  const aliases = aliasMap[dimKey] || [];
  const dimMetric = getMetricByAliases(recentPoseMetrics, aliases);
  const overallMetric = getMetricByAliases(recentPoseMetrics, ['score_overall', 'overall', 'total_score']);
  const chosen = dimMetric ?? overallMetric;
  if (chosen === null || Number.isNaN(chosen)) {
    return { score: sanitizeScore(aiScore, 1, 5), metricUsed: null };
  }
  const blended = (sanitizeScore(aiScore, 1, 5) * 0.45) + (sanitizeScore(chosen, 1, 5) * 0.55);
  return { score: sanitizeScore(blended, 1, 5), metricUsed: Number(sanitizeScore(chosen, 1, 5).toFixed(2)) };
}

async function runEvaluationAgent({ student, template, dimensions, courses, priorSummaries = [], recentPoseMetrics = [], recentPerformanceEvidence = [], requirePrivateStandards = true }) {
  const dimText = dimensions.map((d, i) => `${i + 1}. ${d.dim_name}（key=${d.dim_key}）`).join('\n');
  const courseText = courses.length
    ? courses.map(c => `${c.name}(${c.category})`).join('、')
    : '暂无课程记录';
  const priorText = priorSummaries.length ? priorSummaries.join('\n') : '暂无历史评定摘要';
  const poseMetricText = Array.isArray(recentPoseMetrics) && recentPoseMetrics.length
    ? recentPoseMetrics.slice(0, 5).map((m, i) => `姿态样本${i + 1}: ${JSON.stringify(m)}`).join('\n')
    : '暂无姿态指标';
  const performanceText = Array.isArray(recentPerformanceEvidence) && recentPerformanceEvidence.length
    ? recentPerformanceEvidence.slice(0, 8).map((e, i) => `表现证据${i + 1}: ${e}`).join('\n')
    : '暂无表现证据';

  const standardByDimension = {};
  const retrievalSnapshot = [];
  for (const d of dimensions) {
    const chunks = retrieveRelevantChunks(
      `${template.name} ${template.template_type} ${d.dim_name} ${courseText} 评定标准 条款`,
      3,
      {
        docTypes: ['evaluation_standard'],
        metadataFilters: {
          template_type: template.template_type,
          dim_key: d.dim_key,
          owner_scope: 'org_private',
          version: String(template.version || ''),
        },
      },
    );
    standardByDimension[d.dim_key] = chunks;
    retrievalSnapshot.push({
      dim_key: d.dim_key,
      dim_name: d.dim_name,
      hitCount: chunks.length,
      topSources: chunks.slice(0, 3).map(c => ({
        title: c.title,
        clause: c.metadata?.clause || `chunk-${Number(c.chunkIndex || 0) + 1}`,
      })),
    });
  }
  const missingDimensions = dimensions.filter(d => (standardByDimension[d.dim_key] || []).length === 0);
  if (requirePrivateStandards && missingDimensions.length > 0) {
    return {
      blocked: true,
      missingDimensions: missingDimensions.map(d => ({ dim_key: d.dim_key, dim_name: d.dim_name })),
      standardsCount: 0,
      retrievalSnapshot,
    };
  }
  const standardChunks = Object.values(standardByDimension).flat().slice(0, 12);
  const context = standardChunks.length
    ? standardChunks.map((c, i) => `【标准片段${i + 1}｜${c.title}】\n${c.text}`).join('\n\n')
    : '【标准片段】暂无，请基于现有学生证据谨慎评定，并明确写出证据不足。';

  const messages = [
    {
      role: 'system',
      content: `你是教育机构内部的“评定Agent”。
必须优先依据提供的机构标准片段进行打分与解释，不能自由臆断。
如果证据不足，请明确输出 evidence_insufficient=true 并降低 confidence。`,
    },
    {
      role: 'user',
      content: `请对学生进行评定，并严格只输出 JSON，不要任何额外文字。

【学生信息】
姓名：${student.name}
年级：${student.grade || '未知'}
班级：${student.class_name || '未知'}

【课程轨迹】
${courseText}

【最近姿态指标（如有）】
${poseMetricText}

【最近表现证据（如有）】
${performanceText}

【历史评定摘要】
${priorText}

【评定模板】
模板名：${template.name}
模板类型：${template.template_type}
维度列表：
${dimText}

【机构标准片段】
${context}

输出 JSON 格式：
{
  "summary": "总体评语",
  "dimensions": [
    {
      "dim_key": "focus",
      "score": 1-5,
      "confidence": 0-1,
      "rationale": "评分理由",
      "evidence_insufficient": false,
      "evidence": [
        {
          "type": "standard_clause",
          "content": "引用的标准依据摘要",
          "source_ref": "来源文档名",
          "cited_standard_clause": "条款编号或描述"
        }
      ]
    }
  ]
}`,
    },
  ];

  const raw = await callDeepSeek(messages, { temperature: 0.2, max_tokens: 2500 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  const dimensionsOut = dimensions.map(d => {
    const ai = Array.isArray(parsed.dimensions) ? parsed.dimensions.find(x => x.dim_key === d.dim_key) : null;
    const adjusted = applyPoseMetricAdjustment(d.dim_key, ai?.score, recentPoseMetrics);
    const score = adjusted.score;
    const aiEvidence = Array.isArray(ai?.evidence) ? ai.evidence : [];
    const hasStandardEvidence = aiEvidence.some(e => String(e?.type || '') === 'standard_clause');
    const fallbackStandard = (standardByDimension[d.dim_key] || [])[0];
    const fallbackEvidence = fallbackStandard ? [{
      type: 'standard_clause',
      content: String(fallbackStandard.text || '').slice(0, 500),
      source_ref: String(fallbackStandard.title || ''),
      cited_standard_clause: String(fallbackStandard.metadata?.clause || `chunk-${Number(fallbackStandard.chunkIndex || 0) + 1}`),
    }] : [];
    return {
      dimensionId: d.id,
      dim_key: d.dim_key,
      dim_name: d.dim_name,
      score,
      grade: toGrade(score),
      confidence: Math.max(0, Math.min(1, Number(ai?.confidence ?? 0.6))),
      rationale: `${ai?.rationale || 'AI 未返回详细理由'}${adjusted.metricUsed !== null ? `（结合动作指标校准：${adjusted.metricUsed}）` : ''}`,
      evidence_insufficient: !!ai?.evidence_insufficient,
      evidence: hasStandardEvidence ? aiEvidence : [...aiEvidence, ...fallbackEvidence],
    };
  });

  return {
    blocked: false,
    summary: parsed.summary || 'AI 已生成评定草稿',
    dimensions: dimensionsOut,
    standardsCount: standardChunks.length,
    missingDimensions: [],
    retrievalSnapshot,
  };
}

module.exports = { runEvaluationAgent };


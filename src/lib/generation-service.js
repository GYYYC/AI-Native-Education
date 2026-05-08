// AI 生成服务 — 教案/考卷/考核标准
const { callDeepSeek } = require('./ai-service');
const { retrieveRelevantChunks } = require('./rag-service');
const db = require('./db');

/**
 * 获取某课程的六边形维度列表
 */
function getDimensionsForHexagon(hexagonType) {
  const tpl = db.prepare(`
    SELECT id FROM evaluation_templates
    WHERE template_type = ? AND active = 1
    ORDER BY version DESC LIMIT 1
  `).get(hexagonType);
  if (!tpl) return [];
  return db.prepare(`
    SELECT dim_key, dim_name, weight FROM evaluation_dimensions
    WHERE template_id = ? ORDER BY sort_order ASC
  `).all(tpl.id);
}

/**
 * AI 生成教案
 */
async function generateLessonPlan(topic, framework, options = {}) {
  const ragChunks = retrieveRelevantChunks(`${topic} 教案 教学设计`, 5);
  const ragContext = ragChunks.length
    ? ragChunks.map((c, i) => `[参考${i + 1}] ${c.text}`).join('\n\n')
    : '暂无相关参考资料';

  const messages = [
    {
      role: 'system',
      content: `你是一位资深教研专家，擅长设计高质量的教案。
请严格按照用户提供的教案框架结构来生成内容，不要更改结构。
内容需要专业、详细、可操作，适合实际课堂使用。`,
    },
    {
      role: 'user',
      content: `请根据以下框架和主题生成一份完整的教案。

【教学主题】
${topic}

【教案框架（请严格按此结构生成）】
${framework.content_template}

【参考资料（来自知识库）】
${ragContext}

${options.courseName ? `【所属课程】${options.courseName}` : ''}

请直接输出教案正文，不要添加额外说明。`,
    },
  ];

  const content = await callDeepSeek(messages, { temperature: 0.5, max_tokens: 3000 });
  return content;
}

/**
 * AI 生成考卷（含自动生成主观题评分细则）
 */
async function generateExamPaper(topic, framework, options = {}) {
  const ragChunks = retrieveRelevantChunks(`${topic} 考试 试卷 题目`, 5);
  const ragContext = ragChunks.length
    ? ragChunks.map((c, i) => `[参考${i + 1}] ${c.text}`).join('\n\n')
    : '暂无相关参考资料';

  const messages = [
    {
      role: 'system',
      content: `你是一位专业出卷老师，擅长设计各类考试试卷。
请严格按照用户提供的考卷框架结构来生成内容。
要求：
1. 题目难度分布合理（基础60%/提高30%/拓展10%）
2. 每道题都要有明确的标准答案
3. 主观题必须附带详细的评分细则（得分要点）
4. 所有书面题目必须标注分值，且总分可计算`,
    },
    {
      role: 'user',
      content: `请根据以下框架和主题生成一份完整的考卷。

【考试主题/范围】
${topic}

【考卷框架（请严格按此结构生成）】
${framework.content_template}

【参考资料】
${options.baseDocContent ? '以下是已关联的【教案】内容，请严格以此教案涵盖的知识点为准出题：\n' + options.baseDocContent : '（来自知识库）\n' + ragContext}

${options.courseName ? `【所属课程】${options.courseName}` : ''}
${options.totalScore ? `【总分要求】${options.totalScore}分` : ''}
${options.duration ? `【考试时长】${options.duration}分钟` : ''}

请直接输出完整试卷（含题目、选项、标准答案、评分细则），不要添加额外说明。
在试卷末尾附加一个【评分细则汇总】部分，列出所有主观题的评分要点。`,
    },
  ];

  const content = await callDeepSeek(messages, { temperature: 0.4, max_tokens: 4000 });

  // 尝试提取评分细则部分
  const rubricMatch = content.match(/【评分细则汇总】[\s\S]*/);
  const scoringRubric = rubricMatch ? rubricMatch[0] : '';

  return { content, scoringRubric };
}

/**
 * AI 生成考核标准
 */
async function generateAssessmentStandard(topic, framework, options = {}) {
  const hexagonType = options.hexagonType || framework.hexagon_type || 'quality';
  const dims = getDimensionsForHexagon(hexagonType);
  const dimText = dims.map((d, i) => `${i + 1}. ${d.dim_name}（${d.dim_key}，权重${d.weight}）`).join('\n');

  const ragChunks = retrieveRelevantChunks(`${topic} 考核标准 评分`, 5);
  const ragContext = ragChunks.length
    ? ragChunks.map((c, i) => `[参考${i + 1}] ${c.text}`).join('\n\n')
    : '暂无相关参考资料';

  const messages = [
    {
      role: 'system',
      content: `你是一位教育评估专家，擅长制定科学合理的考核标准。
请严格按照框架结构生成考核标准，并填入具体的六边形维度。
每个维度的 1-5 分评分标准必须清晰、可量化、可操作。`,
    },
    {
      role: 'user',
      content: `请根据以下框架和主题生成一份完整的考核标准。

【考核主题】
${topic}

【所属六边形类型】${hexagonType === 'quality' ? '素质六边形' : '体能六边形'}

【六边形维度列表】
${dimText}

【考核标准框架（请严格按此结构生成）】
${framework.content_template}

【参考资料】
${options.baseDocContent ? '以下是已关联的【教案】内容，请严格以此教案的教学目标和重难点为准制定考核标准：\n' + options.baseDocContent : '（来自知识库）\n' + ragContext}

${options.courseName ? `【所属课程】${options.courseName}` : ''}

请将框架中的"维度X"替换为实际的维度名称，并为每个维度编写具体的1-5分评分标准。`,
    },
  ];

  const content = await callDeepSeek(messages, { temperature: 0.3, max_tokens: 3500 });
  return content;
}

/**
 * 统一生成入口
 */
async function generateDocument({ topic, frameworkId, docType, userId, options = {} }) {
  const framework = db.prepare('SELECT * FROM generation_frameworks WHERE id = ?').get(frameworkId);
  if (!framework) throw new Error('框架模板不存在');

  let content, scoringRubric = '';
  const courseName = options.courseId
    ? (db.prepare('SELECT name FROM courses WHERE id = ?').get(options.courseId)?.name || '')
    : '';

  let baseDocContent = '';
  if (options.baseDocId) {
    const baseDoc = db.prepare('SELECT content FROM generated_documents WHERE id = ?').get(options.baseDocId);
    if (baseDoc) baseDocContent = baseDoc.content;
  }

  const genOpts = { ...options, courseName, baseDocContent };

  switch (docType) {
    case 'lesson_plan':
      content = await generateLessonPlan(topic, framework, genOpts);
      break;
    case 'exam_paper': {
      const result = await generateExamPaper(topic, framework, genOpts);
      content = result.content;
      scoringRubric = result.scoringRubric;
      break;
    }
    case 'assessment_standard':
      content = await generateAssessmentStandard(topic, framework, genOpts);
      break;
    default:
      throw new Error(`不支持的文档类型: ${docType}`);
  }

  const typeLabel = { lesson_plan: '教案', exam_paper: '考卷', assessment_standard: '考核标准' }[docType];
  const title = `${typeLabel}：${topic}`;

  const result = db.prepare(`
    INSERT INTO generated_documents (framework_id, doc_type, title, topic, content, scoring_rubric, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(frameworkId, docType, title, topic, content, scoringRubric, userId);

  return {
    id: result.lastInsertRowid,
    title,
    content,
    scoringRubric,
    status: 'draft',
  };
}

module.exports = {
  generateDocument,
  generateLessonPlan,
  generateExamPaper,
  generateAssessmentStandard,
  getDimensionsForHexagon,
};

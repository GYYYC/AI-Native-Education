// 评估服务 — 试卷判分 / 视频打分 / 图片打分 + 个性化建议 + 飞书推送
const { callChatCompletion, callDeepSeek, getAIConfig } = require('./ai-service');
const { retrieveRelevantChunks } = require('./rag-service');
const db = require('./db');

/**
 * 获取学生归属关系 (学生 → 班级 → 老师)
 */
function getStudentOwnership(studentId) {
  return db.prepare(`
    SELECT s.id as student_id, s.name as student_name, s.grade, s.class_name,
           t.id as teacher_id, t.feishu_webhook, t.subject,
           u.id as user_id, u.name as teacher_name
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE s.id = ?
  `).get(studentId);
}

/**
 * 获取六边形维度
 */
function getHexDimensions(hexagonType) {
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
 * 试卷自动判分（OCR + AI 对比教案评分细则）
 */
async function assessExamPaper({ imageBase64, mimeType = 'image/jpeg', studentId, courseId, generatedDocId, userId }) {
  const cfg = getAIConfig();
  if (!cfg.apiKey) throw new Error('AI_API_KEY 未配置');

  // 获取关联的考卷文档（含评分细则）
  let scoringContext = '';
  if (generatedDocId) {
    const doc = db.prepare('SELECT content, scoring_rubric FROM generated_documents WHERE id = ?').get(generatedDocId);
    if (doc) {
      scoringContext = `【标准答案与评分细则】\n${doc.scoring_rubric || doc.content}`;
    }
  }

  // Vision API: OCR 识别试卷 + AI 判分
  const responseData = await callChatCompletion({
    model: cfg.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          {
            type: 'text',
            text: `请识别这份试卷并进行判分。请严格按以下 JSON 格式输出：

${scoringContext}

输出格式：
{
  "questions": [
    {
      "number": 1,
      "type": "选择题/填空题/判断题/简答题/综合题",
      "content": "题目内容摘要",
      "student_answer": "学生的答案",
      "correct_answer": "标准答案",
      "max_score": 10,
      "awarded_score": 8,
      "comment": "判分说明"
    }
  ],
  "total_max_score": 100,
  "total_awarded_score": 85,
  "overall_comment": "整体评价",
  "knowledge_weak_points": ["薄弱知识点1", "薄弱知识点2"]
}

注意：
- 客观题严格对比标准答案判分
- 主观题根据评分细则的要点酌情给分
- 必须给出每题的判分说明
- 书面题目必须出总分`,
          },
        ],
      },
    ],
    max_tokens: 3000,
    temperature: 0.1,
  });

  const raw = responseData.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  return {
    totalScore: result.total_awarded_score || 0,
    totalMaxScore: result.total_max_score || 100,
    questions: result.questions || [],
    overallComment: result.overall_comment || '',
    weakPoints: result.knowledge_weak_points || [],
    rawResponse: raw,
  };
}

/**
 * 视频/图片 AI 六边形打分
 */
async function assessMedia({ imageBase64, mimeType = 'image/jpeg', hexagonType, courseName, assessmentStandard }) {
  const cfg = getAIConfig();
  if (!cfg.apiKey) throw new Error('AI_API_KEY 未配置');

  const dims = getHexDimensions(hexagonType);
  const dimText = dims.map((d, i) => `${i + 1}. ${d.dim_name}（key=${d.dim_key}，权重${d.weight}）`).join('\n');

  const standardContext = assessmentStandard
    ? `\n【考核标准】\n${assessmentStandard}`
    : '';

  const responseData = await callChatCompletion({
    model: cfg.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          {
            type: 'text',
            text: `请根据以下六边形维度对这张图片/视频帧中展示的${courseName || '动作/作品'}进行评分。

【评分维度（${hexagonType === 'quality' ? '素质六边形' : '体能六边形'}）】
${dimText}
${standardContext}

请严格按以下 JSON 格式输出，每个维度给出 1-5 分的评分：
{
  "scores": [
    {
      "dim_key": "flexibility",
      "dim_name": "柔韧性",
      "score": 4.2,
      "rationale": "评分理由（1-2句话）"
    }
  ],
  "overall_comment": "整体评价（2-3句话）",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"]
}

注意：评分必须客观公正，基于图片/视频中实际展示的内容。`,
          },
        ],
      },
    ],
    max_tokens: 1500,
    temperature: 0.2,
  });

  const raw = responseData.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  return {
    scores: (result.scores || []).map(s => ({
      dim_key: s.dim_key,
      dim_name: s.dim_name,
      score: Math.max(1, Math.min(5, Number(s.score) || 1)),
      rationale: s.rationale || '',
    })),
    overallComment: result.overall_comment || '',
    suggestions: result.suggestions || [],
  };
}

/**
 * 生成个性化建议（结合学生历史数据）
 */
async function generatePersonalizedSuggestion(studentId, currentScores, courseName, hexagonType) {
  // 从 RAG 拉取学生历史数据
  const student = db.prepare('SELECT name, grade, class_name FROM students WHERE id = ?').get(studentId);
  if (!student) return '暂无学生信息';

  const historyChunks = retrieveRelevantChunks(
    `${student.name} ${courseName || ''} 成绩 评定 表现`,
    8,
  );
  const historyContext = historyChunks.length
    ? historyChunks.map((c, i) => `[历史记录${i + 1}] ${c.text}`).join('\n\n')
    : '暂无历史记录';

  const scoreText = currentScores.map(s => `${s.dim_name}: ${s.score}分`).join('、');
  const avgScore = currentScores.reduce((sum, s) => sum + s.score, 0) / (currentScores.length || 1);

  const messages = [
    {
      role: 'system',
      content: `你是一位个性化教育顾问。请根据学生的当前评估结果和历史数据，生成针对性的改进建议。
要求：
1. 结合历史数据中的趋势（进步或退步）
2. 具体到每个薄弱维度的改进方法
3. 语气正面鼓励，适合发送给老师阅读
4. 控制在200字以内`,
    },
    {
      role: 'user',
      content: `【学生信息】
姓名：${student.name}，年级：${student.grade || '-'}，班级：${student.class_name || '-'}

【本次评估】
课程：${courseName || '未知'}
六边形类型：${hexagonType === 'quality' ? '素质' : '体能'}
各维度得分：${scoreText}
平均分：${avgScore.toFixed(2)}/5

【历史数据】
${historyContext}

请生成个性化改进建议。`,
    },
  ];

  return await callDeepSeek(messages, { temperature: 0.5, max_tokens: 500 });
}

/**
 * 发送评估建议到飞书（按归属关系精准推送）
 */
async function sendAssessmentToFeishu(uploadId) {
  const upload = db.prepare(`
    SELECT au.*, c.name as course_name
    FROM assessment_uploads au
    LEFT JOIN courses c ON au.course_id = c.id
    WHERE au.id = ?
  `).get(uploadId);
  if (!upload) return false;

  const ownership = getStudentOwnership(upload.student_id);
  if (!ownership || !ownership.feishu_webhook) {
    console.warn(`⚠️ 学生 ${upload.student_id} 的老师未配置飞书 Webhook，跳过推送`);
    return false;
  }

  const scores = db.prepare('SELECT dim_key, dim_name, score FROM assessment_hex_scores WHERE upload_id = ? ORDER BY id ASC').all(uploadId);
  const scoreText = scores.map(s => `• **${s.dim_name}**：${s.score.toFixed(1)}分`).join('\n');
  const avgScore = scores.length ? (scores.reduce((sum, s) => sum + s.score, 0) / scores.length) : 0;

  const hexLabel = upload.hexagon_type === 'quality' ? '素质' : '体能';
  const typeLabel = { exam_paper: '试卷', video: '视频', image: '图片' }[upload.upload_type] || '评估';

  const message = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `📊 学生${typeLabel}评估报告` },
        template: avgScore >= 3.5 ? 'green' : avgScore >= 2.5 ? 'orange' : 'red',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**学生姓名**\n${ownership.student_name}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**所在班级**\n${ownership.class_name || '-'}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**授课教师**\n${ownership.teacher_name}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**评估课程**\n${upload.course_name || '-'}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**六边形类型**\n${hexLabel}六边形` } },
            { is_short: true, text: { tag: 'lark_md', content: `**平均分**\n${avgScore.toFixed(2)} / 5` } },
          ],
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: `**${hexLabel}六边形评分：**\n${scoreText}` } },
        ...(upload.total_score != null ? [{ tag: 'div', text: { tag: 'lark_md', content: `**试卷总分：** ${upload.total_score}分` } }] : []),
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: `**个性化建议：**\n${upload.personalized_suggestion || upload.ai_suggestion || '暂无'}` } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `发送时间：${new Date().toLocaleString('zh-CN')}` }] },
      ],
    },
  };

  // 获取全局飞书 Webhook
  const globalWebhook = process.env.FEISHU_WEBHOOK_URL || '';
  const webhooks = [ownership.feishu_webhook];
  if (globalWebhook && !webhooks.includes(globalWebhook)) webhooks.push(globalWebhook);

  let sent = false;
  for (const url of webhooks.filter(Boolean)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      const data = await res.json();
      if (data.code === 0) {
        console.log(`✅ 飞书评估推送成功 → 老师:${ownership.teacher_name} 学生:${ownership.student_name}`);
        sent = true;
      } else {
        console.error(`❌ 飞书评估推送失败:`, data.msg);
      }
    } catch (err) {
      console.error(`❌ 飞书评估推送异常:`, err.message);
    }
  }

  if (sent) {
    db.prepare('UPDATE assessment_uploads SET feishu_sent = 1 WHERE id = ?').run(uploadId);
  }
  return sent;
}

/**
 * 完整评估流程（上传 → 打分 → 建议 → 推送）
 */
async function runAssessment({ studentId, courseId, hexagonType, uploadType, imageBase64, mimeType = 'image/jpeg', generatedDocId, userId }) {
  // 1. 创建评估记录
  const insertResult = db.prepare(`
    INSERT INTO assessment_uploads (student_id, course_id, hexagon_type, upload_type, file_base64, generated_doc_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)
  `).run(studentId, courseId || null, hexagonType, uploadType, imageBase64, generatedDocId || null, userId);
  const uploadId = insertResult.lastInsertRowid;

  try {
    const courseName = courseId
      ? (db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId)?.name || '')
      : '';

    let totalScore = null;
    let aiSuggestion = '';
    let scores = [];

    if (uploadType === 'exam_paper') {
      // 试卷判分
      const examResult = await assessExamPaper({
        imageBase64, mimeType, studentId, courseId, generatedDocId, userId,
      });
      totalScore = examResult.totalScore;
      aiSuggestion = `${examResult.overallComment}\n\n薄弱知识点：${examResult.weakPoints.join('、') || '无'}`;

      // 试卷也进行六边形打分（基于知识点覆盖情况）
      const mediaResult = await assessMedia({
        imageBase64, mimeType, hexagonType, courseName,
        assessmentStandard: generatedDocId
          ? (db.prepare('SELECT content FROM generated_documents WHERE id = ?').get(generatedDocId)?.content || '')
          : '',
      });
      scores = mediaResult.scores;
    } else {
      // 视频/图片打分
      const assessmentStd = generatedDocId
        ? (db.prepare('SELECT content FROM generated_documents WHERE id = ?').get(generatedDocId)?.content || '')
        : '';
      const mediaResult = await assessMedia({
        imageBase64, mimeType, hexagonType, courseName, assessmentStandard: assessmentStd,
      });
      scores = mediaResult.scores;
      aiSuggestion = `${mediaResult.overallComment}\n\n改进建议：\n${mediaResult.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }

    // 2. 保存六边形维度评分
    for (const s of scores) {
      db.prepare(`
        INSERT OR REPLACE INTO assessment_hex_scores (upload_id, dim_key, dim_name, score, rationale)
        VALUES (?, ?, ?, ?, ?)
      `).run(uploadId, s.dim_key, s.dim_name, s.score, s.rationale);
    }

    // 3. 生成个性化建议
    const personalizedSuggestion = await generatePersonalizedSuggestion(studentId, scores, courseName, hexagonType);

    // 4. 更新评估记录
    db.prepare(`
      UPDATE assessment_uploads
      SET total_score = ?, ai_suggestion = ?, personalized_suggestion = ?, status = 'completed'
      WHERE id = ?
    `).run(totalScore, aiSuggestion, personalizedSuggestion, uploadId);

    // 5. 飞书推送
    await sendAssessmentToFeishu(uploadId);

    return {
      uploadId,
      totalScore,
      scores,
      aiSuggestion,
      personalizedSuggestion,
      status: 'completed',
    };
  } catch (err) {
    db.prepare(`
      UPDATE assessment_uploads SET status = 'failed', error_message = ? WHERE id = ?
    `).run(err.message, uploadId);
    throw err;
  }
}

module.exports = {
  runAssessment,
  assessExamPaper,
  assessMedia,
  generatePersonalizedSuggestion,
  sendAssessmentToFeishu,
  getStudentOwnership,
  getHexDimensions,
};

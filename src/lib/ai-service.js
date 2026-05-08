// OpenAI 兼容 AI 服务封装（可切换 DeepSeek / 千问等）
const AI_API_URL = process.env.AI_API_URL || process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1';
const AI_API_KEY = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const CHAT_MODEL = process.env.AI_CHAT_MODEL || process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat';
const VISION_MODEL = process.env.AI_VISION_MODEL || CHAT_MODEL;
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || process.env.DEEPSEEK_EMBEDDING_MODEL || CHAT_MODEL;

function getAIConfig() {
  return {
    apiUrl: AI_API_URL,
    apiKey: AI_API_KEY,
    chatModel: CHAT_MODEL,
    visionModel: VISION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
  };
}

async function callChatCompletion(payload) {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY 未配置，请在 .env.local 中设置');
  }
  const response = await fetch(`${AI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API 错误: ${response.status} - ${err}`);
  }
  return response.json();
}

async function callDeepSeek(messages, options = {}) {
  const data = await callChatCompletion({
    model: options.model || CHAT_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 2000,
  });
  return data.choices[0].message.content;
}

// 获取文本 Embedding（用于 RAG）
async function getEmbedding(text) {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY 未配置');
  }
  const response = await fetch(`${AI_API_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    // Fallback: 使用简单 TF-IDF 模拟
    return null;
  }
  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * 分析学生学习情况
 * @param {Object} studentInfo - 学生基本信息
 * @param {Array} examRecords - 历次考试记录
 * @param {Array} wrongQuestions - 错题列表
 */
async function analyzeStudentLearning(studentInfo, examRecords, wrongQuestions) {
  const examSummary = examRecords.map(r => 
    `${r.exam_name}(${r.exam_date}): ${r.score}/${r.total_score}分`
  ).join('\n');

  const wrongSummary = wrongQuestions.slice(0, 20).map(q => 
    `- 知识点:${q.knowledge_point || '未标注'} | 题目:${q.question_content?.substring(0, 50) || ''}`
  ).join('\n');

  const messages = [
    {
      role: 'system',
      content: `你是一位专业的教育分析师，擅长分析中小学生学习情况并给出针对性建议。请用简洁专业的中文回答。`
    },
    {
      role: 'user',
      content: `请分析以下学生的学习情况并给出改进建议：

【学生基本信息】
姓名：${studentInfo.name}
年级：${studentInfo.grade || '未知'}
班级：${studentInfo.class_name || '未知'}

【历次考试成绩（时间排序）】
${examSummary || '暂无考试记录'}

【常见错题知识点】
${wrongSummary || '暂无错题记录'}

请按以下格式输出：
1. **学习状态评估**（2-3句话，整体评价成绩趋势）
2. **薄弱知识点分析**（列出主要薄弱点）
3. **具体改进建议**（3-5条可操作建议）
4. **下阶段学习重点**（1-2个核心目标）`
    }
  ];

  return await callDeepSeek(messages, { temperature: 0.6, max_tokens: 1500 });
}

/**
 * 分析班级整体情况
 * @param {Object} teacherInfo - 教师信息
 * @param {Array} classStats - 班级统计数据
 */
async function analyzeClassPerformance(teacherInfo, classStats) {
  const messages = [
    {
      role: 'system',
      content: '你是一位教育督导专家，负责评估班级整体教学质量。请用简洁中文回答。'
    },
    {
      role: 'user',
      content: `请分析以下班级的教学情况：

【教师信息】
教师：${teacherInfo.name}，科目：${teacherInfo.subject}，班级：${teacherInfo.class_name}

【班级成绩统计】
${classStats.map(s => `考试"${s.exam_name}": 平均分${s.avg_score?.toFixed(1)}, 最高${s.max_score}, 最低${s.min_score}, 参考人数${s.count}`).join('\n')}

请分析：班级整体学习水平、存在的问题，以及对教师的教学建议。`
    }
  ];
  return await callDeepSeek(messages, { temperature: 0.6 });
}

/**
 * 生成错题AI解析
 */
async function explainWrongQuestion(question) {
  const messages = [
    {
      role: 'system',
      content: '你是一位耐心的教师，擅长用简单易懂的方式解释题目错误原因。'
    },
    {
      role: 'user',
      content: `请解析这道题：

题目：${question.question_content}
学生答案：${question.student_answer || '未作答'}
正确答案：${question.correct_answer}
知识点：${question.knowledge_point || '未知'}

请给出：①错误原因分析 ②正确解题思路 ③同类题目注意事项`
    }
  ];
  return await callDeepSeek(messages, { temperature: 0.5, max_tokens: 800 });
}

module.exports = {
  callDeepSeek,
  callChatCompletion,
  getAIConfig,
  getEmbedding,
  analyzeStudentLearning,
  analyzeClassPerformance,
  explainWrongQuestion,
};

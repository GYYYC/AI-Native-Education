// 飞书消息推送服务
const GLOBAL_FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';

/**
 * 发送飞书消息到单个 Webhook
 */
async function sendSingleFeishuMessage(webhookUrl, content) {
  if (!webhookUrl) return false;
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    });
    const data = await response.json();
    if (data.code === 0) {
      console.log(`✅ 飞书消息发送成功: ${webhookUrl}`);
      return true;
    } else {
      console.error(`❌ 飞书消息发送失败 (${webhookUrl}):`, data.msg);
      return false;
    }
  } catch (error) {
    console.error(`❌ 飞书消息发送异常 (${webhookUrl}):`, error.message);
    return false;
  }
}

/**
 * 发送飞书消息到多个 Webhook
 */
async function sendFeishuMessage(webhookUrls, content) {
  const validWebhooks = Array.isArray(webhookUrls) ? webhookUrls.filter(url => typeof url === 'string' && url.length > 0) : [];
  if (GLOBAL_FEISHU_WEBHOOK_URL && !validWebhooks.includes(GLOBAL_FEISHU_WEBHOOK_URL)) {
    validWebhooks.push(GLOBAL_FEISHU_WEBHOOK_URL);
  }

  if (validWebhooks.length === 0) {
    console.warn('⚠️ 没有配置有效的飞书 Webhook URL，跳过消息推送');
    return false;
  }

  // 并发发送到所有目标
  const results = await Promise.all(validWebhooks.map(url => sendSingleFeishuMessage(url, content)));
  return results.some(r => r === true); // 只要有一个发送成功就算成功
}

/**
 * 发送学生异常告警
 */
async function sendStudentAlert({ webhookUrls = [], studentName, teacherName, className, subject, examName, currentScore, avgScore, changePercent, detail }) {
  const message = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '⚠️ 学生成绩异常预警' },
        template: 'red',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**学生姓名**\n${studentName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**所在班级**\n${className}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**授课教师**\n${teacherName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**考试科目**\n${subject}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**考试名称**\n${examName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**本次分数**\n${currentScore}分` } },
            { is_short: true, text: { tag: 'lark_md', content: `**历史均分**\n${avgScore?.toFixed(1)}分` } },
            { is_short: true, text: { tag: 'lark_md', content: `**变化幅度**\n${changePercent > 0 ? '+' : ''}${changePercent?.toFixed(1)}%` } },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**异常说明：** ${detail}` },
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `发送时间：${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
  return await sendFeishuMessage(webhookUrls, message);
}

/**
 * 发送班级整体异常告警（仅发给老板）
 */
async function sendClassAlert({ webhookUrls = [], teacherName, className, subject, failStats, detail }) {
  const scoresText = failStats?.map(s => `${s.exam_name}: ${s.fail_count}人不及格`).join(' → ') || '';
  const message = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🚨 班级成绩整体预警' },
        template: 'orange',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**责任教师**\n${teacherName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**班级**\n${className}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**科目**\n${subject}` } },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**近期成绩趋势：** ${scoresText}` },
        },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**异常说明：** ${detail}` },
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `发送时间：${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
  return await sendFeishuMessage(webhookUrls, message);
}
/**
 * 发送错题重复出错告警
 */
async function sendRepeatedWrongAlert({ webhookUrls = [], studentName, teacherName, className, subject, repeatedPoints, detail }) {
  const pointsText = repeatedPoints.map(p => `• **${p.point}**：已连续出错 ${p.count} 次`).join('\n');
  const message = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '📌 学生错题重复出错预警' },
        template: 'yellow',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**学生姓名**\n${studentName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**所在班级**\n${className}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**授课教师**\n${teacherName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**考试科目**\n${subject}` } },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**重复出错知识点：**\n${pointsText}` },
        },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**建议：** ${detail}` },
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `发送时间：${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
  return await sendFeishuMessage(webhookUrls, message);
}

/**
 * 发送学生综合评定异常告警
 */
async function sendEvaluationAbnormalAlert({
  webhookUrls = [],
  studentName,
  teacherName,
  className,
  templateName,
  avgScore,
  lowDimensions = [],
  detail,
}) {
  const lowText = lowDimensions.length
    ? lowDimensions.map(d => `• ${d.dim_name}: ${d.score}分`).join('\n')
    : '无';

  const message = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '⚠️ 学生综合评定异常预警' },
        template: 'red',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**学生姓名**\n${studentName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**所在班级**\n${className}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**授课教师**\n${teacherName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**评定模板**\n${templateName}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**平均分**\n${avgScore.toFixed(2)} / 5` } },
          ],
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: `**低分维度：**\n${lowText}` } },
        { tag: 'div', text: { tag: 'lark_md', content: `**异常说明：** ${detail}` } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `发送时间：${new Date().toLocaleString('zh-CN')}` }] },
      ],
    },
  };
  return await sendFeishuMessage(webhookUrls, message);
}

module.exports = { sendStudentAlert, sendClassAlert, sendRepeatedWrongAlert, sendEvaluationAbnormalAlert };

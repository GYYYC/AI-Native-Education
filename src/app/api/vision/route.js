import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../lib/auth');
const { callChatCompletion, getAIConfig } = require('../../../lib/ai-service');

/**
 * POST /api/vision
 * 使用 OpenAI 兼容 Vision API 识别试卷错题图片
 * body: { imageBase64: string, mimeType: string }
 */
export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await request.json();
    if (!imageBase64) return NextResponse.json({ error: '请提供图片数据' }, { status: 400 });

    const cfg = getAIConfig();
    if (!cfg.apiKey) return NextResponse.json({ error: 'AI_API_KEY 未配置' }, { status: 503 });

    const responseData = await callChatCompletion({
      model: cfg.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
            {
              type: 'text',
              text: `请仔细识别这道错题，并严格按照以下 JSON 格式输出（不要添加任何其他文字）：

{
  "question_content": "完整题目内容（包含所有选项如有）",
  "student_answer": "学生的回答/填写内容（如果图片中可见）",
  "correct_answer": "正确答案（如果图片中可见，否则填空字符串）",
  "knowledge_point": "涉及的核心知识点（1-3个关键词）",
  "question_number": "题号（数字，如果可见）",
  "error_analysis": "错误原因分析（1-2句话）",
  "suggestions": "改进建议（1-2条）"
}

注意：
- question_content 要完整准确，保留原题格式
- knowledge_point 只填知识点名称，如"二次函数"、"文言文翻译"等
- 如果图片中有多道题，只取最明显的一道
- 严格输出 JSON，不要有任何多余内容`,
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });
    const content = responseData.choices[0].message.content.trim();

    // Parse JSON from response
    let parsed;
    try {
      // Extract JSON even if wrapped in markdown
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      // If JSON parse fails, return raw content
      return NextResponse.json({
        raw: content,
        error: 'AI 返回格式异常，已显示原始内容',
      });
    }

    return NextResponse.json({ success: true, data: parsed });

  } catch (err) {
    console.error('Vision 识别错误:', err);
    if (String(err.message || '').includes('400') || String(err.message || '').includes('422')) {
      return NextResponse.json({
        error: '当前视觉模型暂不支持图片识别，请切换支持多模态的模型后重试',
        fallback: true,
      }, { status: 422 });
    }
    return NextResponse.json({ error: '图片识别失败: ' + err.message }, { status: 500 });
  }
}

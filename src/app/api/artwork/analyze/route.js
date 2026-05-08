import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
const { requireAuth } = require('../../../../lib/auth');
const { callChatCompletion, getAIConfig } = require('../../../../lib/ai-service');

export const runtime = 'nodejs';

function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function runPythonCvOcr(payload) {
  return new Promise((resolve) => {
    const py = spawn('python', ['scripts/artwork_cv_ocr.py'], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => { stdout += String(d || ''); });
    py.stderr.on('data', d => { stderr += String(d || ''); });
    py.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: `python_exit_${code}: ${stderr}` });
        return;
      }
      const parsed = parseJsonSafe(stdout, null);
      if (!parsed) {
        resolve({ ok: false, error: 'python_output_parse_failed', raw: stdout });
        return;
      }
      resolve(parsed);
    });
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

function calcDimensionHints(artType, cvMetrics = {}, semantic = {}) {
  const sem = semantic && typeof semantic === 'object' ? semantic : {};
  const sAesthetic = Number(sem.aestheticExpression || 0);
  const sCreativity = Number(sem.creativityExpression || 0);
  const sFocus = Number(sem.focusDiscipline || 0);
  const hints = {};
  if (artType === 'calligraphy') {
    const structure = Number(cvMetrics.structureStability || 0) * 100;
    const stroke = Number(cvMetrics.strokeStability || 0) * 100;
    hints.aesthetic = Math.round((structure * 0.35 + stroke * 0.35 + sAesthetic * 0.30) / 20);
    hints.focus = Math.round((stroke * 0.45 + sFocus * 0.55) / 20);
    hints.expression = Math.round((sCreativity * 0.4 + sAesthetic * 0.6) / 20);
  } else {
    const comp = Number(cvMetrics.compositionBalance || 0) * 100;
    const layer = Number(cvMetrics.layerRichness || 0) * 100;
    hints.aesthetic = Math.round((comp * 0.35 + layer * 0.35 + sAesthetic * 0.30) / 20);
    hints.creativity = Math.round((sCreativity * 0.65 + layer * 0.35) / 20);
    hints.expression = Math.round((sAesthetic * 0.4 + sCreativity * 0.6) / 20);
  }
  for (const k of Object.keys(hints)) {
    hints[k] = Math.max(1, Math.min(5, Number(hints[k] || 1)));
  }
  return hints;
}

async function analyzeSemanticWithVision({ artType, imageBase64, mimeType, cvMetrics, ocrText }) {
  const cfg = getAIConfig();
  if (!cfg.apiKey) {
    return { ok: false, error: 'AI_API_KEY 未配置，跳过语义评测', semantic: {} };
  }
  const prompt = artType === 'calligraphy'
    ? `你是书法评审助手。请基于图像与指标输出 JSON：{"aestheticExpression":0-100,"creativityExpression":0-100,"focusDiscipline":0-100,"summary":"一句话","detail":["3条细节意见"]}。
指标：${JSON.stringify(cvMetrics)}
OCR文本：${ocrText || '无'}`
    : `你是国画评审助手。请基于图像与指标输出 JSON：{"aestheticExpression":0-100,"creativityExpression":0-100,"focusDiscipline":0-100,"summary":"一句话","detail":["3条细节意见"]}。
指标：${JSON.stringify(cvMetrics)}
OCR文本：${ocrText || '无'}`;

  try {
    const data = await callChatCompletion({
      model: cfg.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });
    const raw = String(data.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const semantic = parseJsonSafe(jsonMatch ? jsonMatch[0] : raw, {});
    return { ok: true, semantic };
  } catch (err) {
    return { ok: false, error: String(err.message || err), semantic: {} };
  }
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const imageBase64 = String(body.imageBase64 || '').trim();
    const mimeType = String(body.mimeType || 'image/jpeg').trim();
    const artType = String(body.artType || '').trim();
    if (!imageBase64) return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
    if (!['calligraphy', 'painting'].includes(artType)) {
      return NextResponse.json({ error: 'artType 必须为 calligraphy 或 painting' }, { status: 400 });
    }

    const cvResult = await runPythonCvOcr({ imageBase64, artType });
    const cvMetrics = cvResult?.metrics && typeof cvResult.metrics === 'object' ? cvResult.metrics : {};
    const ocrText = String(cvResult?.ocrText || '').trim();
    const semanticResult = await analyzeSemanticWithVision({
      artType,
      imageBase64,
      mimeType,
      cvMetrics,
      ocrText,
    });
    const dimensionHints = calcDimensionHints(artType, cvMetrics, semanticResult.semantic || {});

    return NextResponse.json({
      success: true,
      artType,
      engine: {
        cvOcr: cvResult?.ok ? 'python-opencv' : 'fallback',
        semantic: semanticResult?.ok ? 'vision-llm' : 'unavailable',
      },
      warnings: [
        ...(Array.isArray(cvResult?.warnings) ? cvResult.warnings : []),
        ...(semanticResult?.ok ? [] : [semanticResult?.error || '视觉语义分析不可用']),
      ].filter(Boolean),
      cvMetrics,
      ocrText,
      semantic: semanticResult.semantic || {},
      dimensionHints,
      evidencePayload: {
        evidence_detail_type: artType === 'calligraphy' ? 'calligraphy_metric' : 'artwork_metric',
        source: 'cv_ocr_plus_vision',
        artType,
        cvMetrics,
        ocrText,
        semantic: semanticResult.semantic || {},
        dimensionHints,
        analyzedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: '作品分析失败: ' + err.message }, { status: 500 });
  }
}


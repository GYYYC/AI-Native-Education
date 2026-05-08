import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');
const { generateDocument } = require('../../../../lib/generation-service');

// POST /api/boss/generate — AI 生成教案/考卷/考核标准
export async function POST(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { topic, frameworkId, docType, courseId, totalScore, duration, hexagonType, baseDocId } = await request.json();
  if (!topic || !frameworkId || !docType) {
    return NextResponse.json({ error: '缺少必填字段（topic, frameworkId, docType）' }, { status: 400 });
  }

  try {
    const result = await generateDocument({
      topic,
      frameworkId,
      docType,
      userId: user.id,
      options: { courseId, totalScore, duration, hexagonType, baseDocId },
    });
    return NextResponse.json({ success: true, document: result });
  } catch (err) {
    console.error('AI 生成失败:', err);
    return NextResponse.json({ error: 'AI 生成失败: ' + err.message }, { status: 500 });
  }
}

// GET /api/boss/generate — 获取已生成的文档列表
export async function GET(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const docType = searchParams.get('type') || '';
  const status = searchParams.get('status') || '';

  let sql = 'SELECT gd.*, gf.name as framework_name FROM generated_documents gd LEFT JOIN generation_frameworks gf ON gd.framework_id = gf.id WHERE 1=1';
  const params = [];
  if (docType) { sql += ' AND gd.doc_type = ?'; params.push(docType); }
  if (status) { sql += ' AND gd.status = ?'; params.push(status); }
  sql += ' ORDER BY gd.id DESC LIMIT 50';

  const documents = db.prepare(sql).all(...params);
  return NextResponse.json({ documents });
}

// PUT /api/boss/generate — 更新文档状态（审核/归档）或编辑内容
export async function PUT(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { id, status, content, scoringRubric } = await request.json();
  if (!id) return NextResponse.json({ error: '缺少文档ID' }, { status: 400 });

  const sets = [];
  const params = [];
  if (status) { sets.push('status = ?'); params.push(status); }
  if (content) { sets.push('content = ?'); params.push(content); }
  if (scoringRubric !== undefined) { sets.push('scoring_rubric = ?'); params.push(scoringRubric); }

  if (sets.length === 0) return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 });

  params.push(id);
  db.prepare(`UPDATE generated_documents SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return NextResponse.json({ success: true });
}

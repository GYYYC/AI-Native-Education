import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');

export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templates = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM evaluation_dimensions d WHERE d.template_id = t.id) as dimension_count
    FROM evaluation_templates t
    ORDER BY t.active DESC, t.created_at DESC
  `).all();

  return NextResponse.json({ templates });
}

export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, templateType = 'custom', scoreScale } = body;
    if (!name?.trim()) return NextResponse.json({ error: '模板名称不能为空' }, { status: 400 });
    if (!['quality', 'fitness', 'custom'].includes(templateType)) {
      return NextResponse.json({ error: '模板类型无效' }, { status: 400 });
    }

    const scale = scoreScale && typeof scoreScale === 'object'
      ? scoreScale
      : { min: 1, max: 5, grades: { A: [4.5, 5], B: [3.5, 4.49], C: [2.5, 3.49], D: [1, 2.49] } };

    const result = db.prepare(`
      INSERT INTO evaluation_templates (name, template_type, score_scale_json, active, version)
      VALUES (?, ?, ?, 1, 1)
    `).run(name.trim(), templateType, JSON.stringify(scale));

    const template = db.prepare('SELECT * FROM evaluation_templates WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json({ success: true, template }, { status: 201 });
  } catch (err) {
    console.error('创建评定模板失败:', err);
    return NextResponse.json({ error: '创建评定模板失败' }, { status: 500 });
  }
}


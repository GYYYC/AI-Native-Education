import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: '模板ID无效' }, { status: 400 });

  const template = db.prepare('SELECT * FROM evaluation_templates WHERE id = ?').get(id);
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  return NextResponse.json({ template });
}

export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: '模板ID无效' }, { status: 400 });

  const existing = db.prepare('SELECT * FROM evaluation_templates WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  try {
    const { name, active, scoreScale } = await request.json();
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextActive = active === undefined ? existing.active : (active ? 1 : 0);
    const nextScale = scoreScale && typeof scoreScale === 'object'
      ? JSON.stringify(scoreScale)
      : existing.score_scale_json;

    db.prepare(`
      UPDATE evaluation_templates
      SET name = ?, active = ?, score_scale_json = ?, version = version + 1
      WHERE id = ?
    `).run(nextName, nextActive, nextScale, id);

    const template = db.prepare('SELECT * FROM evaluation_templates WHERE id = ?').get(id);
    return NextResponse.json({ success: true, template });
  } catch (err) {
    console.error('更新模板失败:', err);
    return NextResponse.json({ error: '更新模板失败' }, { status: 500 });
  }
}


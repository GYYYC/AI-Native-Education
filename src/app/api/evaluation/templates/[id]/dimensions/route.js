import { NextResponse } from 'next/server';
const db = require('../../../../../../lib/db');
const { requireAuth } = require('../../../../../../lib/auth');

export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templateId = parseInt(params.id, 10);
  if (Number.isNaN(templateId)) return NextResponse.json({ error: '模板ID无效' }, { status: 400 });

  const dimensions = db.prepare(`
    SELECT * FROM evaluation_dimensions
    WHERE template_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(templateId);

  return NextResponse.json({ dimensions });
}

export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templateId = parseInt(params.id, 10);
  if (Number.isNaN(templateId)) return NextResponse.json({ error: '模板ID无效' }, { status: 400 });

  const template = db.prepare('SELECT id FROM evaluation_templates WHERE id = ?').get(templateId);
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  try {
    const { dimensions } = await request.json();
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      return NextResponse.json({ error: 'dimensions 不能为空' }, { status: 400 });
    }

    db.exec('BEGIN');
    db.prepare('DELETE FROM evaluation_dimensions WHERE template_id = ?').run(templateId);

    const insert = db.prepare(`
      INSERT INTO evaluation_dimensions (template_id, dim_key, dim_name, weight, sort_order, rubric_hint)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    dimensions.forEach((d, i) => {
      if (!d?.dim_key || !d?.dim_name) throw new Error(`第 ${i + 1} 个维度缺少 dim_key 或 dim_name`);
      insert.run(
        templateId,
        String(d.dim_key).trim(),
        String(d.dim_name).trim(),
        Number(d.weight || 1),
        i + 1,
        String(d.rubric_hint || '').trim(),
      );
    });

    db.exec('COMMIT');
    const rows = db.prepare(`
      SELECT * FROM evaluation_dimensions WHERE template_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(templateId);
    return NextResponse.json({ success: true, dimensions: rows });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('更新模板维度失败:', err);
    return NextResponse.json({ error: '更新模板维度失败: ' + err.message }, { status: 500 });
  }
}


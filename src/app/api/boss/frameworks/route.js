import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');

// GET /api/boss/frameworks — 获取框架模板列表
export async function GET(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const frameworkType = searchParams.get('type') || '';
  const hexagonType = searchParams.get('hexagon') || '';

  let sql = 'SELECT * FROM generation_frameworks WHERE 1=1';
  const params = [];
  if (frameworkType) { sql += ' AND framework_type = ?'; params.push(frameworkType); }
  if (hexagonType) { sql += ' AND hexagon_type = ?'; params.push(hexagonType); }
  sql += ' ORDER BY id ASC';

  const frameworks = db.prepare(sql).all(...params);
  return NextResponse.json({ frameworks });
}

// POST /api/boss/frameworks — 新增框架模板
export async function POST(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { name, frameworkType, hexagonType, courseId, contentTemplate } = await request.json();
  if (!name || !frameworkType || !contentTemplate) {
    return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
  }

  const result = db.prepare(`
    INSERT INTO generation_frameworks (name, framework_type, hexagon_type, course_id, content_template, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, frameworkType, hexagonType || null, courseId || null, contentTemplate, user.id);

  return NextResponse.json({ id: result.lastInsertRowid, success: true });
}

// PUT /api/boss/frameworks — 编辑框架模板
export async function PUT(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { id, name, contentTemplate, hexagonType } = await request.json();
  if (!id) return NextResponse.json({ error: '缺少框架ID' }, { status: 400 });

  const sets = [];
  const params = [];
  if (name) { sets.push('name = ?'); params.push(name); }
  if (contentTemplate) { sets.push('content_template = ?'); params.push(contentTemplate); }
  if (hexagonType !== undefined) { sets.push('hexagon_type = ?'); params.push(hexagonType || null); }
  sets.push('updated_at = CURRENT_TIMESTAMP');

  if (sets.length === 1) return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 });

  params.push(id);
  db.prepare(`UPDATE generation_frameworks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return NextResponse.json({ success: true });
}

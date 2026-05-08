import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

function canAccessStudent(studentId, user) {
  const student = db.prepare(`
    SELECT s.id
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(studentId, user.id, user.role);
  return !!student;
}

export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const studentId = parseInt(params.id, 10);
  if (Number.isNaN(studentId)) return NextResponse.json({ error: '学生ID无效' }, { status: 400 });

  if (!canAccessStudent(studentId, user)) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

  try {
    const { templateType, items } = await request.json();
    if (!['quality', 'fitness'].includes(templateType)) {
      return NextResponse.json({ error: 'templateType 必须为 quality 或 fitness' }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length !== 6) {
      return NextResponse.json({ error: 'items 必须为长度为6的数组' }, { status: 400 });
    }

    const normalized = items.map((it, idx) => {
      const label = String(it?.label || '').trim();
      if (!label) throw new Error(`第${idx + 1}项标签不能为空`);
      return { label };
    });

    const template = db.prepare(`
      SELECT id
      FROM evaluation_templates
      WHERE template_type = ? AND active = 1
      ORDER BY version DESC, id DESC
      LIMIT 1
    `).get(templateType);
    if (!template) {
      return NextResponse.json({ error: `未找到已启用的${templateType}模板` }, { status: 404 });
    }

    const dims = db.prepare(`
      SELECT id
      FROM evaluation_dimensions
      WHERE template_id = ?
      ORDER BY sort_order ASC, id ASC
      LIMIT 6
    `).all(template.id);
    if (dims.length !== 6) {
      return NextResponse.json({ error: '当前模板不是6个维度，无法同步六边形标签' }, { status: 400 });
    }

    const updateDim = db.prepare('UPDATE evaluation_dimensions SET dim_name = ? WHERE id = ?');
    db.exec('BEGIN');
    for (let i = 0; i < dims.length; i++) {
      updateDim.run(normalized[i].label, dims[i].id);
    }
    db.prepare('DELETE FROM student_template_overrides WHERE template_type = ?').run(templateType);
    db.exec('COMMIT');

    return NextResponse.json({ success: true, scope: 'global' });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    return NextResponse.json({ error: '保存失败: ' + err.message }, { status: 400 });
  }
}


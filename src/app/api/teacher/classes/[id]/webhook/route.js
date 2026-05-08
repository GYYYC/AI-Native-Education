import { NextResponse } from 'next/server';
const db = require('../../../../../../lib/db');
const { requireAuth } = require('../../../../../../lib/auth');

export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const teacherId = params.id;
    const { webhookUrl } = await request.json();

    // Verify ownership
    const teacher = db.prepare('SELECT id FROM teachers WHERE id = ? AND user_id = ?').get(teacherId, user.id);
    if (!teacher) {
      return NextResponse.json({ error: '无权操作该班级' }, { status: 403 });
    }

    db.prepare('UPDATE teachers SET feishu_webhook = ? WHERE id = ?').run(
      webhookUrl ? webhookUrl.trim() : null,
      teacherId
    );

    return NextResponse.json({ success: true, message: 'Webhook updated successfully' });
  } catch (err) {
    console.error('更新班级 Webhook 失败:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

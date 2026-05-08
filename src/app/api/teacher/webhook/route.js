import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';

export async function PUT(req) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    
    // Validate token and find user session
    const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
    if (!session || new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token 无效或已过期' }, { status: 401 });
    }

    const { webhookUrl } = await req.json();

    if (typeof webhookUrl !== 'string') {
      return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 });
    }

    db.prepare('UPDATE users SET feishu_webhook = ? WHERE id = ?').run(webhookUrl.trim(), session.user_id);

    return NextResponse.json({ success: true, message: 'Webhook updated successfully' });
  } catch (err) {
    console.error('更新 Webhook 失败:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

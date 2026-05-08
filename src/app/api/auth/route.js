import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../../../lib/auth');

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: '无效的凭证' }, { status: 401 });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // Teacher has multiple IDs now. Return them all, or just let frontend deal with it.
    let teacherIds = [];
    if (user.role === 'teacher') {
      teacherIds = db.prepare('SELECT id FROM teachers WHERE user_id = ?').all(user.id).map(r => r.id);
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
      teacherIds: teacherIds,
    });

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        teacherIds: teacherIds,
      }
    });

    // 设置 cookie
    response.cookies.set('token', token, {
      httpOnly: false,
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('登录错误:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

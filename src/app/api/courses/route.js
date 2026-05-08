import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');

// GET /api/courses — 获取课程列表
export async function GET(request) {
  const user = requireAuth(request, ['boss', 'teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || '';

  let sql = 'SELECT * FROM courses WHERE active = 1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY category, id ASC';

  const courses = db.prepare(sql).all(...params);
  return NextResponse.json({ courses });
}

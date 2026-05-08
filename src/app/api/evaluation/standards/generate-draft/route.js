import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../../../lib/auth');
const { generateHalfYearStandardDrafts } = require('../../../../../lib/rag-service');

export async function POST(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const templateType = String(body.templateType || '').trim();
    const force = !!body.force;
    if (!['quality', 'fitness', 'custom'].includes(templateType)) {
      return NextResponse.json({ error: 'templateType 无效' }, { status: 400 });
    }
    const result = await generateHalfYearStandardDrafts({
      templateType,
      triggerByUserId: user.id,
      force,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: '生成草稿失败: ' + err.message }, { status: 400 });
  }
}


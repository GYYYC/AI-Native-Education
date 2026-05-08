import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../../../lib/auth');
const { listPublishedStandards, rollbackStandardVersion } = require('../../../../../lib/rag-service');

export async function GET(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const templateType = String(searchParams.get('templateType') || '').trim();
  if (!['quality', 'fitness', 'custom'].includes(templateType)) {
    return NextResponse.json({ error: 'templateType 无效' }, { status: 400 });
  }
  const versions = listPublishedStandards({ templateType })
    .map(d => ({ documentId: d.documentId, version: d.metadata?.version || '', title: d.title }))
    .filter(v => String(v.version).trim() !== '');
  return NextResponse.json({ versions });
}

export async function POST(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const templateType = String(body.templateType || '').trim();
    const targetVersion = String(body.targetVersion || '').trim();
    if (!['quality', 'fitness', 'custom'].includes(templateType) || !targetVersion) {
      return NextResponse.json({ error: 'templateType/targetVersion 无效' }, { status: 400 });
    }
    const result = rollbackStandardVersion({ templateType, targetVersion, userId: user.id });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: '回滚失败: ' + err.message }, { status: 400 });
  }
}


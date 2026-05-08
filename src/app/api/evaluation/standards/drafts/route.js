import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../../../lib/auth');
const { listStandardDrafts } = require('../../../../../lib/rag-service');

export async function GET(request) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const templateType = searchParams.get('templateType') || '';
  const status = searchParams.get('status') || 'draft';
  const drafts = listStandardDrafts({ templateType: templateType || undefined, status: status || undefined });
  return NextResponse.json({ drafts });
}


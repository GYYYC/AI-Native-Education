import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../../../../lib/auth');
const { publishStandardDraft, rejectStandardDraft } = require('../../../../../../lib/rag-service');

export async function POST(request, { params }) {
  const user = requireAuth(request, ['boss']);
  if (!user) return NextResponse.json({ error: '仅boss可操作' }, { status: 401 });

  const documentId = String(params.id || '').trim();
  if (!documentId) return NextResponse.json({ error: 'documentId 无效' }, { status: 400 });

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    if (action === 'publish') {
      const result = publishStandardDraft({ documentId, userId: user.id });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === 'reject') {
      const reason = String(body.reason || '').trim();
      const result = rejectStandardDraft({ documentId, userId: user.id, reason });
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ error: 'action 无效' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: '操作失败: ' + err.message }, { status: 400 });
  }
}


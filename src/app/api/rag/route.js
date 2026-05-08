import { NextResponse } from 'next/server';
const { requireAuth } = require('../../../lib/auth');
const { ragQuery, addDocument, listDocuments, deleteDocument, getDocumentContent } = require('../../../lib/rag-service');


// POST - RAG 问答 or 上传文档
export async function POST(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const body = await request.json();

  // 上传文档模式
  if (body.action === 'upload') {
    const { title, content, documentId, docType = 'general', metadata = {} } = body;
    if (!title || !content) return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 });
    if (docType === 'evaluation_standard') {
      const templateType = String(metadata?.template_type || '').trim();
      const dimKey = String(metadata?.dim_key || '').trim();
      const version = String(metadata?.version || '').trim();
      const ownerScope = String(metadata?.owner_scope || '').trim();
      if (!templateType || !['quality', 'fitness', 'custom'].includes(templateType)) {
        return NextResponse.json({ error: 'evaluation_standard 文档必须携带有效 metadata.template_type' }, { status: 400 });
      }
      if (!dimKey) {
        return NextResponse.json({ error: 'evaluation_standard 文档必须携带 metadata.dim_key' }, { status: 400 });
      }
      if (!version) {
        return NextResponse.json({ error: 'evaluation_standard 文档必须携带 metadata.version' }, { status: 400 });
      }
      if (ownerScope !== 'org_private') {
        return NextResponse.json({ error: 'evaluation_standard 文档必须携带 metadata.owner_scope=org_private' }, { status: 400 });
      }
    }

    const chunkCount = await addDocument(
      title,
      content,
      documentId || `doc_${Date.now()}`,
      { docType, metadata }
    );
    return NextResponse.json({ success: true, chunkCount });
  }

  // 问答模式
  const { question } = body;
  if (!question) return NextResponse.json({ error: '问题不能为空' }, { status: 400 });

  try {
    const result = await ragQuery(question);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'RAG 问答失败: ' + err.message }, { status: 500 });
  }
}

// GET - 获取文档列表或特定文档内容
export async function GET(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get('documentId');
  if (documentId) {
    try {
        const content = getDocumentContent(documentId);
        return NextResponse.json({ content });
    } catch (e) {
        return NextResponse.json({ error: '获取文档内容失败: ' + e.message }, { status: 500 });
    }
  }

  const docType = searchParams.get('docType');
  let docs = listDocuments();
  if (docType) docs = docs.filter(d => d.docType === docType);
  return NextResponse.json({ documents: docs });
}

// DELETE - 删除文档
export async function DELETE(request) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { documentId } = await request.json();
  deleteDocument(documentId);
  return NextResponse.json({ success: true });
}

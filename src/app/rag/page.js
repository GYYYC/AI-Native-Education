'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

export default function RAGPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'ai', content: '👋 你好！我是基于 DeepSeek 的智能问答助手。\n\n你可以：\n• 上传教学材料、专业评定标准\n• 然后直接提问，我会根据这些知识为您提供专业分析\n\n点击右上角“知识库管理”即可开始配置。' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [showDocsView, setShowDocsView] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ 
    title: '', 
    content: '', 
    docType: 'general',
    metadata: {
        template_type: 'fitness',
        dim_key: 'technique',
        exercise_type: '',
        version: '1',
        owner_scope: 'org_private'
    }
  });
  const [uploading, setUploading] = useState(false);

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'auto', 'manual', 'standard'
  
  // View Document state
  const [viewingDoc, setViewingDoc] = useState(null);

  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (!u) { router.push('/'); return; }
    setUser(u);
    loadDocs();
  }, []);

  async function loadDocs() {
    const res = await fetch('/api/rag', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setDocuments(data.documents || []);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ question: userMsg }),
      });
      const data = await res.json();
      if (res.ok) {
        let content = data.answer;
        if (data.sources?.length) {
          content += `\n\n📚 参考文档：${data.sources.join('、')}`;
        }
        setMessages(m => [...m, { role: 'ai', content }]);
      } else {
        setMessages(m => [...m, { role: 'ai', content: '❌ 出错了：' + (data.error || '未知错误') }]);
      }
    } catch {
      setMessages(m => [...m, { role: 'ai', content: '❌ 网络错误，请重试' }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    setUploading(true);
    const payload = { 
        action: 'upload', 
        title: uploadForm.title, 
        content: uploadForm.content, 
        documentId: `doc_${Date.now()}`,
        docType: uploadForm.docType,
        metadata: uploadForm.docType === 'evaluation_standard' ? uploadForm.metadata : {}
    };

    const res = await fetch('/api/rag', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`✅ 上传成功，共切分为 ${data.chunkCount} 个知识片段`);
      setShowUpload(false);
      setUploadForm({ 
        title: '', 
        content: '', 
        docType: 'general',
        metadata: { template_type: 'fitness', dim_key: 'technique', exercise_type: '', version: '1', owner_scope: 'org_private' } 
      });
      loadDocs();
    } else {
      alert('❌ 上传失败: ' + data.error);
    }
    setUploading(false);
  }

  async function deleteDoc(docId) {
    if (!confirm('确认删除此文档？')) return;
    await fetch('/api/rag', { method: 'DELETE', headers: headers(), body: JSON.stringify({ documentId: docId }) });
    loadDocs();
  }

  async function viewDocumentContent(doc) {
    try {
        const res = await fetch(`/api/rag?documentId=${doc.documentId}`, { headers: headers() });
        const data = await res.json();
        if (data.content) {
            setViewingDoc({ ...doc, content: data.content });
        } else {
            alert('获取内容失败：' + (data.error || '未知错误'));
        }
    } catch {
        alert('网络错误');
    }
  }

  if (!user) return null;

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 8px rgba(99,102,241,0.4))' }}>🤖</span> 
              <span>AI 知识库智能问答</span>
            </h2>
            <p>基于 DeepSeek 大模型的 RAG 教学辅助系统</p>
          </div>
          <button className="btn btn-secondary" onClick={() => setShowDocsView(true)}>
            📚 知识库管理
          </button>
        </div>
        <div className="page-body">

          {/* Chat */}
          <div className="chat-container">
            <div className="chat-messages" ref={el => el && (el.scrollTop = el.scrollHeight)}>
              {messages.map((m, i) => (
                <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
              ))}
              {loading && (
                <div className="chat-bubble ai">
                  <span className="loading-spinner"></span> AI 思考中...
                </div>
              )}
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                placeholder="输入问题，按 Enter 发送..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                disabled={loading}
              />
              <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !input.trim()}>发送</button>
            </div>
          </div>

          {/* Document Management Modal */}
          {showDocsView && (
            <div className="modal-overlay" onClick={() => setShowDocsView(false)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
                <div className="modal-header" style={{ marginBottom: 16 }}>
                  <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))' }}>📚</span>
                    <span>知识库管理</span>
                  </h3>
                  <button className="modal-close" onClick={() => setShowDocsView(false)}>×</button>
                </div>

                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input 
                        type="text" 
                        className="form-input" 
                        placeholder="🔍 搜索标题..." 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ flex: 1, minWidth: '150px' }}
                    />
                    <select className="form-input custom-select" style={{ width: '130px', color: '#fff', background: '#1e293b' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                        <option value="all" style={{ background: '#1e293b', color: '#fff' }}>全部类型</option>
                        <option value="auto" style={{ background: '#1e293b', color: '#fff' }}>🤖 自动积累</option>
                        <option value="manual" style={{ background: '#1e293b', color: '#fff' }}>📄 手动上传</option>
                        <option value="standard" style={{ background: '#1e293b', color: '#fff' }}>⚖️ 专业标准</option>
                    </select>
                </div>
                
                <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 16 }} onClick={() => setShowUpload(true)}>
                    ＋ 上传新文档
                  </button>
                  {documents.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                      暂无文档，请上传教学材料开始使用
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
                        共 {documents.length} 篇文档（🤖 自动积累 {documents.filter(d => d.source === 'auto').length} / 📄 手动 {documents.filter(d => d.source !== 'auto' && d.docType !== 'evaluation_standard').length} / ⚖️ 标准 {documents.filter(d => d.docType === 'evaluation_standard').length}）
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {documents.filter(d => {
                            if (filterType === 'auto' && d.source !== 'auto') return false;
                            if (filterType === 'manual' && (d.source === 'auto' || d.docType === 'evaluation_standard')) return false;
                            if (filterType === 'standard' && d.docType !== 'evaluation_standard') return false;
                            if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                            return true;
                        }).map(doc => (
                          <div key={doc.documentId} style={{ padding: '14px', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{doc.title}</div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => viewDocumentContent(doc)}>👁️ 查看</button>
                                    <button className="btn btn-sm btn-danger" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => deleteDoc(doc.documentId)}>🗑️ 删除</button>
                                </div>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span>{doc.chunkCount} 个相关片段</span>
                              <span className={`badge ${doc.source === 'auto' ? 'badge-purple' : (doc.docType === 'evaluation_standard' ? 'badge-blue' : 'badge-green')}`}>
                                {doc.source === 'auto' ? '🤖 自动积累' : (doc.docType === 'evaluation_standard' ? '⚖️ 专业标准' : '📄 手动上传')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* View Document Modal */}
          {viewingDoc && (
            <div className="modal-overlay" onClick={() => setViewingDoc(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, width: '90%' }}>
                <div className="modal-header" style={{ marginBottom: 16 }}>
                  <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>👁️ 查看文档</span>
                  </h3>
                  <button className="modal-close" onClick={() => setViewingDoc(null)}>×</button>
                </div>
                
                <div style={{ marginBottom: 16, padding: '12px', background: 'var(--bg-background)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{viewingDoc.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                        <span>标签：{viewingDoc.source === 'auto' ? '🤖 自动积累' : (viewingDoc.docType === 'evaluation_standard' ? '⚖️ 专业标准' : '📄 手动上传')}</span>
                        <span>片段数：{viewingDoc.chunkCount}</span>
                    </div>
                </div>

                <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '16px', background: '#1e293b', borderRadius: 8, border: '1px solid #334155' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e2e8f0', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}>
                    {viewingDoc.content}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Upload Modal */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => setShowUpload(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))' }}>📄</span>
                <span>上传知识文档</span>
              </span>
              <button className="modal-close" onClick={() => setShowUpload(false)}>✕</button>
            </div>
            <form onSubmit={handleUpload}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">文档标题 *</label>
                    <input className="form-input" style={{ color: '#fff' }} placeholder="如：瑜伽山式评定标准" value={uploadForm.title} onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))} required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">类型</label>
                    <select className="form-input custom-select" style={{ color: '#fff' }} value={uploadForm.docType} onChange={e => setUploadForm(f => ({ ...f, docType: e.target.value }))}>
                        <option value="general" style={{ background: '#1e293b' }}>📄 普通资料</option>
                        <option value="evaluation_standard" style={{ background: '#1e293b' }}>⚖️ 评定标准 (专业模式)</option>
                    </select>
                </div>
              </div>

              {uploadForm.docType === 'evaluation_standard' && (
                <div style={{ padding: 14, border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, marginBottom: 16, background: 'rgba(59,130,246,0.08)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 16 }}>⚙️</span> 标准元数据设置
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label text-xs" style={{ color: '#94a3b8' }}>适用模板</label>
                            <select className="form-input custom-select" style={{ background: '#1e293b', border: '1px solid #334155', color: '#fff' }} value={uploadForm.metadata.template_type} onChange={e => setUploadForm(f => ({ ...f, metadata: { ...f.metadata, template_type: e.target.value, dim_key: e.target.value === 'fitness' ? 'technique' : 'focus' } }))}>
                                <option value="fitness" style={{ background: '#1e293b' }}>体能评定 (Fitness)</option>
                                <option value="quality" style={{ background: '#1e293b' }}>素质评定 (Quality)</option>
                            </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label text-xs" style={{ color: '#94a3b8' }}>对应能力维度 Key</label>
                            <select className="form-input custom-select" style={{ background: '#1e293b', border: '1px solid #334155', color: '#fff' }} value={uploadForm.metadata.dim_key} onChange={e => setUploadForm(f => ({ ...f, metadata: { ...f.metadata, dim_key: e.target.value } }))}>
                                {uploadForm.metadata.template_type === 'fitness' ? (
                                    <>
                                        <option value="technique" style={{ background: '#1e293b' }}>技术规范度 (technique)</option>
                                        <option value="stability" style={{ background: '#1e293b' }}>核心稳定性 (stability)</option>
                                        <option value="flexibility" style={{ background: '#1e293b' }}>柔韧性 (flexibility)</option>
                                        <option value="strength" style={{ background: '#1e293b' }}>力量表现 (strength)</option>
                                    </>
                                ) : (
                                    <>
                                        <option value="focus" style={{ background: '#1e293b' }}>专注度 (focus)</option>
                                        <option value="expression" style={{ background: '#1e293b' }}>表达力 (expression)</option>
                                        <option value="creativity" style={{ background: '#1e293b' }}>创造力 (creativity)</option>
                                        <option value="interaction" style={{ background: '#1e293b' }}>互动协作 (interaction)</option>
                                    </>
                                )}
                            </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label text-xs" style={{ color: '#94a3b8' }}>指定动作类型 (选填)</label>
                            <input className="form-input" style={{ background: '#1e293b', border: '1px solid #334155', color: '#fff' }} placeholder="如：Yoga / 瑜伽" value={uploadForm.metadata.exercise_type} onChange={e => setUploadForm(f => ({ ...f, metadata: { ...f.metadata, exercise_type: e.target.value } }))} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label text-xs" style={{ color: '#94a3b8' }}>版本号</label>
                            <input className="form-input" style={{ background: '#1e293b', border: '1px solid #334155', color: '#fff' }} value={uploadForm.metadata.version} onChange={e => setUploadForm(f => ({ ...f, metadata: { ...f.metadata, version: e.target.value } }))} />
                        </div>
                    </div>
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 6, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                        💡 <b>专业提示</b>：设置为“评定标准”后，AI 在为学生生成评分报告时会严格参考此文档中的规则。
                    </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">文档内容 *</label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: uploadForm.docType === 'evaluation_standard' ? 200 : 300, color: '#fff' }}
                  placeholder="请输入标准详情，建议包含：\n1. 满分要求\n2. 扣分项\n3. 常见错误示例..."
                  value={uploadForm.content}
                  onChange={e => setUploadForm(f => ({ ...f, content: e.target.value }))}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowUpload(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={uploading}>{uploading ? '上传中...' : '📤 上传'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

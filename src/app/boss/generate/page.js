'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import HexagonRadar from '@/components/HexagonRadar';

const DOC_TYPE_LABELS = { lesson_plan: '教案', exam_paper: '考卷', assessment_standard: '考核标准' };
const HEX_LABELS = { quality: '素质六边形', fitness: '体能六边形' };
const UPLOAD_TYPE_LABELS = { exam_paper: '试卷', video: '视频', image: '图片' };

export default function GenerateCenterPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('frameworks');

  // Frameworks state
  const [frameworks, setFrameworks] = useState([]);
  const [editingFw, setEditingFw] = useState(null);
  const [fwFilterType, setFwFilterType] = useState('');

  // Generation state
  const [genTopic, setGenTopic] = useState('');
  const [genDocType, setGenDocType] = useState('lesson_plan');
  const [genFrameworkId, setGenFrameworkId] = useState('');
  const [genCourseId, setGenCourseId] = useState('');
  const [genHexType, setGenHexType] = useState('quality');
  const [genBaseDocId, setGenBaseDocId] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [genDocs, setGenDocs] = useState([]);
  const [genViewDoc, setGenViewDoc] = useState(null);

  // Assessment state
  const [assessStudentId, setAssessStudentId] = useState('');
  const [assessCourseId, setAssessCourseId] = useState('');
  const [assessHexType, setAssessHexType] = useState('quality');
  const [assessUploadType, setAssessUploadType] = useState('image');
  const [assessGenDocId, setAssessGenDocId] = useState('');
  const [assessBusy, setAssessBusy] = useState(false);
  const [assessResult, setAssessResult] = useState(null);

  // Results state
  const [resultUploads, setResultUploads] = useState([]);
  const [resultView, setResultView] = useState(null);

  // Shared
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
  }), []);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (!u || u.role !== 'boss') { router.push('/'); return; }
    setUser(u);
    loadFrameworks();
    loadStudents();
    loadCourses();
    loadGenDocs();
    loadResults();
  }, []);

  async function loadFrameworks(type = '') {
    const res = await fetch(`/api/boss/frameworks${type ? `?type=${type}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setFrameworks(data.frameworks || []);
  }

  async function loadStudents() {
    const res = await fetch('/api/students', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setStudents(data.students || []);
  }

  async function loadCourses() {
    const res = await fetch('/api/courses', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setCourses(data.courses || []);
  }

  async function loadGenDocs() {
    const res = await fetch('/api/boss/generate', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setGenDocs(data.documents || []);
  }

  async function loadResults() {
    const res = await fetch('/api/boss/assessment', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    setResultUploads(data.uploads || []);
  }

  async function saveFramework() {
    if (!editingFw) return;
    const method = editingFw.id ? 'PUT' : 'POST';
    const body = editingFw.id
      ? { id: editingFw.id, name: editingFw.name, contentTemplate: editingFw.content_template, hexagonType: editingFw.hexagon_type }
      : { name: editingFw.name, frameworkType: editingFw.framework_type, hexagonType: editingFw.hexagon_type || null, contentTemplate: editingFw.content_template };
    await fetch('/api/boss/frameworks', { method, headers: headers(), body: JSON.stringify(body) });
    setEditingFw(null);
    loadFrameworks(fwFilterType);
  }

  async function handleGenerate() {
    if (!genTopic || !genFrameworkId) return alert('请填写主题并选择框架');
    setGenBusy(true);
    setGenResult(null);
    try {
      const res = await fetch('/api/boss/generate', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          topic: genTopic,
          frameworkId: parseInt(genFrameworkId),
          docType: genDocType,
          courseId: genCourseId ? parseInt(genCourseId) : null,
          hexagonType: genHexType,
          baseDocId: genBaseDocId ? parseInt(genBaseDocId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setGenResult(data.document);
      loadGenDocs();
    } catch (err) {
      alert('❌ ' + err.message);
    } finally {
      setGenBusy(false);
    }
  }

  async function handleApproveDoc(docId) {
    await fetch('/api/boss/generate', { method: 'PUT', headers: headers(), body: JSON.stringify({ id: docId, status: 'approved' }) });
    loadGenDocs();
    setGenViewDoc(null);
  }

  async function handleAssessUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const mimeType = file.type || 'image/jpeg';
      if (!assessStudentId) return alert('请先选择学生');

      setAssessBusy(true);
      setAssessResult(null);
      try {
        const res = await fetch('/api/boss/assessment', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            studentId: parseInt(assessStudentId),
            courseId: assessCourseId ? parseInt(assessCourseId) : null,
            hexagonType: assessHexType,
            uploadType: assessUploadType,
            imageBase64: base64,
            mimeType,
            generatedDocId: assessGenDocId ? parseInt(assessGenDocId) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '评估失败');
        setAssessResult(data);
        loadResults();
      } catch (err) {
        alert('❌ ' + err.message);
      } finally {
        setAssessBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  if (!user) return null;

  const tabs = [
    { key: 'frameworks', label: '📁 框架管理', icon: '📁' },
    { key: 'generate', label: '🤖 AI 生成', icon: '🤖' },
    { key: 'assess', label: '📤 上传评估', icon: '📤' },
    { key: 'results', label: '📊 评估结果', icon: '📊' },
  ];

  const filteredFrameworks = fwFilterType ? frameworks.filter(f => f.framework_type === fwFilterType) : frameworks;

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 8px rgba(99,102,241,0.4))' }}>📋</span> 
              <span>教学生成中心</span>
            </h2>
            <p>教案/考卷/考核标准 AI 智能生成与多模态自动分析打分</p>
          </div>
        </div>
        <div className="page-body">

          {/* Tab 切换 */}
          <div className="tab-nav">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ====== Tab 1: 框架管理 ====== */}
          {tab === 'frameworks' && (
            <div className="card">
              <div className="card-title flex items-center justify-between">
                <div>
                  <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>📁</span>
                  框架模板管理
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="form-input" value={fwFilterType} onChange={e => { setFwFilterType(e.target.value); loadFrameworks(e.target.value); }} style={{ width: 'auto' }}>
                    <option value="">全部类型</option>
                    <option value="lesson_plan">教案</option>
                    <option value="exam_paper">考卷</option>
                    <option value="assessment_standard">考核标准</option>
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={() => setEditingFw({ name: '', framework_type: 'lesson_plan', hexagon_type: '', content_template: '' })}>+ 新增框架</button>
                </div>
              </div>

              {editingFw && (
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <input className="form-input" placeholder="框架名称" value={editingFw.name} onChange={e => setEditingFw({ ...editingFw, name: e.target.value })} />
                    {!editingFw.id && (
                      <select className="form-input" value={editingFw.framework_type} onChange={e => setEditingFw({ ...editingFw, framework_type: e.target.value })}>
                        <option value="lesson_plan">教案</option>
                        <option value="exam_paper">考卷</option>
                        <option value="assessment_standard">考核标准</option>
                      </select>
                    )}
                    <select className="form-input" value={editingFw.hexagon_type || ''} onChange={e => setEditingFw({ ...editingFw, hexagon_type: e.target.value })}>
                      <option value="">不限六边形</option>
                      <option value="quality">素质六边形</option>
                      <option value="fitness">体能六边形</option>
                    </select>
                  </div>
                  <textarea
                    className="form-input"
                    rows={12}
                    placeholder="框架模板内容（AI 将严格按此结构生成内容）"
                    value={editingFw.content_template}
                    onChange={e => setEditingFw({ ...editingFw, content_template: e.target.value })}
                    style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={saveFramework}>保存</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingFw(null)}>取消</button>
                  </div>
                </div>
              )}

              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {filteredFrameworks.length === 0 ? (
                  <div className="empty-state"><p>暂无框架模板</p></div>
                ) : filteredFrameworks.map(fw => (
                  <div key={fw.id} className="alert-item" style={{ cursor: 'pointer' }} onClick={() => setEditingFw({ ...fw })}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{fw.name}</span>
                        <span className="badge badge-purple" style={{ marginLeft: 8 }}>{DOC_TYPE_LABELS[fw.framework_type] || fw.framework_type}</span>
                        {fw.hexagon_type && <span className="badge badge-blue" style={{ marginLeft: 4 }}>{HEX_LABELS[fw.hexagon_type]}</span>}
                      </div>
                      <span className="text-sm text-muted">点击编辑</span>
                    </div>
                    <div className="text-sm text-muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                      {fw.content_template?.slice(0, 150)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ====== Tab 2: AI 生成 ====== */}
          {tab === 'generate' && (
            <div className="grid-2" style={{ gap: 20 }}>
              <div className="card">
                <div className="card-title">
                  <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>🤖</span>
                  AI 智能内容生成
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="text-sm text-muted">生成类型</label>
                    <select className="form-input" value={genDocType} onChange={e => setGenDocType(e.target.value)}>
                      <option value="lesson_plan">教案</option>
                      <option value="exam_paper">考卷</option>
                      <option value="assessment_standard">考核标准</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-muted">选择框架模板</label>
                    <select className="form-input" value={genFrameworkId} onChange={e => setGenFrameworkId(e.target.value)}>
                      <option value="">请选择框架</option>
                      {frameworks.filter(f => f.framework_type === genDocType).map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  {genDocType === 'assessment_standard' && (
                    <div>
                      <label className="text-sm text-muted">六边形类型</label>
                      <select className="form-input" value={genHexType} onChange={e => setGenHexType(e.target.value)}>
                        <option value="quality">素质六边形</option>
                        <option value="fitness">体能六边形</option>
                      </select>
                    </div>
                  )}
                  {(genDocType === 'exam_paper' || genDocType === 'assessment_standard') && (
                    <div>
                      <label className="text-sm text-muted">关联教案（可选）</label>
                      <select className="form-input" value={genBaseDocId} onChange={e => setGenBaseDocId(e.target.value)}>
                        <option value="">不关联教案</option>
                        {genDocs.filter(d => d.doc_type === 'lesson_plan' && d.status === 'approved').map(d => (
                          <option key={d.id} value={d.id}>{d.title}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-sm text-muted">关联课程（可选）</label>
                    <select className="form-input" value={genCourseId} onChange={e => setGenCourseId(e.target.value)}>
                      <option value="">不限课程</option>
                      {courses.map(c => <option key={c.id} value={c.id}>{c.name}（{c.category === 'arts' ? '素质' : c.category === 'fitness' ? '体能' : '其他'}）</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-muted">输入主题/观点</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      placeholder="例如：瑜伽体前屈教学、少儿编程入门Scratch..."
                      value={genTopic}
                      onChange={e => setGenTopic(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary" disabled={genBusy} onClick={handleGenerate}>
                    {genBusy ? '⏳ AI 正在生成...' : '🚀 开始生成'}
                  </button>
                </div>

                {genResult && (
                  <div style={{ marginTop: 16, background: 'var(--bg-tertiary)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>✅ 生成成功：{genResult.title}</div>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, maxHeight: 300, overflowY: 'auto', color: 'var(--text-primary)' }}>
                      {genResult.content}
                    </pre>
                    {genResult.scoringRubric && (
                      <div style={{ marginTop: 12, padding: 10, background: 'rgba(108,92,231,0.1)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>📝 主观题评分细则（请审核）</div>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }}>{genResult.scoringRubric}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-title">
                  <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>📄</span>
                  已生成文档库
                </div>
                <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                  {genDocs.length === 0 ? (
                    <div className="empty-state"><p>暂无已生成文档</p></div>
                  ) : genDocs.map(doc => (
                    <div key={doc.id} className="alert-item" onClick={() => setGenViewDoc(doc)} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{doc.title}</span>
                        <span className={`badge ${doc.status === 'approved' ? 'badge-green' : 'badge-orange'}`}>
                          {doc.status === 'approved' ? '已审核' : doc.status === 'archived' ? '已归档' : '待审核'}
                        </span>
                      </div>
                      <div className="text-sm text-muted">
                        {DOC_TYPE_LABELS[doc.doc_type]} · {doc.framework_name || '-'} · {new Date(doc.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>

                {genViewDoc && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
                    onClick={() => setGenViewDoc(null)}>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 24, width: '80%', maxWidth: 800, maxHeight: '80vh', overflow: 'auto' }}
                      onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ margin: 0 }}>{genViewDoc.title}</h3>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {genViewDoc.status === 'draft' && (
                            <button className="btn btn-primary btn-sm" onClick={() => handleApproveDoc(genViewDoc.id)}>✅ 审核通过</button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => setGenViewDoc(null)}>关闭</button>
                        </div>
                      </div>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7 }}>{genViewDoc.content}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== Tab 3: 上传评估 ====== */}
          {tab === 'assess' && (
            <div className="card">
              <div className="card-title">
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>📤</span>
                上传文件与 AI 自动评估
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div>
                  <label className="text-sm text-muted">选择学生 *</label>
                  <select className="form-input" value={assessStudentId} onChange={e => setAssessStudentId(e.target.value)}>
                    <option value="">请选择学生</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}（{s.class_name || '-'}）</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted">选择课程</label>
                  <select className="form-input" value={assessCourseId} onChange={e => setAssessCourseId(e.target.value)}>
                    <option value="">不限课程</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted">六边形类型 *</label>
                  <select className="form-input" value={assessHexType} onChange={e => setAssessHexType(e.target.value)}>
                    <option value="quality">素质六边形</option>
                    <option value="fitness">体能六边形</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted">上传类型 *</label>
                  <select className="form-input" value={assessUploadType} onChange={e => setAssessUploadType(e.target.value)}>
                    <option value="image">图片（作品/动作截图）</option>
                    <option value="video">视频（~90秒动作录像）</option>
                    <option value="exam_paper">试卷（需判分出总分）</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted">关联考卷文档（试卷类型可选）</label>
                  <select className="form-input" value={assessGenDocId} onChange={e => setAssessGenDocId(e.target.value)}>
                    <option value="">无关联</option>
                    {genDocs.filter(d => d.doc_type === 'exam_paper' && d.status === 'approved').map(d => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: 30, textAlign: 'center', position: 'relative' }}>
                {assessBusy ? (
                  <div>
                    <span className="loading-spinner" style={{ display: 'inline-block', marginBottom: 8 }}></span>
                    <div style={{ fontSize: 14 }}>⏳ AI 正在分析评估中，请稍候...</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📎</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>点击或拖拽上传 试卷图片/视频/作品图片</div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      onChange={handleAssessUpload}
                    />
                  </div>
                )}
              </div>

              {assessResult && (
                <div style={{ marginTop: 20 }}>
                  <div className="card-title">✅ 评估完成</div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <HexagonRadar
                      scores={assessResult.scores?.map(s => s.score) || []}
                      labels={assessResult.scores?.map(s => s.dim_name) || []}
                      title={`${HEX_LABELS[assessHexType]} 评分`}
                      color={assessHexType === 'quality' ? '#6c5ce7' : '#00b894'}
                    />
                    <div style={{ flex: 1, minWidth: 300 }}>
                      {assessResult.totalScore != null && (
                        <div style={{ padding: '10px 16px', background: 'rgba(108,92,231,0.1)', borderRadius: 10, marginBottom: 12 }}>
                          <span className="text-sm text-muted">试卷总分：</span>
                          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-blue)' }}>{assessResult.totalScore}</span>
                        </div>
                      )}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>AI 分析</div>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{assessResult.aiSuggestion}</pre>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>📬 个性化建议（已推送飞书）</div>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>{assessResult.personalizedSuggestion}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== Tab 4: 评估结果 ====== */}
          {tab === 'results' && (
            <div className="card">
              <div className="card-title">
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>📊</span>
                历史分析结果记录
              </div>
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                {resultUploads.length === 0 ? (
                  <div className="empty-state"><p>暂无评估记录</p></div>
                ) : resultUploads.map(u => (
                  <div key={u.id} className="alert-item" style={{ cursor: 'pointer' }} onClick={() => setResultView(resultView?.id === u.id ? null : u)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{u.student_name}</span>
                        <span className="badge badge-purple" style={{ marginLeft: 8 }}>{u.course_name || '-'}</span>
                        <span className="badge badge-blue" style={{ marginLeft: 4 }}>{UPLOAD_TYPE_LABELS[u.upload_type]}</span>
                        <span className={`badge ${u.status === 'completed' ? 'badge-green' : u.status === 'failed' ? 'badge-red' : 'badge-orange'}`} style={{ marginLeft: 4 }}>
                          {u.status === 'completed' ? '已完成' : u.status === 'failed' ? '失败' : '进行中'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.feishu_sent ? <span className="tag">✅ 飞书已推送</span> : <span className="tag">⏳ 待推送</span>}
                        <span className="text-sm text-muted">{new Date(u.created_at).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                    {u.total_score != null && (
                      <div className="text-sm" style={{ marginTop: 4 }}>总分：<span style={{ fontWeight: 700 }}>{u.total_score}</span></div>
                    )}

                    {resultView?.id === u.id && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <HexagonRadar
                            scores={u.hexScores?.map(s => s.score) || []}
                            labels={u.hexScores?.map(s => s.dim_name) || []}
                            title={`${HEX_LABELS[u.hexagon_type]} 评分`}
                            color={u.hexagon_type === 'quality' ? '#6c5ce7' : '#00b894'}
                            size={180}
                          />
                          <div style={{ flex: 1, minWidth: 280 }}>
                            {u.ai_suggestion && (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>AI 分析</div>
                                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{u.ai_suggestion}</pre>
                              </div>
                            )}
                            {u.personalized_suggestion && (
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>📬 个性化建议</div>
                                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}>{u.personalized_suggestion}</pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

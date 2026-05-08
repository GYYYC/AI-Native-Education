'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

function ScoreChart({ records }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || records.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padding = { top: 24, right: 30, bottom: 30, left: 42 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;
    ctx.clearRect(0, 0, W, H);

    const values = records.map(r => (r.score / r.total_score) * 100);
    const minY = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 10);
    const maxY = Math.min(100, Math.ceil(Math.max(...values) / 10) * 10 + 10);
    const rangeY = maxY - minY || 10;
    const toX = i => padding.left + (i / (records.length - 1 || 1)) * chartW;
    const toY = v => padding.top + (1 - (v - minY) / rangeY) * chartH;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let g = 0; g <= 4; g++) {
      const y = padding.top + (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    records.forEach((r, i) => {
      const x = toX(i);
      const y = toY((r.score / r.total_score) * 100);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [records]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 260, display: 'block' }} />;
}

function RadarHex({ title, items = [], color = '#10b981' }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 88;
  const safe = Array.from({ length: 6 }).map((_, i) => items[i] || { label: `维度${i + 1}`, score: 0 });
  const points = safe.map((it, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const r = (Math.max(0, Math.min(5, Number(it.score || 0))) / 5) * radius;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
  const labels = safe.map((it, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return { x: cx + Math.cos(angle) * (radius + 22), y: cy + Math.sin(angle) * (radius + 22), text: it.label || `维度${i + 1}` };
  });
  const poly = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="card" style={{ minHeight: 330 }}>
      <div className="card-title">{title}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ margin: '0 auto', display: 'block' }}>
        {[1, 2, 3, 4, 5].map(level => {
          const rr = (level / 5) * radius;
          const ring = Array.from({ length: 6 }).map((_, i) => {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
          }).join(' ');
          return <polygon key={level} points={ring} fill="none" stroke="rgba(255,255,255,0.08)" />;
        })}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * radius} y2={cy + Math.sin(a) * radius} stroke="rgba(255,255,255,0.12)" />;
        })}
        <polygon points={poly} fill={color + '33'} stroke={color} strokeWidth="2" />
        {labels.map((l, i) => <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{l.text}</text>)}
      </svg>
    </div>
  );
}

export default function StudentDetail() {
  const router = useRouter();
  const params = useParams();
  const [user, setUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [examRecords, setExamRecords] = useState([]);
  const [wrongQuestions, setWrongQuestions] = useState([]);
  const [studentCourses, setStudentCourses] = useState([]);
  const [evaluationSessions, setEvaluationSessions] = useState([]);
  const [studentAlerts, setStudentAlerts] = useState([]);
  const [courseAnalysis, setCourseAnalysis] = useState({ courseList: [], selectedCourseDefault: '', courseMetrics: {} });
  const [radarGuard, setRadarGuard] = useState({
    quality: { standardReady: false, hasFinalSession: false, canDisplay: false, missingDimKeys: [] },
    fitness: { standardReady: false, hasFinalSession: false, canDisplay: false, missingDimKeys: [] },
  });
  const [activeCourseKey, setActiveCourseKey] = useState('');
  const [radarData, setRadarData] = useState({
    quality: { items: [] },
    fitness: { items: [] },
    qualityComposite: { items: [] },
    fitnessComposite: { items: [] },
    qualitySessions: [],
    fitnessSessions: [],
  });
  const [qualityDraft, setQualityDraft] = useState(Array.from({ length: 6 }).map(() => ({ label: '', dimKey: '' })));
  const [fitnessDraft, setFitnessDraft] = useState(Array.from({ length: 6 }).map(() => ({ label: '', dimKey: '' })));
  const [editingRadar, setEditingRadar] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [analyzing, setAnalyzing] = useState(false);
  const [latestAnalysis, setLatestAnalysis] = useState('');
  const [runningEval, setRunningEval] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deletingStudent, setDeletingStudent] = useState(false);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (!u) return router.push('/');
    setUser(u);
    loadStudent();
    loadTemplates();
  }, [params.id]);

  useEffect(() => {
    const q = radarData.quality?.items || [];
    const f = radarData.fitness?.items || [];
    setQualityDraft(Array.from({ length: 6 }).map((_, i) => ({ label: q[i]?.label || `素质维度${i + 1}`, dimKey: q[i]?.dimKey || '' })));
    setFitnessDraft(Array.from({ length: 6 }).map((_, i) => ({ label: f[i]?.label || `体能维度${i + 1}`, dimKey: f[i]?.dimKey || '' })));
  }, [radarData]);

  async function loadTemplates() {
    const h = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const res = await fetch('/api/evaluation/templates', { headers: h });
    const data = await res.json();
    if (!res.ok) return;
    setTemplates(data.templates || []);
    if (!selectedTemplateId && (data.templates || []).length > 0) setSelectedTemplateId(String(data.templates[0].id));
  }

  async function loadStudent() {
    setLoading(true);
    const h = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const res = await fetch(`/api/students/${params.id}`, { headers: h });
    if (!res.ok) return router.back();
    const data = await res.json();
    setStudent(data.student);
    setExamRecords(data.examRecords || []);
    setWrongQuestions(data.wrongQuestions || []);
    setStudentCourses(data.studentCourses || []);
    setEvaluationSessions(data.evaluationSessions || []);
    setStudentAlerts(data.studentAlerts || []);
    setCourseAnalysis(data.courseAnalysis || { courseList: [], selectedCourseDefault: '', courseMetrics: {} });
    setRadarGuard(data.radarGuard || {
      quality: { standardReady: false, hasFinalSession: false, canDisplay: false, missingDimKeys: [] },
      fitness: { standardReady: false, hasFinalSession: false, canDisplay: false, missingDimKeys: [] },
    });
    setActiveCourseKey(data.courseAnalysis?.selectedCourseDefault || '');
    setRadarData(data.radarData || {
      quality: { items: [] },
      fitness: { items: [] },
      qualityComposite: { items: [] },
      fitnessComposite: { items: [] },
      qualitySessions: [],
      fitnessSessions: [],
    });
    const withAnalysis = (data.examRecords || []).filter(r => r.ai_analysis);
    setLatestAnalysis(withAnalysis.length > 0 ? withAnalysis[withAnalysis.length - 1].ai_analysis : '');
    setLoading(false);
  }

  async function saveRadarOverrides() {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
    const reqs = [
      fetch(`/api/students/${params.id}/radar-overrides`, { method: 'PUT', headers, body: JSON.stringify({ templateType: 'quality', items: qualityDraft }) }),
      fetch(`/api/students/${params.id}/radar-overrides`, { method: 'PUT', headers, body: JSON.stringify({ templateType: 'fitness', items: fitnessDraft }) }),
    ];
    const [qRes, fRes] = await Promise.all(reqs);
    const qJson = await qRes.json();
    const fJson = await fRes.json();
    if (!qRes.ok || !fRes.ok) return alert(`保存失败：${qJson.error || fJson.error || '未知错误'}`);
    setEditingRadar(false);
    await loadStudent();
    alert('✅ 六边形科目已全局同步，所有学生页面已生效');
  }

  async function triggerAnalysis() {
    setAnalyzing(true);
    const res = await fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ studentId: parseInt(params.id, 10) }),
    });
    const data = await res.json();
    if (res.ok) setLatestAnalysis(data.analysis);
    else alert('❌ 分析失败: ' + (data.error || '未知错误'));
    setAnalyzing(false);
  }

  async function runEvaluation() {
    if (!selectedTemplateId) return alert('请先选择评定模板');
    setRunningEval(true);
    const res = await fetch('/api/evaluation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ studentId: parseInt(params.id, 10), templateId: parseInt(selectedTemplateId, 10), triggerType: 'manual' }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRunningEval(false);
      const missing = Array.isArray(data.missingDimensions) && data.missingDimensions.length
        ? `\n缺失维度：${data.missingDimensions.map(d => d.dim_name || d.dim_key).join('、')}`
        : '';
      return alert('❌ AI评定失败: ' + (data.error || '未知错误') + missing);
    }
    await loadStudent();
    setSelectedSessionId(data.sessionId);
    await loadSessionDetail(data.sessionId);
    setRunningEval(false);
  }

  async function loadSessionDetail(sessionId) {
    const h = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const res = await fetch(`/api/evaluation/sessions/${sessionId}`, { headers: h });
    const data = await res.json();
    if (!res.ok) return alert('加载评定详情失败: ' + (data.error || '未知错误'));
    setSelectedSessionId(sessionId);
    setSelectedSessionDetail(data);
  }

  async function reviewSession(action) {
    if (!selectedSessionId) return;
    setReviewing(true);
    const comment = window.prompt('请输入审核备注（可留空）', '') || '';
    const res = await fetch(`/api/evaluation/sessions/${selectedSessionId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ action, comment, revisedScores: [] }),
    });
    const data = await res.json();
    if (!res.ok) {
      setReviewing(false);
      return alert('审核失败: ' + (data.error || '未知错误'));
    }
    await loadStudent();
    await loadSessionDetail(selectedSessionId);
    setReviewing(false);
  }

  async function finalizeSession() {
    if (!selectedSessionId) return;
    setFinalizing(true);
    const note = window.prompt('请输入最终生效备注（可留空）', '') || '';
    const res = await fetch(`/api/evaluation/sessions/${selectedSessionId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ note }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFinalizing(false);
      return alert('生效失败: ' + (data.error || '未知错误'));
    }
    await loadStudent();
    await loadSessionDetail(selectedSessionId);
    setFinalizing(false);
  }

  async function deleteStudent() {
    if (!student) return;
    const confirmed = window.confirm(`确定删除学生「${student.name}」吗？该操作不可恢复。`);
    if (!confirmed) return;
    setDeletingStudent(true);
    const res = await fetch(`/api/students/${params.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setDeletingStudent(false);
      return alert('删除失败: ' + (data.error || '未知错误'));
    }
    alert('✅ 学生已删除');
    router.back();
  }

  const activeCourse = useMemo(() => {
    const key = activeCourseKey || courseAnalysis.selectedCourseDefault;
    if (key === '__overview__') return null;
    return key ? (courseAnalysis.courseMetrics?.[key] || null) : null;
  }, [activeCourseKey, courseAnalysis]);
  const selectedCourseKey = activeCourseKey || courseAnalysis.selectedCourseDefault;
  const isOverviewMode = selectedCourseKey === '__overview__';
  const qualityBlockedReason = !radarGuard.quality.standardReady
    ? `未配置完整素质RAG标准（缺失：${(radarGuard.quality.missingDimKeys || []).join('、') || '未知'}）`
    : (!radarGuard.quality.hasFinalSession ? '暂无已生效的素质评定结果' : '');
  const fitnessBlockedReason = !radarGuard.fitness.standardReady
    ? `未配置完整体能RAG标准（缺失：${(radarGuard.fitness.missingDimKeys || []).join('、') || '未知'}）`
    : (!radarGuard.fitness.hasFinalSession ? '暂无已生效的体能评定结果' : '');

  if (!user || loading) {
    return <div className="app-layout"><main className="main-content"><div className="loading-overlay"><span className="loading-spinner"></span> 加载中...</div></main></div>;
  }
  if (!student) return null;

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div className="flex items-center gap-3">
            <button className="btn btn-secondary btn-sm" onClick={() => router.back()}>← 返回</button>
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))' }}>👤</span>
                <span>{student.name}</span>
              </h2>
              <p><span className="badge badge-gray">{student.global_student_id || student.student_code}</span> · {student.grade} {student.class_name}</p>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" disabled={deletingStudent} onClick={deleteStudent}>
            {deletingStudent ? '删除中...' : '删除学生'}
          </button>
        </div>

        <div className="page-body">
          <div className="tab-nav">
            {[['overview', '📊 成绩总览'], ['wrong', '📕 错题本'], ['analysis', '🤖 AI分析'], ['evaluation', '🧠 AI评定'], ['info', '👤 全量信息']].map(([v, l]) => (
              <button key={v} className={`tab-btn ${activeTab === v ? 'active' : ''}`} onClick={() => setActiveTab(v)}>{l}</button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">📚 孩子课程列表（点击切换分析）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button className={`btn ${isOverviewMode ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setActiveCourseKey('__overview__')}>
                    总览
                  </button>
                  {(courseAnalysis.courseList || []).map(c => (
                    <button key={c.key} className={`btn ${activeCourseKey === c.key ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setActiveCourseKey(c.key)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {isOverviewMode ? (
                <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
                  {radarGuard.quality.canDisplay
                    ? <RadarHex title="素质综合六边形（多项平均）" items={radarData.qualityComposite?.items || []} color="#a855f7" />
                    : <div className="card"><div className="card-title">素质综合六边形</div><div className="empty-state"><p>{qualityBlockedReason}</p></div></div>}
                  {radarGuard.fitness.canDisplay
                    ? <RadarHex title="体能综合六边形（多项平均）" items={radarData.fitnessComposite?.items || []} color="#22c55e" />
                    : <div className="card"><div className="card-title">体能综合六边形</div><div className="empty-state"><p>{fitnessBlockedReason}</p></div></div>}
                  <div className="card" style={{ gridColumn: '1 / -1' }}>
                    <div className="card-title">⚠️ 按课程分类的异常总览</div>
                    {(courseAnalysis.overview?.groupedAnomalies || []).length === 0 ? (
                      <div className="empty-state"><p>暂无按课程归类的异常</p></div>
                    ) : (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {(courseAnalysis.overview?.groupedAnomalies || []).map(group => (
                          <div key={group.courseKey} className="alert-item">
                            <div style={{ fontWeight: 600 }}>{group.courseName}（{group.alerts.length} 条）</div>
                            {group.alerts.slice(0, 5).map(a => (
                              <div key={a.id} className="text-sm text-muted">- {a.message}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
                  <div className="card">
                    <div className="card-title">📉 当前科目六边形评分</div>
                    {!activeCourse ? (
                      <div className="empty-state"><p>请先选择课程</p></div>
                    ) : (!radarGuard.quality.canDisplay && !radarGuard.fitness.canDisplay) ? (
                      <div className="empty-state"><p>当前未满足RAG标准门禁，六边形已隐藏。</p></div>
                    ) : (
                      <div className="grid-2" style={{ gap: 10 }}>
                        {radarGuard.quality.canDisplay
                          ? <RadarHex title="素质六边形（当前科目）" items={activeCourse.courseRadar?.quality || []} color="#8b5cf6" />
                          : <div className="card"><div className="card-title">素质六边形</div><div className="empty-state"><p>{qualityBlockedReason}</p></div></div>}
                        {radarGuard.fitness.canDisplay
                          ? <RadarHex title="体能六边形（当前科目）" items={activeCourse.courseRadar?.fitness || []} color="#10b981" />
                          : <div className="card"><div className="card-title">体能六边形</div><div className="empty-state"><p>{fitnessBlockedReason}</p></div></div>}
                      </div>
                    )}
                  </div>
                  <div className="card">
                    <div className="card-title">⚠️ 当前科目异常情况</div>
                    {!activeCourse ? <div className="empty-state"><p>请先选择课程</p></div> : (
                      <div>
                        <div className="text-sm text-muted">异常条数：{activeCourse.abnormalAlerts?.length || 0}</div>
                        {(activeCourse.abnormalAlerts || []).slice(0, 8).map(a => (
                          <div key={a.id} className="alert-item">
                            <div>{a.message}</div>
                            <div className="text-sm text-muted">{a.sent_feishu ? '✅ 飞书已发送' : '⏳ 飞书待发送'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div className="card-title">🧭 双六边形评定总览（素质 / 体能）</div>
                {!editingRadar ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingRadar(true)}>编辑六项科目</button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingRadar(false)}>取消</button>
                    <button className="btn btn-primary btn-sm" onClick={saveRadarOverrides}>全局同步六项</button>
                  </div>
                )}
              </div>
              {editingRadar && (
                <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
                  <div className="card">
                    <div className="card-title">素质六项（全局）</div>
                    {qualityDraft.map((it, i) => (
                      <div key={i} className="form-group">
                        <label className="form-label">第{i + 1}项</label>
                        <input className="form-input" value={it.label} onChange={e => setQualityDraft(prev => prev.map((p, idx) => idx === i ? { ...p, label: e.target.value } : p))} />
                      </div>
                    ))}
                  </div>
                  <div className="card">
                    <div className="card-title">体能六项（全局）</div>
                    {fitnessDraft.map((it, i) => (
                      <div key={i} className="form-group">
                        <label className="form-label">第{i + 1}项</label>
                        <input className="form-input" value={it.label} onChange={e => setFitnessDraft(prev => prev.map((p, idx) => idx === i ? { ...p, label: e.target.value } : p))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'wrong' && (
            <div>{wrongQuestions.length === 0 ? <div className="empty-state"><p>暂无错题记录</p></div> : wrongQuestions.map(wq => <div key={wq.id} className="wrong-q-item">{wq.question_content}</div>)}</div>
          )}

          {activeTab === 'analysis' && (
            <div>
              <div className="toolbar">
                <button className="btn btn-primary" onClick={triggerAnalysis} disabled={analyzing}>{analyzing ? '分析中...' : '生成/刷新 AI 分析'}</button>
              </div>
              {latestAnalysis ? <div className="ai-analysis"><div className="ai-analysis-content">{latestAnalysis}</div></div> : <div className="empty-state"><p>暂无 AI 分析</p></div>}
            </div>
          )}

          {activeTab === 'evaluation' && (
            <div className="grid-2" style={{ gap: 16 }}>
              <div className="card">
                <div className="card-title">发起 AI 评定</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="form-input" value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}>
                    <option value="">请选择模板</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}（{t.template_type}）</option>)}
                  </select>
                  <button className="btn btn-primary" onClick={runEvaluation} disabled={runningEval}>{runningEval ? '评定中...' : '一键AI评定'}</button>
                </div>
                <div style={{ marginTop: 10 }}>
                  {(evaluationSessions || []).map(es => (
                    <div key={es.id} className="alert-item" style={{ cursor: 'pointer' }} onClick={() => loadSessionDetail(es.id)}>
                      <div>{es.template_name}</div><div className="text-sm text-muted">{es.status}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-title">评定详情</div>
                {!selectedSessionDetail ? <div className="empty-state"><p>请选择会话</p></div> : (
                  <div>
                    <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
                      标准版本：{selectedSessionDetail.session?.standard_version || '未知'}
                    </div>
                    <div className="table-wrapper">
                      <table className="data-table"><thead><tr><th>维度</th><th>分</th></tr></thead><tbody>{(selectedSessionDetail.scores || []).map(s => <tr key={s.id}><td>{s.dim_name}</td><td>{s.score}</td></tr>)}</tbody></table>
                    </div>
                    <div style={{ margin: '10px 0 12px' }}>
                      <div className="text-sm text-muted" style={{ marginBottom: 6 }}>维度检索快照（私有标准）</div>
                      {!Array.isArray(selectedSessionDetail.retrievalSnapshot) || selectedSessionDetail.retrievalSnapshot.length === 0 ? (
                        <div className="text-sm text-muted">暂无快照</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {selectedSessionDetail.retrievalSnapshot.map((row, idx) => (
                            <div key={idx} className="alert-item">
                              <div>{row.dim_name} · 命中 {row.hitCount} 条</div>
                              <div className="text-sm text-muted">{(row.topSources || []).map(s => `${s.title}(${s.clause})`).join('；') || '无命中'}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ margin: '10px 0 12px' }}>
                      <div className="text-sm text-muted" style={{ marginBottom: 6 }}>评判标准引用（RAG）</div>
                      {(selectedSessionDetail.evidence || []).length === 0 ? (
                        <div className="text-sm text-muted">暂无证据引用</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {(selectedSessionDetail.evidence || []).slice(0, 12).map(ev => (
                            <div key={ev.id} className="alert-item">
                              <div>{ev.dim_name || '通用'} · {ev.cited_standard_clause || '未标注条款'}</div>
                              <div className="text-sm text-muted">{ev.source_ref || '未知来源'}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary" disabled={reviewing || selectedSessionDetail.session.status === 'final'} onClick={() => reviewSession('approve')}>审核通过</button>
                      <button className="btn btn-secondary" disabled={reviewing || selectedSessionDetail.session.status === 'final'} onClick={() => reviewSession('reject')}>退回草稿</button>
                      <button className="btn btn-primary" disabled={finalizing || selectedSessionDetail.session.status !== 'reviewed'} onClick={finalizeSession}>确认生效</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="card">
              <div className="card-title">全量信息</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>课程</th><th>状态</th><th>来源</th></tr></thead>
                  <tbody>{studentCourses.map(c => <tr key={c.id}><td>{c.course_name}</td><td>{c.status}</td><td>{c.source}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


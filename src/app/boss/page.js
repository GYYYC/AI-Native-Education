'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

function getScoreClass(score, total = 100) {
  const pct = (score / total) * 100;
  if (pct >= 80) return 'score-high';
  if (pct >= 60) return 'score-mid';
  return 'score-low';
}

export default function BossDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ teachers: 0, students: 0, exams: 0, alerts: 0 });
  const [teachers, setTeachers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [expandedClassId, setExpandedClassId] = useState(null);
  const [stdTemplateType, setStdTemplateType] = useState('quality');
  const [stdDrafts, setStdDrafts] = useState([]);
  const [stdVersions, setStdVersions] = useState([]);
  const [stdTargetVersion, setStdTargetVersion] = useState('');
  const [stdBusy, setStdBusy] = useState(false);

  const getHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
  }), []);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (!u || u.role !== 'boss') { router.push('/'); return; }
    setUser(u);
    loadData(u);
    loadStandards('quality');
  }, []);

  async function loadStandards(templateType) {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const [dRes, vRes] = await Promise.all([
      fetch(`/api/evaluation/standards/drafts?templateType=${templateType}&status=draft`, { headers }),
      fetch(`/api/evaluation/standards/rollback?templateType=${templateType}`, { headers }),
    ]);
    const [dData, vData] = await Promise.all([dRes.json(), vRes.json()]);
    setStdDrafts(dData.drafts || []);
    setStdVersions(vData.versions || []);
    setStdTargetVersion('');
  }

  async function loadData(u) {
    setLoading(true);
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    try {
      const [studentsRes, alertsRes, examsRes] = await Promise.all([
        fetch('/api/students', { headers }),
        fetch('/api/alerts?limit=20', { headers }),
        fetch('/api/exams', { headers }),
      ]);
      const [sData, aData, eData] = await Promise.all([studentsRes.json(), alertsRes.json(), examsRes.json()]);

      const studentsList = sData.students || [];
      setStudents(studentsList);

      // Build teacher stats (User -> Class -> Student)
      const userMap = {};
      studentsList.forEach(s => {
        if (!userMap[s.user_id]) {
          userMap[s.user_id] = { user_id: s.user_id, teacher_name: s.teacher_name, classes: {} };
        }
        const tObj = userMap[s.user_id];
        if (!tObj.classes[s.teacher_id]) {
          tObj.classes[s.teacher_id] = {
            class_id: s.teacher_id,
            class_name: s.teacher_class,
            subject: s.subject,
            students: []
          };
        }
        tObj.classes[s.teacher_id].students.push(s);
      });

      const usersArray = Object.values(userMap).map(u => ({
        ...u,
        classes: Object.values(u.classes)
      }));
      setTeachers(usersArray);

      const alertsList = aData.alerts || [];
      setAlerts(alertsList);

      setStats({
        teachers: Object.keys(userMap).length,
        students: studentsList.length,
        exams: (eData.exams || []).length,
        alerts: alertsList.filter(a => !a.is_read).length,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const markAllRead = async () => {
    await fetch('/api/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ all: true }),
    });
    setAlerts(alerts.map(a => ({ ...a, is_read: 1 })));
    setStats(s => ({ ...s, alerts: 0 }));
  };

  async function generateHalfYearDraft(force = false) {
    setStdBusy(true);
    const res = await fetch('/api/evaluation/standards/generate-draft', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ templateType: stdTemplateType, force }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('❌ 生成失败: ' + (data.error || '未知错误'));
      setStdBusy(false);
      return;
    }
    alert(`✅ 已生成草稿：${data.generated?.length || 0} 条（周期 ${data.cycleKey}）`);
    await loadStandards(stdTemplateType);
    setStdBusy(false);
  }

  async function reviewDraft(documentId, action) {
    const reason = action === 'reject' ? (window.prompt('请输入驳回原因（可留空）', '') || '') : '';
    setStdBusy(true);
    const res = await fetch(`/api/evaluation/standards/drafts/${documentId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ action, reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('❌ 操作失败: ' + (data.error || '未知错误'));
      setStdBusy(false);
      return;
    }
    alert(action === 'publish' ? '✅ 草稿已发布并升级版本' : '✅ 草稿已驳回');
    await loadStandards(stdTemplateType);
    setStdBusy(false);
  }

  async function rollbackVersion() {
    if (!stdTargetVersion) return alert('请先选择回滚目标版本');
    const confirmed = window.confirm(`确认回滚到版本 v${stdTargetVersion} 吗？会生成新版本生效。`);
    if (!confirmed) return;
    setStdBusy(true);
    const res = await fetch('/api/evaluation/standards/rollback', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ templateType: stdTemplateType, targetVersion: stdTargetVersion }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('❌ 回滚失败: ' + (data.error || '未知错误'));
      setStdBusy(false);
      return;
    }
    alert(`✅ 已回滚并发布新版本 v${data.newVersion}`);
    await loadStandards(stdTemplateType);
    setStdBusy(false);
  }

  if (!user) return null;

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 8px rgba(99,102,241,0.4))' }}>📊</span> 
              <span>机构总览仪表盘</span>
            </h2>
            <p>欢迎回来，{user.name}！以下是当前机构整体运营数据</p>
          </div>
        </div>
        <div className="page-body">

          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card green">
              <div className="stat-value">{stats.teachers}</div>
              <div className="stat-label">教师数量</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value">{stats.students}</div>
              <div className="stat-label">在册学生</div>
            </div>
            <div className="stat-card purple">
              <div className="stat-value">{stats.exams}</div>
              <div className="stat-label">累计考试</div>
            </div>
            <div className="stat-card red">
              <div className="stat-value">{stats.alerts}</div>
              <div className="stat-label">未读告警</div>
            </div>
          </div>

          <div className="grid-2" style={{ gap: 20 }}>
            <div className="card">
              <div className="card-title">
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>🧠</span>
                标准演进中心（半年度）
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select className="form-input" value={stdTemplateType} onChange={e => { setStdTemplateType(e.target.value); loadStandards(e.target.value); }}>
                  <option value="quality">素质模板</option>
                  <option value="fitness">体能模板</option>
                  <option value="custom">自定义模板</option>
                </select>
                <button className="btn btn-primary btn-sm" disabled={stdBusy} onClick={() => generateHalfYearDraft(false)}>生成6个月草稿</button>
                <button className="btn btn-secondary btn-sm" disabled={stdBusy} onClick={() => generateHalfYearDraft(true)}>强制重跑</button>
              </div>
              <div className="text-sm text-muted" style={{ marginBottom: 10 }}>仅boss可触发。草稿需审核发布后才会生效。</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select className="form-input" value={stdTargetVersion} onChange={e => setStdTargetVersion(e.target.value)}>
                  <option value="">选择回滚版本</option>
                  {stdVersions.map(v => <option key={v.documentId} value={v.version}>v{v.version} - {v.title}</option>)}
                </select>
                <button className="btn btn-danger btn-sm" disabled={stdBusy} onClick={rollbackVersion}>版本回滚</button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {stdDrafts.length === 0 ? (
                  <div className="empty-state"><p>当前无待审核草稿</p></div>
                ) : stdDrafts.map(d => (
                  <div key={d.documentId} className="alert-item">
                    <div style={{ fontWeight: 600 }}>{d.title}</div>
                    <div className="text-sm text-muted">
                      维度：{d.metadata?.dim_key || '-'} · 周期：{d.metadata?.cycle_key || '-'} · 样本：{d.metadata?.sample_count || 0}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" disabled={stdBusy} onClick={() => reviewDraft(d.documentId, 'publish')}>发布</button>
                      <button className="btn btn-secondary btn-sm" disabled={stdBusy} onClick={() => reviewDraft(d.documentId, 'reject')}>驳回</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Teacher Overview */}
            <div className="card" id="teachers" style={{ scrollMarginTop: '80px' }}>
              <div className="card-title">
                <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(99,102,241,0.4))', marginRight: 8 }}>👨‍🏫</span>
                教师班级概况与能效
              </div>
              {loading ? (
                <div className="loading-overlay"><span className="loading-spinner"></span> 加载中...</div>
              ) : teachers.length === 0 ? (
                <div className="empty-state"><div className="icon">👩‍🏫</div><p>暂无教师数据</p></div>
              ) : (
                teachers.map(u => {
                  const allStudents = u.classes.flatMap(c => c.students);
                  const scores = allStudents.filter(s => s.lastExam).map(s => (s.lastExam.score / s.lastExam.total_score) * 100);
                  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
                  return (
                    <div key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      {/* --- USER LEVEL (老师) --- */}
                      <div 
                        className="flex items-center justify-between" 
                        style={{ padding: '12px 0', cursor: 'pointer' }}
                        onClick={() => {
                          setExpandedUserId(expandedUserId === u.user_id ? null : u.user_id);
                          setExpandedClassId(null);
                        }}
                      >
                        <div>
                          <span className="font-bold">{u.teacher_name}</span>
                          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>{u.classes.length} 个班级</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted">{allStudents.length} 名学生</span>
                          <span className="text-muted" style={{ fontSize: 12 }}>{expandedUserId === u.user_id ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      
                      {/* Teacher's Global Average */}
                      {avg !== null && (
                        <div style={{ paddingBottom: 12 }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                            <span className="text-sm text-muted">综合最新考试得分率</span>
                            <span className={`text-sm font-bold ${avg >= 80 ? 'score-high' : avg >= 60 ? 'score-mid' : 'score-low'}`}>
                              {avg.toFixed(1)}%
                            </span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${avg}%`, background: avg >= 80 ? 'var(--accent-green)' : avg >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)' }}></div>
                          </div>
                        </div>
                      )}

                      {/* --- CLASS LEVEL (班级) --- */}
                      {expandedUserId === u.user_id && (
                        <div style={{ padding: '0 0 12px 10px' }}>
                          {u.classes.map(c => {
                            const cScores = c.students.filter(s => s.lastExam).map(s => (s.lastExam.score / s.lastExam.total_score) * 100);
                            const cAvg = cScores.length ? cScores.reduce((a, b) => a + b, 0) / cScores.length : null;

                            return (
                              <div key={c.class_id} style={{ background: 'var(--bg-secondary)', borderRadius: 8, marginTop: 8, overflow: 'hidden' }}>
                                <div 
                                  className="flex items-center justify-between" 
                                  style={{ padding: '10px 14px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}
                                  onClick={() => setExpandedClassId(expandedClassId === c.class_id ? null : c.class_id)}
                                >
                                  <div>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.class_name}</span>
                                    <span className="badge badge-purple" style={{ marginLeft: 8 }}>{c.subject}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {cAvg !== null && <span className={`text-sm ${cAvg >= 80 ? 'score-high' : cAvg >= 60 ? 'score-mid' : 'score-low'}`}>{cAvg.toFixed(1)}%</span>}
                                    <span className="text-sm text-muted" style={{ marginLeft: 8 }}>{c.students.length}人</span>
                                    <span className="text-muted" style={{ fontSize: 12, marginLeft: 6 }}>{expandedClassId === c.class_id ? '▲' : '▼'}</span>
                                  </div>
                                </div>

                                {/* --- STUDENT LEVEL --- */}
                                {expandedClassId === c.class_id && (
                                  <div style={{ padding: '10px 14px' }}>
                                    {c.students.length === 0 ? (
                                      <div className="empty-state text-sm" style={{ padding: 10 }}>暂无学生</div>
                                    ) : (
                                      <table className="data-table" style={{ margin: 0 }}>
                                        <thead>
                                          <tr>
                                            <th style={{ background: 'transparent' }}>学生姓名</th>
                                            <th style={{ background: 'transparent' }}>年级</th>
                                            <th style={{ background: 'transparent' }}>最近考试</th>
                                            <th style={{ background: 'transparent' }}>得分</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {c.students.map(s => (
                                            <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/boss/student/${s.id}`)}>
                                              <td style={{ fontWeight: 600 }}>{s.name}</td>
                                              <td>{s.grade || '-'}</td>
                                              <td>{s.lastExam?.exam_name || '-'}</td>
                                              <td>
                                                {s.lastExam ? (
                                                  <span className={`font-bold ${getScoreClass(s.lastExam.score, s.lastExam.total_score)}`}>
                                                    {s.lastExam.score}/{s.lastExam.total_score}
                                                  </span>
                                                ) : '-'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Alerts */}
            <div className="card" id="alerts" style={{ scrollMarginTop: '80px' }}>
              <div className="card-title flex items-center justify-between">
                <div>
                  <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 4px rgba(239,68,68,0.4))', marginRight: 8 }}>⚠️</span>
                  系统最新告警监控
                </div>
                {alerts.some(a => !a.is_read) && (
                  <button className="btn btn-sm btn-secondary" onClick={markAllRead}>标记全部已读</button>
                )}
              </div>
              {loading ? (
                <div className="loading-overlay"><span className="loading-spinner"></span></div>
              ) : alerts.length === 0 ? (
                <div className="empty-state"><div className="icon">✅</div><p>暂无异常告警</p></div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {alerts.map(a => (
                    <div key={a.id} className={`alert-item ${!a.is_read ? 'unread' : ''} ${a.type === 'class_abnormal' ? 'class-alert' : ''}`}>
                      <div className="flex items-center justify-between">
                        <span className={`badge ${a.type === 'class_abnormal' ? 'badge-orange' : 'badge-red'}`}>
                          {a.type === 'class_abnormal' ? '班级异常' : '学生异常'}
                        </span>
                        <span className="alert-time">{new Date(a.created_at).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="alert-title">{a.message}</div>
                      <div className="alert-detail">{a.detail}</div>
                      {a.sent_feishu ? <span className="tag">✅ 飞书已通知</span> : <span className="tag">⏳ 飞书待发送</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

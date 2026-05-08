'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

export default function TeacherDashboardWrapper() {
  return (
    <Suspense fallback={<div className="loading-overlay">加载中...</div>}>
      <TeacherDashboard />
    </Suspense>
  );
}

function TeacherDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState(null); // { id, class_name } | null
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('classes');
  const [submitting, setSubmitting] = useState(false);

  // Modal visibility
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAddExam, setShowAddExam] = useState(false);
  const [showAddScore, setShowAddScore] = useState(false);
  const [showImportStudents, setShowImportStudents] = useState(false);
  const [showImportScores, setShowImportScores] = useState(false);
  const [showAddClass, setShowAddClass] = useState(false);
  const [showWebhookEdit, setShowWebhookEdit] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);

  // Form states
  const [classForm, setClassForm] = useState({ subject: '', className: '', webhookUrl: '' });
  const [webhookEditForm, setWebhookEditForm] = useState({ id: '', webhookUrl: '' });
  const [studentForm, setStudentForm] = useState({ student_code: '', name: '', grade: '', class_name: '', teacher_id: '', parent_name: '', parent_phone: '', notes: '' });
  const [examForm, setExamForm] = useState({ name: '', subject: '', exam_date: '', total_score: 100, teacher_id: '' });
  const [scoreMode, setScoreMode] = useState('pose'); // pose | artwork | objective
  const [standardDocs, setStandardDocs] = useState([]);
  const [sessionOptions, setSessionOptions] = useState([]);
  const [sessionScores, setSessionScores] = useState([]);
  const [isEditingScores, setIsEditingScores] = useState(false);
  const [modifiedScores, setModifiedScores] = useState({}); // { dim_id: score }
  const [poseForm, setPoseForm] = useState({
    studentId: '',
    exerciseType: '',
    videoUrl: '',
    videoName: '',
    durationSec: '',
    note: '',
    taskId: '',
    taskStatus: '',
    sessionId: '',
    dimensionKey: '',
  });
  const [artworkForm, setArtworkForm] = useState({
    studentId: '',
    artType: 'calligraphy',
    note: '',
    imageUrl: '',
    imageBase64: '',
    imageMimeType: 'image/jpeg',
    imageName: '',
    analysisResult: null,
    sessionId: '',
    dimensionKey: '',
  });
  const [objectiveForm, setObjectiveForm] = useState({
    studentId: '',
    subjectType: 'psychology',
    sessionId: '',
    dimensionKey: '',
    note: '',
    paperImageBase64: '',
    paperImageMimeType: 'image/jpeg',
    paperImageName: '',
    extractedItems: [],
    lastResult: null,
  });
  const [poseBatchFile, setPoseBatchFile] = useState(null);
  const [artworkBatchFile, setArtworkBatchFile] = useState(null);

  // Import states
  const [importFile, setImportFile] = useState(null);
  const [importExamId, setImportExamId] = useState('');
  const [importClassId, setImportClassId] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const artworkFileInputRef = useRef(null);
  const objectivePaperInputRef = useRef(null);

  const exerciseOptions = ['瑜伽', '爵士舞', '花式跳绳', '武术操', '体适能跑跳', '篮球运球'];

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['classes', 'students', 'exams', 'alerts'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }), []);
  const authHeader = useCallback(() => ({ Authorization: `Bearer ${localStorage.getItem('token')}` }), []);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (!u || u.role !== 'teacher') { router.push('/'); return; }
    setUser(u);
    loadAll();
  }, []);

  async function safeJson(res, fallback = {}) {
    try {
      if (!res.ok && res.status === 401) return fallback;
      const text = await res.text();
      if (!text || !text.trim()) return fallback;
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  async function loadAll() {
    setLoading(true);
    const h = authHeader();
    const [cRes, sRes, eRes, aRes, stdRes] = await Promise.all([
      fetch('/api/teacher/classes', { headers: h }),
      fetch('/api/students', { headers: h }),
      fetch('/api/exams', { headers: h }),
      fetch('/api/alerts', { headers: h }),
      fetch('/api/rag?docType=evaluation_standard', { headers: h }),
    ]);
    const [cData, sData, eData, aData, stdData] = await Promise.all([
      safeJson(cRes, { classes: [] }),
      safeJson(sRes, { students: [] }),
      safeJson(eRes, { exams: [] }),
      safeJson(aRes, { alerts: [] }),
      safeJson(stdRes, { documents: [] }),
    ]);
    setClasses(cData.classes || []);
    setStudents(sData.students || []);
    setExams(eData.exams || []);
    setAlerts(aData.alerts || []);
    setStandardDocs(stdData.documents || []);
    setLoading(false);
  }

  // === Class handlers ===
  async function handleAddClass(e) {
    e.preventDefault(); setSubmitting(true);
    const res = await fetch('/api/teacher/classes', { method: 'POST', headers: headers(), body: JSON.stringify(classForm) });
    if (res.ok) { 
        setShowAddClass(false); 
        setClassForm({ subject: '', className: '', webhookUrl: '' }); 
        loadAll(); 
        alert('✅ 班级已成功创建');
    } else {
        const err = await res.json();
        alert('❌ 添加失败: ' + (err.error || '服务器错误'));
    }
    setSubmitting(false);
  }

  async function handleUpdateWebhook(e) {
    e.preventDefault(); setSubmitting(true);
    const res = await fetch(`/api/teacher/classes/${webhookEditForm.id}/webhook`, { method: 'PUT', headers: headers(), body: JSON.stringify({ webhookUrl: webhookEditForm.webhookUrl }) });
    if (res.ok) { 
        setShowWebhookEdit(false); 
        loadAll(); 
        alert('✅ 班级飞书 Webhook 已更新');
    } else {
        const err = await res.json();
        alert('❌ 更新失败: ' + (err.error || '服务器错误'));
    }
    setSubmitting(false);
  }

  // === Student handlers ===
  async function handleAddStudent(e) {
    e.preventDefault(); setSubmitting(true);
    
    // Find the selected class to get grade/class_name info if needed, or API needs teacher_id
    const selectedClass = classes.find(c => c.id === parseInt(studentForm.teacher_id));
    
    // We update student code slightly differently if teacher_id is used. The API expects standard student details. We ensure it's saved correctly.
    const res = await fetch('/api/students', { method: 'POST', headers: headers(), body: JSON.stringify({...studentForm, class_name: selectedClass?.class_name || studentForm.class_name}) });
    if (res.ok) { setShowAddStudent(false); setStudentForm({ student_code: '', name: '', grade: '', class_name: '', teacher_id: '', parent_name: '', parent_phone: '', notes: '' }); loadAll(); }
    else {
        try {
          const err = await res.json();
          alert('录入失败: ' + (err.error || '请检查输入字段'));
        } catch {
          alert('录入失败, 请检查输入字段');
        }
    }
    setSubmitting(false);
  }

  // === Exam handlers ===
  async function handleAddExam(e) {
    e.preventDefault(); setSubmitting(true);
    
    // Automatically match subject if a class is selected
    const selectedClass = classes.find(c => c.id === parseInt(examForm.teacher_id));
    const payload = { ...examForm, subject: selectedClass?.subject || examForm.subject };

    const res = await fetch('/api/exams', { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
    if (res.ok) { 
      setShowAddExam(false); 
      setExamForm({ name: '', subject: '', exam_date: '', total_score: 100, teacher_id: '' }); 
      loadAll(); 
    } else {
      const err = await res.json();
      alert('❌ 创建失败: ' + (err.error || '未知错误'));
    }
    setSubmitting(false);
  }

  async function loadSessionsForStudent(studentId) {
    const parsed = parseInt(studentId, 10);
    if (Number.isNaN(parsed)) { setSessionOptions([]); return []; }
    const res = await fetch(`/api/evaluation/sessions?studentId=${parsed}`, { headers: authHeader() });
    const data = await safeJson(res, { sessions: [] });
    const list = (data.sessions || []).filter(s => s.status !== 'final');
    setSessionOptions(list);
    return list;
  }

  async function loadSessionScores(sessionId) {
    const parsed = parseInt(sessionId, 10);
    if (Number.isNaN(parsed)) { setSessionScores([]); return; }
    const res = await fetch(`/api/evaluation/sessions/${parsed}`, { headers: authHeader() });
    const data = await safeJson(res, { scores: [] });
    setSessionScores(data.scores || []);
  }

  async function loadLatestPoseTask(studentId) {
    const parsed = parseInt(studentId, 10);
    if (Number.isNaN(parsed)) return null;
    const res = await fetch(`/api/media/pose/tasks?studentId=${parsed}&limit=1`, { headers: authHeader() });
    const data = await safeJson(res, { tasks: [] });
    if (!res.ok) return null;
    return (data.tasks || [])[0] || null;
  }

  async function ensureSessionForType(studentId, templateType) {
    const list = await loadSessionsForStudent(String(studentId));
    const existing = (list || []).find(s => String(s.template_type || '') === String(templateType || ''));
    if (existing?.id) return { sessionId: Number(existing.id), from: 'existing' };

    const tplRes = await fetch('/api/evaluation/templates', { headers: authHeader() });
    const tplData = await safeJson(tplRes, { templates: [] });
    const targetTpl = (tplData.templates || []).find(t => t.active && String(t.template_type || '') === String(templateType || ''));
    if (!targetTpl?.id) {
      return { error: `未找到可用的${templateType === 'fitness' ? '体能' : '素质'}评估模板` };
    }

    const runRes = await fetch('/api/evaluation/run', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        studentId: Number(studentId),
        templateId: Number(targetTpl.id),
        triggerType: 'manual',
      }),
    });
    const runData = await safeJson(runRes, {});
    if (!runRes.ok) {
      const raw = String(runData.error || '');
      if (raw.includes('gpt-5.3-codex') && raw.includes('/chat/completions')) {
        return { error: '当前 AI_CHAT_MODEL 配置成了不支持 /chat/completions 的模型。请在 .env.local 改为 deepseek-chat 或你可用的千问模型后重试。' };
      }
      return { error: raw || '自动创建评估记录失败' };
    }
    return { sessionId: Number(runData.sessionId), from: 'new' };
  }

  function parseCsvRows(text) {
    const lines = String(text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(v => v.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const cols = line.split(',').map(v => v.trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
      return row;
    });
  }

  async function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(String(e.target?.result || ''));
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    });
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(String(e.target?.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function findStudentByRow(row) {
    const idVal = String(row.student_id || row.studentid || row.id || '').trim();
    const nameVal = String(row.student_name || row.name || '').trim();
    if (idVal) {
      const hitById = students.find(s => String(s.id) === idVal || String(s.display_student_id || s.student_code || '') === idVal);
      if (hitById) return hitById;
    }
    if (nameVal) {
      const hitByName = students.find(s => String(s.name || '').trim() === nameVal);
      if (hitByName) return hitByName;
    }
    return null;
  }

  function pickStandardsByExercise(exerciseType) {
    const key = String(exerciseType || '').trim();
    return standardDocs.filter(d => {
      const md = d.metadata || {};
      return String(md.exercise_type || '').trim() === key || String(d.title || '').includes(key);
    });
  }

  function pickStandardDocByKeyword(keyword) {
    const key = String(keyword || '').trim();
    return standardDocs.find(d => {
      const md = d.metadata || {};
      return String(md.subject_type || '').trim() === key
        || String(md.art_type || '').trim() === key
        || String(md.exercise_type || '').trim() === key
        || String(d.title || '').includes(key);
    }) || null;
  }

  async function submitPoseAssessment() {
    try {
      const studentId = parseInt(poseForm.studentId, 10);
      if (Number.isNaN(studentId)) return alert('请先选择学生');
      if (!poseForm.exerciseType) return alert('动作类型为必选');
      if (!poseForm.videoUrl.trim()) return alert('请填写视频URL或上传mp4视频');

      const selectedStandard = pickStandardsByExercise(poseForm.exerciseType)[0] || null;
      setSubmitting(true);
      const res = await fetch('/api/media/pose/analyze', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          studentId,
          exerciseType: poseForm.exerciseType,
          videoUrl: poseForm.videoUrl,
          videoName: poseForm.videoName,
          durationSec: Number(poseForm.durationSec || 0),
          note: poseForm.note,
          standardRef: selectedStandard ? `${selectedStandard.title}(${selectedStandard.documentId})` : '',
        }),
      });
      const data = await safeJson(res, {});
      if (!res.ok) {
        return alert('创建姿态任务失败: ' + (data.error || '未知错误'));
      }
      const taskId = String(data.taskId || '');
      setPoseForm(f => ({ ...f, taskId, taskStatus: data.status || '' }));
      alert('✅ 已提交体能评测，系统将自动等待 MediaPipe 回调结果');

      let latestTask = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const taskRes = await fetch(`/api/media/pose/tasks/${taskId}`, { headers: authHeader() });
        const taskData = await safeJson(taskRes, {});
        if (taskRes.ok) latestTask = taskData.task;
        if (latestTask?.status === 'completed') break;
      }
      if (latestTask?.status === 'completed') {
        let sessionId = parseInt(poseForm.sessionId, 10);
        if (Number.isNaN(sessionId)) {
          const ensured = await ensureSessionForType(studentId, 'fitness');
          if (!ensured.sessionId) return alert(ensured.error || '自动创建体能评估记录失败');
          sessionId = ensured.sessionId;
          setPoseForm(f => ({ ...f, sessionId: String(sessionId) }));
          await loadSessionScores(String(sessionId));
        }
        const ingestRes = await fetch('/api/evaluation/evidence/ingest', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            sessionId,
            dimensionKey: poseForm.dimensionKey,
            poseTaskId: parseInt(taskId, 10),
            evidenceDetailType: 'pose_metric',
            source: 'mediapipe',
            note: `${poseForm.note || ''}${selectedStandard ? `\n[自动标准]${selectedStandard.title}` : ''}`,
            sourceRef: `pose_task:${taskId}`,
          }),
        });
        const ingestData = await safeJson(ingestRes, {});
        if (!ingestRes.ok) {
          return alert('任务已完成，但证据入库失败: ' + (ingestData.error || '未知错误'));
        }
        setPoseForm(f => ({ ...f, taskStatus: 'completed' }));
        alert('✅ MediaPipe 结果已自动入库');
      } else {
        alert('⏳ 当前仍在等待 MediaPipe 回调，暂不会创建新的 AI Draft，回调完成后请点“检查回调并入库”。');
      }
    } catch (err) {
      alert('提交失败: ' + (err?.message || '网络异常'));
    } finally {
      setSubmitting(false);
    }
  }

  async function checkPoseTaskAndIngest() {
    let taskId = parseInt(poseForm.taskId, 10);
    let sessionId = parseInt(poseForm.sessionId, 10);
    if (Number.isNaN(taskId)) {
      const studentId = parseInt(poseForm.studentId, 10);
      if (Number.isNaN(studentId)) return alert('请先选择学生');
      const latestTask = await loadLatestPoseTask(studentId);
      if (!latestTask?.id) return alert('未找到可用任务，请先提交体能评测');
      taskId = Number(latestTask.id);
      setPoseForm(f => ({ ...f, taskId: String(taskId), taskStatus: String(latestTask.status || '') }));
    }
    if (Number.isNaN(sessionId)) {
      const studentId = parseInt(poseForm.studentId, 10);
      if (Number.isNaN(studentId)) return alert('请先选择学生');
      const ensured = await ensureSessionForType(studentId, 'fitness');
      if (!ensured.sessionId) return alert(ensured.error || '自动创建体能评估记录失败');
      sessionId = ensured.sessionId;
      setPoseForm(f => ({ ...f, sessionId: String(sessionId) }));
      await loadSessionScores(String(sessionId));
    }
    setSubmitting(true);
    const res = await fetch(`/api/media/pose/tasks/${taskId}`, { headers: authHeader() });
    const data = await safeJson(res, {});
    if (!res.ok) {
      setSubmitting(false);
      return alert('查询任务失败: ' + (data.error || '未知错误'));
    }
    const status = data.task?.status || '';
    setPoseForm(f => ({ ...f, taskStatus: status }));
    if (status !== 'completed') {
      setSubmitting(false);
      return alert(`当前任务状态：${status || 'pending'}，等待回调后再入库`);
    }
    const ingestRes = await fetch('/api/evaluation/evidence/ingest', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId,
        dimensionKey: poseForm.dimensionKey,
        poseTaskId: taskId,
        evidenceDetailType: 'pose_metric',
        source: 'mediapipe',
        note: poseForm.note,
        sourceRef: `pose_task:${taskId}`,
      }),
    });
    const ingestData = await safeJson(ingestRes, {});
    if (!ingestRes.ok) {
      setSubmitting(false);
      return alert('证据入库失败: ' + (ingestData.error || '未知错误'));
    }
    alert('✅ 体能评测证据已写入，评分已同步更新');
    // 关键修复：刷新当前 Session 的分数显示
    if (sessionId) await loadSessionScores(String(sessionId));
    setSubmitting(false);
  }

  async function handleSaveRevisedScores() {
    const sessionId = scoreMode === 'pose' ? poseForm.sessionId : (scoreMode === 'artwork' ? artworkForm.sessionId : objectiveForm.sessionId);
    if (!sessionId) return alert('未关联会话');
    
    setSubmitting(true);
    const revisedScores = Object.entries(modifiedScores).map(([dimId, score]) => ({
        dimensionId: parseInt(dimId, 10),
        score: parseFloat(score)
    }));

    try {
        const res = await fetch(`/api/evaluation/sessions/${sessionId}/review`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                action: 'edit',
                comment: '老师在评测中心手动调整评分',
                revisedScores
            })
        });
        if (res.ok) {
            alert('✅ 分数已手动调整并同步至 AI 案例库');
            setIsEditingScores(false);
            await loadSessionScores(String(sessionId));
        } else {
            const data = await res.json();
            alert('❌ 调整失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('❌ 网络错误');
    } finally {
        setSubmitting(false);
    }
  }

  async function handlePoseVideoFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPoseForm(f => ({
      ...f,
      videoName: file.name,
      videoUrl: dataUrl,
      note: `${f.note || ''}${f.note ? '\n' : ''}[本地上传]${file.name}`,
    }));
  }

  async function runPoseBatchImport() {
    if (!poseBatchFile) return alert('请先选择CSV文件');
    if (!poseForm.exerciseType) return alert('请先选择动作类型');
    const sessionId = parseInt(poseForm.sessionId, 10);
    if (Number.isNaN(sessionId)) return alert('当前学生没有可用评估记录，请先去学生详情发起一次AI评估');
    const selectedStandard = pickStandardsByExercise(poseForm.exerciseType)[0] || null;
    const text = await readFileText(poseBatchFile);
    const rows = parseCsvRows(text);
    if (!rows.length) return alert('CSV内容为空');
    setSubmitting(true);
    let success = 0;
    let failed = 0;
    for (const row of rows) {
      const student = findStudentByRow(row);
      const url = String(row.url || row.video_url || row.video || '').trim();
      if (!student || !url) { failed++; continue; }
      const taskRes = await fetch('/api/media/pose/analyze', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          studentId: student.id,
          exerciseType: poseForm.exerciseType,
          videoUrl: url,
          videoName: row.video_name || '',
          durationSec: Number(row.duration_sec || 0),
          note: `批量导入:${poseForm.note || ''}${selectedStandard ? ` [自动标准]${selectedStandard.title}` : ''}`,
        }),
      });
      const taskData = await safeJson(taskRes, {});
      if (!taskRes.ok) { failed++; continue; }
      success++;
      if (String(taskData.status || '') === 'completed') {
        await fetch('/api/evaluation/evidence/ingest', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            sessionId,
            dimensionKey: poseForm.dimensionKey,
            poseTaskId: Number(taskData.taskId),
            evidenceDetailType: 'pose_metric',
            source: 'mediapipe',
            note: poseForm.note,
            sourceRef: `pose_task:${taskData.taskId}`,
          }),
        });
      }
    }
    alert(`✅ 批量任务已提交：成功 ${success} 条，失败 ${failed} 条`);
    setSubmitting(false);
  }

  function handleArtworkFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = String(ev.target?.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      setArtworkForm(f => ({
        ...f,
        imageBase64: base64,
        imageMimeType: file.type || 'image/jpeg',
        imageName: file.name,
      }));
    };
    reader.readAsDataURL(file);
  }

  async function fetchImageUrlAsBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败(${res.status})`);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(String(e.target?.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const mimeType = blob.type || 'image/jpeg';
    const base64 = String(dataUrl).split(',')[1] || '';
    return { mimeType, base64 };
  }

  async function loadArtworkFromUrl() {
    if (!artworkForm.imageUrl.trim()) return alert('请先填写图片URL');
    setSubmitting(true);
    try {
      const { base64, mimeType } = await fetchImageUrlAsBase64(artworkForm.imageUrl.trim());
      setArtworkForm(f => ({ ...f, imageBase64: base64, imageMimeType: mimeType, imageName: 'url-image' }));
      alert('✅ 已从URL加载图片，可直接点击“分析作品细节”');
    } catch (err) {
      alert('❌ URL图片加载失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function analyzeArtwork() {
    if (!artworkForm.studentId) return alert('请先选择学生');
    if (!artworkForm.imageBase64) return alert('请先上传作品图片');
    setSubmitting(true);
    const res = await fetch('/api/artwork/analyze', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        imageBase64: artworkForm.imageBase64,
        mimeType: artworkForm.imageMimeType,
        artType: artworkForm.artType,
      }),
    });
    const data = await safeJson(res, {});
    if (!res.ok) {
      setSubmitting(false);
      return alert('作品分析失败: ' + (data.error || '未知错误'));
    }
    setArtworkForm(f => ({ ...f, analysisResult: data }));
    alert('✅ 作品分析完成');
    setSubmitting(false);
  }

  async function ingestArtworkEvidence() {
    let sessionId = parseInt(artworkForm.sessionId, 10);
    if (Number.isNaN(sessionId)) {
      const studentId = parseInt(artworkForm.studentId, 10);
      if (Number.isNaN(studentId)) return alert('请先选择学生');
      const ensured = await ensureSessionForType(studentId, 'quality');
      if (!ensured.sessionId) return alert(ensured.error || '自动创建素质评估记录失败');
      sessionId = ensured.sessionId;
      setArtworkForm(f => ({ ...f, sessionId: String(sessionId) }));
      await loadSessionScores(String(sessionId));
    }
    if (!artworkForm.analysisResult?.evidencePayload) return alert('请先完成作品分析');
    setSubmitting(true);
    const detailType = artworkForm.artType === 'calligraphy' ? 'calligraphy_metric' : 'artwork_metric';
    const res = await fetch('/api/evaluation/evidence/ingest', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId,
        dimensionKey: artworkForm.dimensionKey,
        metrics: artworkForm.analysisResult.evidencePayload,
        evidenceDetailType: detailType,
        source: 'artwork_analyzer',
        artType: artworkForm.artType,
        note: artworkForm.note,
        sourceRef: artworkForm.imageName || 'artwork_image',
      }),
    });
    const data = await safeJson(res, {});
    if (!res.ok) {
      setSubmitting(false);
      return alert('作品证据入库失败: ' + (data.error || '未知错误'));
    }
    alert('✅ 作品证据已入库');
    setSubmitting(false);
  }

  async function runArtworkBatchImport() {
    if (!artworkBatchFile) return alert('请先选择CSV文件');
    const sessionId = parseInt(artworkForm.sessionId, 10);
    if (Number.isNaN(sessionId)) return alert('当前学生没有可用评估记录，请先去学生详情发起一次AI评估');
    const text = await readFileText(artworkBatchFile);
    const rows = parseCsvRows(text);
    if (!rows.length) return alert('CSV内容为空');
    setSubmitting(true);
    let success = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const student = findStudentByRow(row);
        const imageUrl = String(row.url || row.image_url || row.image || '').trim();
        if (!student || !imageUrl) { failed++; continue; }
        const { base64, mimeType } = await fetchImageUrlAsBase64(imageUrl);
        const artType = String(row.art_type || artworkForm.artType || 'calligraphy').trim();
        const analyzeRes = await fetch('/api/artwork/analyze', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ imageBase64: base64, mimeType, artType }),
        });
        const analyzed = await safeJson(analyzeRes, {});
        if (!analyzeRes.ok || !analyzed.evidencePayload) { failed++; continue; }
        const detailType = artType === 'calligraphy' ? 'calligraphy_metric' : 'artwork_metric';
        const ingestRes = await fetch('/api/evaluation/evidence/ingest', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            sessionId,
            dimensionKey: artworkForm.dimensionKey,
            metrics: analyzed.evidencePayload,
            evidenceDetailType: detailType,
            source: 'artwork_analyzer',
            artType,
            note: `批量导入:${artworkForm.note || ''}`,
            sourceRef: imageUrl,
          }),
        });
        if (!ingestRes.ok) { failed++; continue; }
        success++;
      } catch {
        failed++;
      }
    }
    alert(`✅ 批量图片处理完成：成功 ${success} 条，失败 ${failed} 条`);
    setSubmitting(false);
  }

  function handleObjectivePaperFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = String(ev.target?.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      setObjectiveForm(f => ({
        ...f,
        paperImageBase64: base64,
        paperImageMimeType: file.type || 'image/jpeg',
        paperImageName: file.name,
      }));
    };
    reader.readAsDataURL(file);
  }

  async function queryRagCorrectAnswer(subjectType, questionNo, studentAnswer, standardDocId) {
    const standard = standardDocs.find(d => d.documentId === standardDocId);
    const question = `请基于文档[${standard?.title || standardDocId}]，返回题号${questionNo || ''}的标准答案，仅返回简短答案文本。科目=${subjectType}，学生答案=${studentAnswer}`;
    const res = await fetch('/api/rag', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ question }),
    });
    const data = await safeJson(res, {});
    return String(data.answer || '').trim();
  }

  async function gradeObjectiveAndIngest() {
    let sessionId = parseInt(objectiveForm.sessionId, 10);
    if (Number.isNaN(sessionId)) {
      const studentId = parseInt(objectiveForm.studentId, 10);
      if (Number.isNaN(studentId)) return alert('请先选择学生');
      const ensured = await ensureSessionForType(studentId, 'quality');
      if (!ensured.sessionId) return alert(ensured.error || '自动创建素质评估记录失败');
      sessionId = ensured.sessionId;
      setObjectiveForm(f => ({ ...f, sessionId: String(sessionId) }));
      await loadSessionScores(String(sessionId));
    }
    if (!objectiveForm.paperImageBase64) return alert('请先上传试卷图片');
    const selectedStandard = pickStandardDocByKeyword(objectiveForm.subjectType);
    if (!selectedStandard) return alert('未找到该科目的RAG答案标准，请先在RAG上传对应标准');
    setSubmitting(true);
    const visionRes = await fetch('/api/vision', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        imageBase64: objectiveForm.paperImageBase64,
        mimeType: objectiveForm.paperImageMimeType,
      }),
    });
    const visionData = await safeJson(visionRes, {});
    if (!visionRes.ok || !visionData.data) {
      setSubmitting(false);
      return alert('试卷识别失败: ' + (visionData.error || '未知错误'));
    }
    const parsed = visionData.data;
    const questionNo = String(parsed.question_number || 'Q1');
    const studentAnswer = String(parsed.student_answer || '').trim();
    const fallbackAnswer = String(parsed.correct_answer || '').trim();
    const ragAnswer = await queryRagCorrectAnswer(objectiveForm.subjectType, questionNo, studentAnswer, selectedStandard.documentId);
    const items = [{
      questionNo,
      studentAnswer,
      correctAnswer: ragAnswer || fallbackAnswer || '',
    }].filter(it => it.correctAnswer);
    if (!items.length) {
      setSubmitting(false);
      return alert('未能从RAG匹配到标准答案，请先补充答案标准文档');
    }
    const res = await fetch('/api/evaluation/objective-grade', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId,
        subjectType: objectiveForm.subjectType,
        dimensionKey: objectiveForm.dimensionKey,
        note: objectiveForm.note,
        items,
      }),
    });
    const data = await safeJson(res, {});
    if (!res.ok) {
      setSubmitting(false);
      return alert('客观题判分失败: ' + (data.error || '未知错误'));
    }
    setObjectiveForm(f => ({ ...f, extractedItems: items, lastResult: data.metrics || null }));
    alert('✅ 客观题判分并入库完成');
    setSubmitting(false);
  }

  // === Batch Import handlers ===
  async function handleImport(type) {
    if (!importFile) { alert('请先选择文件'); return; }
    if (type === 'scores' && !importExamId) { alert('请选择对应的考试'); return; }
    setImporting(true); setImportResult(null);

    const formData = new FormData();
    formData.append('type', type);
    formData.append('file', importFile);
    if (type === 'scores') formData.append('examId', importExamId);
    if (type === 'students') formData.append('teacherId', importClassId);

    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    });
    const data = await res.json();
    setImportResult(data);
    if (data.successCount > 0) loadAll();
    setImporting(false);
  }

  function downloadTemplate(type) {
    const token = localStorage.getItem('token');
    window.location.href = `/api/import?type=${type}&token=${token}`;
  }

  async function handleBulkDeleteStudents() {
    if (!selectedStudentIds.length) return alert('请先选择要删除的学生');
    const confirmed = window.confirm(`确定批量删除已选中的 ${selectedStudentIds.length} 名学生吗？该操作不可恢复。`);
    if (!confirmed) return;
    setSubmitting(true);
    const res = await fetch('/api/students', {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ studentIds: selectedStudentIds }),
    });
    const data = await safeJson(res, {});
    if (!res.ok) {
      setSubmitting(false);
      return alert('批量删除失败: ' + (data.error || '未知错误'));
    }
    setSelectedStudentIds([]);
    await loadAll();
    alert(`✅ 批量删除完成，已删除 ${data.deletedCount || 0} 名学生`);
    setSubmitting(false);
  }



  // Derived
  const filtered = students.filter(s => {
    if (classFilter && s.teacher_id !== classFilter.id) return false;
    if (search && !s.name.includes(search) && !(s.display_student_id || s.student_code || '').includes(search)) return false;
    return true;
  });
  const allFilteredIds = filtered.map(s => Number(s.id));
  const selectedSet = new Set(selectedStudentIds.map(Number));
  const allVisibleChecked = filtered.length > 0 && allFilteredIds.every(id => selectedSet.has(Number(id)));
  const unreadAlerts = alerts.filter(a => !a.is_read);

  if (!user) return null;

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.2em', filter: 'drop-shadow(0 2px 8px rgba(99,102,241,0.4))' }}>📚</span> 
              <span>教学研报与管理</span>
            </h2>
            <p>欢迎回来, {user.name} ({user.username})</p>
          </div>
          <div></div>
        </div>
        <div className="page-body">
          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card green">
              <div className="stat-value">{students.length}</div>
              <div className="stat-label">注册学生人数</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value">{exams.length}</div>
              <div className="stat-label">组织考试场次</div>
            </div>
            <div className="stat-card red">
              <div className="stat-value" style={{ color: unreadAlerts.length > 0 ? 'var(--accent-red)' : 'inherit' }}>{unreadAlerts.length}</div>
              <div className="stat-label">未处理告警项</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="tab-nav">
            {[['classes', '🏫 班级管理'], ['students', '👨‍🎓 学生明细'], ['exams', '📝 考试记录'], ['alerts', `⚠️ 系统告警${unreadAlerts.length ? ` (${unreadAlerts.length})` : ''}`]].map(([val, label]) => (
              <button key={val} className={`tab-btn ${activeTab === val ? 'active' : ''}`} onClick={() => setActiveTab(val)}>{label}</button>
            ))}
          </div>

          {/* ===================== CLASSES TAB ===================== */}
          {activeTab === 'classes' && (
            <>
              <div className="toolbar">
                <button className="btn btn-primary" onClick={() => setShowAddClass(true)}>＋ 添加班级</button>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>班级名称</th><th>授课科目</th><th>学生人数</th><th>飞书 Webhook</th><th>操作</th></tr></thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5}><div className="loading-overlay"><span className="loading-spinner"></span></div></td></tr>
                    ) : classes.length === 0 ? (
                      <tr><td colSpan={5}><div className="empty-state"><div className="icon">🏫</div><p>暂无班级，请先添加班级</p></div></td></tr>
                    ) : classes.map(c => {
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.class_name}</td>
                          <td><span className="badge badge-purple">{c.subject}</span></td>
                          <td>
                            <span style={{ fontWeight: 600, color: c.student_count > 0 ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
                              {c.student_count} 人
                            </span>
                          </td>
                          <td>
                            {c.feishu_webhook ? (
                              <span className="text-sm" style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                ✅ 已配置 <span style={{ opacity: 0.5 }}>({c.feishu_webhook.substring(0, 30)}...)</span>
                              </span>
                            ) : (
                              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>待配置</span>
                            )}
                          </td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-primary" onClick={() => {
                                setClassFilter({ id: c.id, class_name: c.class_name });
                                setSearch('');
                                setActiveTab('students');
                            }}>
                              👥 查看学生
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={() => {
                                setWebhookEditForm({ id: c.id, webhookUrl: c.feishu_webhook || '' });
                                setShowWebhookEdit(true);
                            }}>
                              配置飞书
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ===================== STUDENTS TAB ===================== */}
          {activeTab === 'students' && (
            <>
              {classFilter && (
                <div className="alert-item class-alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', padding: '12px 16px' }}>
                  <span style={{ fontSize: '14px', color: 'var(--accent-indigo)' }}>
                    <span style={{ marginRight: '8px' }}>🏫</span>
                    当前筛选班级：<strong>{classFilter.class_name}</strong>
                  </span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setClassFilter(null)}>✕ 移除筛选</button>
                </div>
              )}
              <div className="toolbar">
                <input className="search-input" placeholder="🔍 搜索学生姓名或ID..." value={search} onChange={e => setSearch(e.target.value)} />
                <button className="btn btn-primary" onClick={() => setShowAddStudent(true)} disabled={classes.length === 0}>＋ 录入学生</button>
                <button className="btn btn-secondary" onClick={() => { setImportResult(null); setImportFile(null); setShowImportStudents(true); }} disabled={classes.length === 0}>📂 批量导入学生</button>
                <button className="btn btn-secondary" onClick={() => setShowAddScore(true)} disabled={students.length === 0}>🧠 录入与评测</button>
                <button className="btn btn-secondary" onClick={() => { setImportResult(null); setImportFile(null); setShowImportScores(true); }} disabled={exams.length === 0}>📥 批量导入成绩</button>
                <button className="btn btn-danger" onClick={handleBulkDeleteStudents} disabled={submitting || selectedStudentIds.length === 0}>🗑 批量删除学生{selectedStudentIds.length ? ` (${selectedStudentIds.length})` : ''}</button>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th style={{ width: 44 }}><input type="checkbox" checked={allVisibleChecked} onChange={e => {
                    if (e.target.checked) {
                      setSelectedStudentIds(prev => [...new Set([...prev, ...allFilteredIds])]);
                    } else {
                      const removeSet = new Set(allFilteredIds.map(Number));
                      setSelectedStudentIds(prev => prev.filter(id => !removeSet.has(Number(id))));
                    }
                  }} /></th><th>学生ID</th><th>姓名</th><th>归属班级</th><th>家长</th><th>最近考试</th><th>得分</th><th>操作</th></tr></thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={8}><div className="loading-overlay"><span className="loading-spinner"></span></div></td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty-state"><div className="icon">👨‍🎓</div><p>暂无学生，请点击"录入学生"或"批量导入"</p></div></td></tr>
                    ) : filtered.map(s => {
                      const pct = s.lastExam ? s.lastExam.score / s.lastExam.total_score * 100 : null;
                      return (
                        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/teacher/student/${s.id}`)}>
                          <td onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedSet.has(Number(s.id))}
                              onChange={e => {
                                if (e.target.checked) setSelectedStudentIds(prev => [...new Set([...prev, Number(s.id)])]);
                                else setSelectedStudentIds(prev => prev.filter(id => Number(id) !== Number(s.id)));
                              }}
                            />
                          </td>
                          <td><span className="badge badge-gray">{s.display_student_id || s.student_code}</span></td>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</td>
                          <td>
                            <span className="badge badge-purple" style={{ marginRight: '6px' }}>{s.subject}</span>
                            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{s.teacher_class}</span>
                          </td>
                          <td>
                            <div style={{ color: 'var(--text-primary)' }}>{s.parent_name}</div>
                            <div className="text-sm text-muted">{s.parent_phone}</div>
                          </td>
                          <td>{s.lastExam?.exam_name || '-'}<br /><span className="text-sm text-muted">{s.lastExam?.exam_date || ''}</span></td>
                          <td>{pct !== null ? <span className={`font-bold ${pct >= 80 ? 'score-high' : pct >= 60 ? 'score-mid' : 'score-low'}`}>{s.lastExam.score}/{s.lastExam.total_score}</span> : '-'}</td>
                          <td onClick={e => e.stopPropagation()}><button className="btn btn-sm btn-secondary" onClick={() => router.push(`/teacher/student/${s.id}`)}>详情</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ===================== EXAMS TAB ===================== */}
          {activeTab === 'exams' && (
            <>
              <div className="toolbar">
                <button className="btn btn-primary" onClick={() => setShowAddExam(true)}>＋ 创建考试</button>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>考试名称</th><th>科目</th><th>归属班级</th><th>日期</th><th>满分</th><th>操作</th></tr></thead>
                  <tbody>
                    {exams.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><div className="icon">📝</div><p>暂无考试</p></div></td></tr>
                    ) : exams.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{e.name}</td>
                        <td><span className="badge badge-blue">{e.subject}</span></td>
                        <td>{e.teacher_class}</td>
                        <td>{e.exam_date}</td>
                        <td>{e.total_score}分</td>
                        <td>
                          <button className="btn btn-sm btn-secondary" style={{ marginRight: 6 }} onClick={() => setShowAddScore(true)}>进入评测</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => { setImportExamId(String(e.id)); setImportFile(null); setImportResult(null); setShowImportScores(true); }}>批量导入</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ===================== ALERTS TAB ===================== */}
          {activeTab === 'alerts' && (
            <div>
              {alerts.length === 0 ? <div className="empty-state"><div className="icon">✅</div><p>暂无告警信息</p></div>
                : alerts.map(a => (
                  <div key={a.id} className={`alert-item ${!a.is_read ? 'unread' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="badge badge-red">学生异常</span>
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
      </main>

      {/* =================== ADD STUDENT MODAL =================== */}
      {showAddStudent && (
        <div className="modal-overlay" onClick={() => setShowAddStudent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">录入新学生</span><button className="modal-close" onClick={() => setShowAddStudent(false)}>✕</button></div>
            <form onSubmit={handleAddStudent}>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">选择归属班级 *</label>
                  <select className="form-select" value={studentForm.teacher_id} onChange={e => setStudentForm(f => ({ ...f, teacher_id: e.target.value }))} required>
                    <option value="">-- 选择班级 --</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.class_name} ({c.subject})</option>)}
                  </select>
                </div>
                {[['student_code', '学生ID（可自定义）', '留空则系统自动生成'], ['name', '姓名 *', ''], ['parent_name', '家长姓名', ''], ['parent_phone', '家长电话', '']].map(([key, label, placeholder]) => (
                  <div key={key} className="form-group">
                    <label className="form-label">{label}</label>
                    <input className="form-input" placeholder={placeholder} value={studentForm[key]} onChange={e => setStudentForm(f => ({ ...f, [key]: e.target.value }))} required={key === 'name'} />
                  </div>
                ))}
              </div>
              <div className="form-group"><label className="form-label">备注</label><textarea className="form-textarea" value={studentForm.notes} onChange={e => setStudentForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddStudent(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '保存中...' : '💾 保存'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================== ADD EXAM MODAL =================== */}
      {showAddExam && (
        <div className="modal-overlay" onClick={() => setShowAddExam(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">创建考试</span><button className="modal-close" onClick={() => setShowAddExam(false)}>✕</button></div>
            <form onSubmit={handleAddExam}>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">归属班级 *</label>
                  <select className="form-select" value={examForm.teacher_id} onChange={e => {
                    const t_id = e.target.value;
                    const c = classes.find(cl => cl.id === parseInt(t_id));
                    setExamForm(f => ({ ...f, teacher_id: t_id, subject: c ? c.subject : f.subject }));
                  }} required>
                    <option value="">-- 选择班级 --</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.class_name} ({c.subject})</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">考试名称 *</label><input className="form-input" value={examForm.name} onChange={e => setExamForm(f => ({ ...f, name: e.target.value }))} required /></div>
                <div className="form-group"><label className="form-label">科目 *</label><input className="form-input" value={examForm.subject} onChange={e => setExamForm(f => ({ ...f, subject: e.target.value }))} required /></div>
                <div className="form-group"><label className="form-label">考试日期 *</label><input className="form-input" type="date" value={examForm.exam_date} onChange={e => setExamForm(f => ({ ...f, exam_date: e.target.value }))} required /></div>
                <div className="form-group"><label className="form-label">满分</label><input className="form-input" type="number" value={examForm.total_score} onChange={e => setExamForm(f => ({ ...f, total_score: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddExam(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '创建中...' : '✅ 创建'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================== ADD SCORE MODAL =================== */}
      {showAddScore && (
        <div className="modal-overlay" onClick={() => setShowAddScore(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">📊 录入与评测中心</span><button className="modal-close" onClick={() => setShowAddScore(false)}>✕</button></div>
            <div className="tab-nav" style={{ marginBottom: 14 }}>
              <button className={`tab-btn ${scoreMode === 'pose' ? 'active' : ''}`} onClick={() => setScoreMode('pose')}>体能评测</button>
              <button className={`tab-btn ${scoreMode === 'artwork' ? 'active' : ''}`} onClick={() => setScoreMode('artwork')}>书法/国画评测</button>
              <button className={`tab-btn ${scoreMode === 'objective' ? 'active' : ''}`} onClick={() => setScoreMode('objective')}>试卷自动判分</button>
            </div>

            {scoreMode === 'pose' && (
              <div>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">学生 *</label><select className="form-select" value={poseForm.studentId} onChange={async e => { const v = e.target.value; const list = await loadSessionsForStudent(v); const sid = list[0]?.id ? String(list[0].id) : ''; const latestTask = await loadLatestPoseTask(v); setPoseForm(f => ({ ...f, studentId: v, sessionId: sid, taskId: latestTask?.id ? String(latestTask.id) : '', taskStatus: latestTask?.status || '' })); if (sid) await loadSessionScores(sid); }}><option value="">-- 选择学生 --</option>{students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.display_student_id || s.student_code})</option>)}</select></div>
                  <div className="form-group"><label className="form-label">动作类型 *</label><select className="form-select" value={poseForm.exerciseType} onChange={e => setPoseForm(f => ({ ...f, exerciseType: e.target.value }))} required><option value="">-- 请选择 --</option>{exerciseOptions.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">视频URL（或上传后自动填充）*</label><input className="form-input" placeholder="https://..." value={poseForm.videoUrl} onChange={e => setPoseForm(f => ({ ...f, videoUrl: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">上传 mp4</label><input type="file" className="form-input" accept="video/mp4" onChange={handlePoseVideoFileChange} /></div>
                </div>
                <div className="form-group"><label className="form-label">能力项（可选）</label><select className="form-select" value={poseForm.dimensionKey} onChange={e => setPoseForm(f => ({ ...f, dimensionKey: e.target.value }))}><option value="">-- 通用证据 --</option>{sessionScores.map(s => <option key={s.id} value={s.dim_key}>{s.dim_name} ({s.dim_key})</option>)}</select></div>
                {poseForm.studentId && sessionOptions.length === 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>该学生暂无可用档案。体能视频提交后会先等待回调，回调完成并入库时系统会自动创建评估档案。</div>}
                {poseForm.studentId && sessionOptions.length > 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>系统已自动绑定该学生最近一次评估记录。</div>}
                <div className="form-group"><label className="form-label">备注</label><textarea className="form-textarea" value={poseForm.note} onChange={e => setPoseForm(f => ({ ...f, note: e.target.value }))} /></div>
                <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
                  任务ID：{poseForm.taskId || '-'}　|　任务状态：{poseForm.taskStatus || '-'}（JSON 不在页面展示）
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={submitting} onClick={submitPoseAssessment}>{submitting ? '提交中...' : '提交体能评测'}</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={checkPoseTaskAndIngest}>检查回调并入库</button>
                </div>

                {sessionScores.length > 0 && (
                  <div className="card" style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div className="text-sm" style={{ fontWeight: 600, color: 'var(--primary)' }}>📊 当前评定实时分数</div>
                        {!isEditingScores ? (
                            <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => {
                                setIsEditingScores(true);
                                const initial = {};
                                sessionScores.forEach(s => initial[s.dimension_id] = s.score);
                                setModifiedScores(initial);
                            }}>✏️ 手动改分</button>
                        ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={handleSaveRevisedScores} disabled={submitting}>💾 保存并同步</button>
                                <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setIsEditingScores(false)}>取消</button>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {sessionScores.map(s => (
                        <div key={s.id} className="text-sm" style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                          <div className="text-muted" style={{ fontSize: 11, marginBottom: 2 }}>{s.dim_name}</div>
                          {isEditingScores ? (
                              <input 
                                type="number" 
                                step="0.1" 
                                min="1" 
                                max="5" 
                                className="form-input" 
                                style={{ padding: '2px 4px', background: '#000', fontSize: 12, height: 24 }}
                                value={modifiedScores[s.dimension_id] ?? s.score}
                                onChange={e => setModifiedScores(prev => ({ ...prev, [s.dimension_id]: e.target.value }))}
                              />
                          ) : (
                              <span style={{ fontWeight: 600, color: '#fff' }}>{s.score}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {isEditingScores && (
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                            💡 提示：手动修改后，AI 会“学习”你的打分偏好。分数范围 1.0 - 5.0。
                        </p>
                    )}
                  </div>
                )}
                <hr className="divider" />
                <div className="form-group">
                  <label className="form-label">批量导入动作视频（CSV）</label>
                  <input type="file" className="form-input" accept=".csv" onChange={e => setPoseBatchFile(e.target.files?.[0] || null)} />
                  <p className="text-sm text-muted">列名示例：student_id,student_name,url,video_name,duration_sec（支持 student_id 或 student_name 自动匹配）</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={runPoseBatchImport}>批量提交体能评测</button>
              </div>
            )}

            {scoreMode === 'artwork' && (
              <div>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">学生 *</label><select className="form-select" value={artworkForm.studentId} onChange={async e => { const v = e.target.value; const list = await loadSessionsForStudent(v); const sid = list[0]?.id ? String(list[0].id) : ''; setArtworkForm(f => ({ ...f, studentId: v, sessionId: sid })); if (sid) await loadSessionScores(sid); }}><option value="">-- 选择学生 --</option>{students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.display_student_id || s.student_code})</option>)}</select></div>
                  <div className="form-group"><label className="form-label">作品类型</label><select className="form-select" value={artworkForm.artType} onChange={e => setArtworkForm(f => ({ ...f, artType: e.target.value }))}><option value="calligraphy">书法</option><option value="painting">国画</option></select></div>
                  <div className="form-group"><label className="form-label">作品图片</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => artworkFileInputRef.current?.click()}>📁 选择图片</button><input ref={artworkFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleArtworkFileChange} /><div className="text-sm text-muted" style={{ marginTop: 6 }}>{artworkForm.imageName || '未选择文件'}</div></div>
                  <div className="form-group"><label className="form-label">图片URL</label><input className="form-input" placeholder="https://..." value={artworkForm.imageUrl} onChange={e => setArtworkForm(f => ({ ...f, imageUrl: e.target.value }))} /></div>
                </div>
                <div className="form-group"><label className="form-label">能力项（可选）</label><select className="form-select" value={artworkForm.dimensionKey} onChange={e => setArtworkForm(f => ({ ...f, dimensionKey: e.target.value }))}><option value="">-- 通用证据 --</option>{sessionScores.map(s => <option key={s.id} value={s.dim_key}>{s.dim_name} ({s.dim_key})</option>)}</select></div>
                {artworkForm.studentId && sessionOptions.length === 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>该学生暂无可用档案，请先在学生详情中创建AI评估。</div>}
                {artworkForm.studentId && sessionOptions.length > 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>系统已自动绑定该学生最近一次评估记录。</div>}
                <div className="form-group"><label className="form-label">备注</label><textarea className="form-textarea" value={artworkForm.note} onChange={e => setArtworkForm(f => ({ ...f, note: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={loadArtworkFromUrl}>从URL加载图片</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={analyzeArtwork}>分析作品细节</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={submitting} onClick={ingestArtworkEvidence}>写入评定证据</button>
                </div>
                <div className="form-group">
                  <label className="form-label">批量导入作品URL（CSV）</label>
                  <input type="file" className="form-input" accept=".csv" onChange={e => setArtworkBatchFile(e.target.files?.[0] || null)} />
                  <p className="text-sm text-muted">列名示例：student_id,student_name,url,art_type（支持 student_id 或 student_name 自动匹配）</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={runArtworkBatchImport}>批量分析并入库</button>
                {artworkForm.analysisResult && (
                  <div className="card" style={{ padding: 10 }}>
                    <div className="text-sm text-muted">维度建议分：{JSON.stringify(artworkForm.analysisResult.dimensionHints || {})}</div>
                    <pre style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(artworkForm.analysisResult.cvMetrics || {}, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}

            {scoreMode === 'objective' && (
              <div>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">学生 *</label><select className="form-select" value={objectiveForm.studentId} onChange={async e => { const v = e.target.value; const list = await loadSessionsForStudent(v); const sid = list[0]?.id ? String(list[0].id) : ''; setObjectiveForm(f => ({ ...f, studentId: v, sessionId: sid })); if (sid) await loadSessionScores(sid); }}><option value="">-- 选择学生 --</option>{students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.display_student_id || s.student_code})</option>)}</select></div>
                  <div className="form-group"><label className="form-label">科目</label><select className="form-select" value={objectiveForm.subjectType} onChange={e => setObjectiveForm(f => ({ ...f, subjectType: e.target.value }))}><option value="psychology">心理</option><option value="gratitude">感恩</option><option value="classics">国学</option><option value="rule_of_law">法治</option></select></div>
                  <div className="form-group"><label className="form-label">能力项（可选）</label><select className="form-select" value={objectiveForm.dimensionKey} onChange={e => setObjectiveForm(f => ({ ...f, dimensionKey: e.target.value }))}><option value="">-- 通用证据 --</option>{sessionScores.map(s => <option key={s.id} value={s.dim_key}>{s.dim_name} ({s.dim_key})</option>)}</select></div>
                  <div className="form-group"><label className="form-label">试卷图片 *</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => objectivePaperInputRef.current?.click()}>📁 上传试卷</button><input ref={objectivePaperInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleObjectivePaperFileChange} /><div className="text-sm text-muted" style={{ marginTop: 6 }}>{objectiveForm.paperImageName || '未选择文件'}</div></div>
                </div>
                <div className="form-group"><label className="form-label">备注</label><textarea className="form-textarea" value={objectiveForm.note} onChange={e => setObjectiveForm(f => ({ ...f, note: e.target.value }))} /></div>
                {objectiveForm.studentId && sessionOptions.length === 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>该学生暂无可用档案，请先在学生详情中创建AI评估。</div>}
                {objectiveForm.studentId && sessionOptions.length > 0 && <div className="text-sm text-muted" style={{ marginTop: -4, marginBottom: 10 }}>系统已自动绑定该学生最近一次评估记录，并自动匹配RAG答案标准。</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={submitting} onClick={gradeObjectiveAndIngest}>上传试卷自动判分并入库</button>
                </div>
                {objectiveForm.extractedItems?.length > 0 && (
                  <div className="text-sm text-muted" style={{ marginTop: 8 }}>
                    已识别题目：{objectiveForm.extractedItems.map(it => `${it.questionNo}:${it.studentAnswer}->${it.correctAnswer}`).join('；')}
                  </div>
                )}
                {objectiveForm.lastResult && (
                  <div className="text-sm text-muted" style={{ marginTop: 8 }}>
                    判分结果：正确 {objectiveForm.lastResult.correctQuestions}/{objectiveForm.lastResult.totalQuestions}，准确率 {objectiveForm.lastResult.accuracyPct}% ，映射分 {objectiveForm.lastResult.mappedScore1to5}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================== IMPORT STUDENTS MODAL =================== */}
      {showImportStudents && (
        <ImportModal
          title="📂 批量导入学生"
          templateLabel="学生导入模板"
          onDownloadTemplate={() => downloadTemplate('students')}
          templateNote="列名：姓名（必填）、家长姓名、家长电话、备注"
          onFileChange={setImportFile}
          file={importFile}
          onImport={() => handleImport('students')}
          importing={importing}
          result={importResult}
          onClose={() => { setShowImportStudents(false); setImportResult(null); }}
          extraContent={
            <div className="form-group">
              <label className="form-label">导入到班级 *</label>
              <select className="form-select" value={importClassId} onChange={e => setImportClassId(e.target.value)} required>
                <option value="">-- 选择目标班级 --</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.class_name} ({c.subject})</option>)}
              </select>
            </div>
          }
        />
      )}

      {/* =================== IMPORT SCORES MODAL =================== */}
      {showImportScores && (
        <ImportModal
          title="📥 批量导入成绩"
          templateLabel="成绩导入模板"
          onDownloadTemplate={() => downloadTemplate('scores')}
          templateNote="列名：学生姓名（或学生ID）、分数（必填）"
          onFileChange={setImportFile}
          file={importFile}
          onImport={() => handleImport('scores')}
          importing={importing}
          result={importResult}
          onClose={() => { setShowImportScores(false); setImportResult(null); }}
          extraContent={
            <div className="form-group">
              <label className="form-label">选择对应考试 *</label>
              <select className="form-select" value={importExamId} onChange={e => setImportExamId(e.target.value)} required>
                <option value="">-- 选择考试 --</option>
                {exams.map(e => <option key={e.id} value={e.id}>{e.name} ({e.exam_date})</option>)}
              </select>
            </div>
          }
        />
      )}

      {/* =================== ADD CLASS MODAL =================== */}
      {showAddClass && (
        <div className="modal-overlay" onClick={() => setShowAddClass(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🏫 添加新班级</span>
              <button className="modal-close" onClick={() => setShowAddClass(false)}>✕</button>
            </div>
            <form onSubmit={handleAddClass}>
              <div className="form-group">
                <label className="form-label">班级名称 *</label>
                <input className="form-input" placeholder="例如：高二(1)班" value={classForm.className} onChange={e => setClassForm(f => ({ ...f, className: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">授课科目 *</label>
                <input className="form-input" placeholder="例如：数学" value={classForm.subject} onChange={e => setClassForm(f => ({ ...f, subject: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">班级飞书 Webhook (选填)</label>
                <input className="form-input" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." value={classForm.webhookUrl} onChange={e => setClassForm(f => ({ ...f, webhookUrl: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>可以直接随班级绑定飞书告警组</p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddClass(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '保存中...' : '✅ 保存'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================== EDIT WEBHOOK MODAL =================== */}
      {showWebhookEdit && (
        <div className="modal-overlay" onClick={() => setShowWebhookEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">⚙️ 配置班级飞书告警</span>
              <button className="modal-close" onClick={() => setShowWebhookEdit(false)}>✕</button>
            </div>
            <form onSubmit={handleUpdateWebhook}>
              <div className="form-group">
                <label className="form-label">专属飞书机器人 Webhook URL</label>
                <input 
                  type="url" 
                  className="form-input" 
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." 
                  value={webhookEditForm.webhookUrl}
                  onChange={e => setWebhookEditForm(f => ({ ...f, webhookUrl: e.target.value }))}
                />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                  配置后，当该班级的学生成绩出现严重下滑、或错题反复出错时，AI 小助手将直接向此飞书群发送告警信息。
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowWebhookEdit(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? '保存中...' : '💾 保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =================== Reusable Import Modal Component ===================
function ImportModal({ title, templateLabel, onDownloadTemplate, templateNote, onFileChange, file, onImport, importing, result, onClose, extraContent }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Step 1: Download Template */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>第一步：下载模板</div>
          <button className="btn btn-secondary" onClick={onDownloadTemplate}>⬇️ 下载 {templateLabel}</button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{templateNote}</p>
        </div>

        <hr className="divider" />

        {/* Step 2: Upload */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>第二步：上传填写好的文件</div>
          {extraContent}
          <div className="form-group">
            <label className="form-label">选择文件（.xlsx 或 .csv）</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="form-input"
              style={{ padding: '8px' }}
              onChange={e => onFileChange(e.target.files[0])}
            />
          </div>
        </div>

        {/* Result */}
        {result && (
          <div style={{
            padding: '14px 16px',
            background: result.errorCount === 0 ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${result.errorCount === 0 ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
            borderRadius: 8, marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{result.message}</div>
            {result.errors?.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {result.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
          <button
            className="btn btn-primary"
            onClick={onImport}
            disabled={importing || !file}
          >
            {importing ? <><span className="loading-spinner"></span> 导入中...</> : '🚀 开始导入'}
          </button>
        </div>
      </div>
    </div>
  );
}

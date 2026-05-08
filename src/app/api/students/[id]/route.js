import { NextResponse } from 'next/server';
const db = require('../../../../lib/db');
const { requireAuth } = require('../../../../lib/auth');
const { analyzeStudentLearning } = require('../../../../lib/ai-service');
const { listDocuments } = require('../../../../lib/rag-service');

function normalizeCourseKey(v) {
  return String(v || '').trim().toLowerCase();
}

function getDefaultRadarItemsByType(templateType) {
  const template = db.prepare(`
    SELECT id
    FROM evaluation_templates
    WHERE template_type = ? AND active = 1
    ORDER BY version DESC, id DESC
    LIMIT 1
  `).get(templateType);
  if (!template) return [];
  return db.prepare(`
    SELECT d.dim_key, d.dim_name, d.sort_order
    FROM evaluation_dimensions d
    WHERE d.template_id = ?
    ORDER BY d.sort_order ASC, d.id ASC
    LIMIT 6
  `).all(template.id);
}

function buildCourseAnalysis(studentCourses, examRecords, evaluationSessions, studentAlerts, radarGuard = {}) {
  const qualityDefaults = getDefaultRadarItemsByType('quality');
  const fitnessDefaults = getDefaultRadarItemsByType('fitness');
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hashCode = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
    return Math.abs(h);
  };
  const buildSyntheticRadar = (defaults, baseScore, seedKey) => {
    const offsets = [-0.35, 0.2, -0.1, 0.15, -0.2, 0.3];
    const seed = hashCode(seedKey || 'course');
    return Array.from({ length: 6 }).map((_, idx) => {
      const base = defaults[idx] || null;
      const offset = offsets[(idx + seed) % offsets.length];
      return {
        label: base?.dim_name || `维度${idx + 1}`,
        dimKey: base?.dim_key || '',
        score: Number(clamp((baseScore || 0) + offset, 0, 5).toFixed(2)),
      };
    });
  };

  const courseList = studentCourses.map(c => ({
    key: c.course_name,
    name: c.course_name,
    status: c.status || 'active',
    source: c.source || 'unknown',
    courseCategory: c.course_category || 'other',
  }));

  const anomaliesByCourse = {};
  for (const c of courseList) anomaliesByCourse[c.key] = [];
  const ungroupedAlerts = [];
  const examNameSubjectPairs = (examRecords || [])
    .map(r => ({
      examName: String(r.exam_name || '').trim().toLowerCase(),
      subject: String(r.subject || '').trim(),
    }))
    .filter(r => r.examName && r.subject);
  for (const a of (studentAlerts || [])) {
    const rawText = `${String(a.message || '')} ${String(a.detail || '')}`;
    const text = rawText.toLowerCase();
    let bestCourseKey = '';
    let bestScore = -1;

    const explicitSubjectMatch = rawText.match(/科目\s*[:：]\s*([^\s,，。；;]+)/i);
    if (explicitSubjectMatch?.[1]) {
      const explicit = normalizeCourseKey(explicitSubjectMatch[1]);
      for (const c of courseList) {
        const key = normalizeCourseKey(c.key);
        if (!key) continue;
        if (key === explicit || key.includes(explicit) || explicit.includes(key)) {
          bestCourseKey = c.key;
          bestScore = 1000;
          break;
        }
      }
    }

    for (const c of courseList) {
      const key = String(c.key || '').trim().toLowerCase();
      if (!key) continue;
      let score = -1;
      if (text.includes(key)) {
        score = Math.max(score, key.length * 10);
      }
      for (const pair of examNameSubjectPairs) {
        if (text.includes(pair.examName) && normalizeCourseKey(pair.subject) === normalizeCourseKey(c.key)) {
          score = Math.max(score, 120);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCourseKey = c.key;
      }
    }
    if (bestScore > 0 && bestCourseKey) anomaliesByCourse[bestCourseKey].push(a);
    else ungroupedAlerts.push(a);
  }

  const courseMetrics = {};
  for (const c of courseList) {
    const key = c.key;
    const exams = examRecords.filter(r => {
      const subject = normalizeCourseKey(r.subject);
      const examName = normalizeCourseKey(r.exam_name);
      const courseName = normalizeCourseKey(key);
      return subject === courseName || examName.includes(courseName);
    });
    const avgPct = exams.length
      ? exams.reduce((sum, e) => sum + ((e.score / e.total_score) * 100), 0) / exams.length
      : null;
    const mapped = avgPct === null ? 3 : clamp(avgPct / 20, 1, 5);
    const qualityBase = c.courseCategory === 'fitness' ? mapped - 0.3 : mapped;
    const fitnessBase = c.courseCategory === 'fitness' ? mapped : mapped - 0.3;
    const qualityAllowed = Boolean(radarGuard?.quality?.canDisplay);
    const fitnessAllowed = Boolean(radarGuard?.fitness?.canDisplay);
    courseMetrics[key] = {
      examCount: exams.length,
      exams,
      avgPct,
      abnormalAlerts: (anomaliesByCourse[key] || []).slice(0, 20),
      latestEvaluation: evaluationSessions[0] || null,
      courseRadar: {
        quality: qualityAllowed ? buildSyntheticRadar(qualityDefaults, qualityBase, `${key}-quality`) : [],
        fitness: fitnessAllowed ? buildSyntheticRadar(fitnessDefaults, fitnessBase, `${key}-fitness`) : [],
      },
    };
  }

  const overview = {
    groupedAnomalies: courseList.map(c => ({
      courseKey: c.key,
      courseName: c.name,
      alerts: anomaliesByCourse[c.key] || [],
    })).filter(g => g.alerts.length > 0).concat(
      ungroupedAlerts.length > 0
        ? [{ courseKey: '__others__', courseName: '其他', alerts: ungroupedAlerts }]
        : []
    ),
    ungroupedAlerts,
  };

  return {
    courseList,
    selectedCourseDefault: '__overview__',
    courseMetrics,
    overview,
  };
}

// GET - 获取单个学生详情
export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { id } = params;
  // Only teachers and bosses can access
  const studentInfo = db.prepare(`
    SELECT s.*, u.name as teacher_name, t.subject, t.class_name as teacher_class
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(id, user.id, user.role);

  if (!studentInfo) return NextResponse.json({ error: '学生不存在' }, { status: 404 });
  const identityCode = (studentInfo.global_student_id && String(studentInfo.global_student_id).trim())
    ? String(studentInfo.global_student_id).trim()
    : String(studentInfo.student_code || '').trim();

  const linkedRows = db.prepare(`
    SELECT id FROM students
    WHERE (global_student_id = ? AND global_student_id IS NOT NULL AND TRIM(global_student_id) != '')
       OR student_code = ?
  `).all(identityCode, identityCode);
  const linkedIds = linkedRows.length ? linkedRows.map(r => r.id) : [parseInt(id, 10)];
  const placeholders = linkedIds.map(() => '?').join(',');

  // 考试成绩记录
  const examRecords = db.prepare(`
    SELECT er.*, e.name as exam_name, e.subject, e.exam_date, e.total_score
    FROM exam_records er
    JOIN exams e ON er.exam_id = e.id
    WHERE er.student_id IN (${placeholders})
    ORDER BY e.exam_date ASC
  `).all(...linkedIds);

  // 错题记录
  const wrongQuestions = db.prepare(`
    SELECT wq.*, e.name as exam_name, e.exam_date
    FROM wrong_questions wq
    JOIN exam_records er ON wq.exam_record_id = er.id
    JOIN exams e ON er.exam_id = e.id
    WHERE er.student_id IN (${placeholders})
    ORDER BY e.exam_date DESC
  `).all(...linkedIds);

  const boundCourses = db.prepare(`
    SELECT sc.*, c.name as course_name, c.category as course_category, u.name as teacher_name
    FROM student_courses sc
    JOIN courses c ON sc.course_id = c.id
    JOIN teachers t ON sc.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE sc.student_id IN (${placeholders})
    ORDER BY sc.created_at DESC
  `).all(...linkedIds);

  const examSubjects = db.prepare(`
    SELECT DISTINCT e.subject
    FROM exam_records er
    JOIN exams e ON er.exam_id = e.id
    WHERE er.student_id IN (${placeholders}) AND e.subject IS NOT NULL AND TRIM(e.subject) != ''
    ORDER BY e.subject ASC
  `).all(...linkedIds).map(r => r.subject);

  const linkedClassSubjects = db.prepare(`
    SELECT DISTINCT t.subject, u.name as teacher_name
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE s.id IN (${placeholders}) AND t.subject IS NOT NULL AND TRIM(t.subject) != ''
    ORDER BY t.subject ASC
  `).all(...linkedIds);

  const merged = [];
  const seen = new Set();
  const pushCourse = (item) => {
    const key = String(item.course_name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };

  boundCourses.forEach(c => pushCourse({ ...c, source: 'bound_course' }));

  linkedClassSubjects.forEach((row, idx) => {
    pushCourse({
      id: `inferred-class-${id}-${idx}`,
      course_name: String(row.subject).trim(),
      course_category: 'other',
      status: 'active',
      teacher_name: row.teacher_name || studentInfo.teacher_name,
      source: 'class_subject',
      notes: '由班级学科推断',
    });
  });

  examSubjects.forEach((subject, idx) => {
    pushCourse({
      id: `inferred-exam-${id}-${idx}`,
      course_name: subject,
      course_category: 'other',
      status: 'completed',
      teacher_name: studentInfo.teacher_name,
      source: 'exam_subject',
      notes: '由历史考试学科推断',
    });
  });

  const studentCourses = merged;

  const evaluationSessions = db.prepare(`
    SELECT es.id, es.status, es.summary, es.created_at, es.finalized_at,
           et.name as template_name, et.template_type
    FROM evaluation_sessions es
    JOIN evaluation_templates et ON es.template_id = et.id
    WHERE es.student_id IN (${placeholders})
    ORDER BY es.created_at DESC
    LIMIT 20
  `).all(...linkedIds);

  const latestFinalByTypeRows = db.prepare(`
    SELECT es.id as session_id, et.template_type
    FROM evaluation_sessions es
    JOIN evaluation_templates et ON es.template_id = et.id
    WHERE es.student_id IN (${placeholders}) AND es.status = 'final'
    ORDER BY COALESCE(es.finalized_at, es.created_at) DESC
  `).all(...linkedIds);
  const latestFinalByType = {};
  for (const row of latestFinalByTypeRows) {
    if (!latestFinalByType[row.template_type]) latestFinalByType[row.template_type] = row.session_id;
  }

  function buildRadar(type) {
    const sessionId = latestFinalByType[type];
    const defaultItems = getDefaultRadarItemsByType(type);
    const scores = sessionId ? db.prepare(`
      SELECT d.dim_key, d.dim_name, d.sort_order, eds.score
      FROM evaluation_dimension_scores eds
      JOIN evaluation_dimensions d ON eds.dimension_id = d.id
      WHERE eds.session_id = ?
      ORDER BY d.sort_order ASC, d.id ASC
    `).all(sessionId) : [];
    const byKey = {};
    scores.forEach(s => { byKey[s.dim_key] = s; });

    return {
      templateType: type,
      items: Array.from({ length: 6 }).map((_, idx) => {
        const base = scores[idx] || defaultItems[idx] || null;
        return {
          label: base?.dim_name || `维度${idx + 1}`,
          dimKey: base?.dim_key || '',
          score: scores[idx] ? Number(scores[idx].score || 0) : 0,
        };
      }),
    };
  }

  function buildTemplateSessionRadars(templateType, fallbackLabelPrefix) {
    const defaultItems = getDefaultRadarItemsByType(templateType);
    const finalSessions = db.prepare(`
      SELECT es.id, es.created_at, es.finalized_at, es.summary
      FROM evaluation_sessions es
      JOIN evaluation_templates et ON es.template_id = et.id
      WHERE es.student_id IN (${placeholders})
        AND et.template_type = ?
        AND es.status = 'final'
      ORDER BY COALESCE(es.finalized_at, es.created_at) DESC
      LIMIT 12
    `).all(...linkedIds, templateType);

    const sessionRadars = finalSessions.map(s => {
      const scores = db.prepare(`
        SELECT d.dim_key, d.dim_name, d.sort_order, eds.score
        FROM evaluation_dimension_scores eds
        JOIN evaluation_dimensions d ON eds.dimension_id = d.id
        WHERE eds.session_id = ?
        ORDER BY d.sort_order ASC, d.id ASC
      `).all(s.id);
      const byKey = {};
      scores.forEach(row => { byKey[row.dim_key] = row; });
      const items = Array.from({ length: 6 }).map((_, idx) => {
        const base = defaultItems[idx] || scores[idx] || null;
        const hit = base?.dim_key ? byKey[base.dim_key] : scores[idx];
        return {
          label: base?.dim_name || `${fallbackLabelPrefix}${idx + 1}`,
          dimKey: base?.dim_key || '',
          score: hit ? Number(hit.score || 0) : 0,
        };
      });
      return {
        sessionId: s.id,
        title: s.summary ? String(s.summary).slice(0, 40) : `${templateType}评测#${s.id}`,
        createdAt: s.created_at,
        finalizedAt: s.finalized_at,
        items,
      };
    });

    const composite = Array.from({ length: 6 }).map((_, idx) => {
      const label = sessionRadars[0]?.items?.[idx]?.label
        || defaultItems[idx]?.dim_name
        || `${fallbackLabelPrefix}${idx + 1}`;
      const dimKey = sessionRadars[0]?.items?.[idx]?.dimKey || defaultItems[idx]?.dim_key || '';
      const vals = sessionRadars.map(r => Number(r.items[idx]?.score || 0)).filter(v => Number.isFinite(v));
      const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      return { label, dimKey, score: Number(avg.toFixed(2)) };
    });

    return { sessionRadars, compositeRadar: { templateType: `${templateType}_composite`, items: composite } };
  }

  function checkPrivateStandardReady(templateType) {
    const defaults = getDefaultRadarItemsByType(templateType);
    if (!defaults.length) return { standardReady: false, missingDimKeys: [] };
    const docs = listDocuments().filter(d =>
      d.docType === 'evaluation_standard'
      && String(d.metadata?.template_type || '') === String(templateType)
      && String(d.metadata?.owner_scope || '') === 'org_private'
    );
    const dimSet = new Set(docs.map(d => String(d.metadata?.dim_key || '').trim()).filter(Boolean));
    const missing = defaults.map(d => d.dim_key).filter(k => !dimSet.has(String(k || '').trim()));
    return { standardReady: missing.length === 0, missingDimKeys: missing };
  }

  const studentAlerts = db.prepare(`
    SELECT id, type, message, detail, sent_feishu, is_read, created_at
    FROM alerts
    WHERE type = 'student_abnormal' AND target_id IN (${placeholders})
    ORDER BY created_at DESC
    LIMIT 50
  `).all(...linkedIds);

  const fullAnalysis = {
    profile: {
      studentId: studentInfo.id,
      studentCode: studentInfo.global_student_id || studentInfo.student_code,
      name: studentInfo.name,
      grade: studentInfo.grade || '',
      className: studentInfo.class_name || '',
      teacherName: studentInfo.teacher_name || '',
    },
    summary: {
      courseCount: studentCourses.length,
      examCount: examRecords.length,
      wrongQuestionCount: wrongQuestions.length,
      evaluationCount: evaluationSessions.length,
      alertCount: studentAlerts.length,
    },
  };

  const fitnessProgress = buildTemplateSessionRadars('fitness', '体能维度');
  const qualityProgress = buildTemplateSessionRadars('quality', '素质维度');
  const fitnessStd = checkPrivateStandardReady('fitness');
  const qualityStd = checkPrivateStandardReady('quality');
  const radarGuard = {
    quality: {
      standardReady: qualityStd.standardReady,
      hasFinalSession: qualityProgress.sessionRadars.length > 0,
      canDisplay: qualityStd.standardReady && qualityProgress.sessionRadars.length > 0,
      missingDimKeys: qualityStd.missingDimKeys,
    },
    fitness: {
      standardReady: fitnessStd.standardReady,
      hasFinalSession: fitnessProgress.sessionRadars.length > 0,
      canDisplay: fitnessStd.standardReady && fitnessProgress.sessionRadars.length > 0,
      missingDimKeys: fitnessStd.missingDimKeys,
    },
  };
  const courseAnalysis = buildCourseAnalysis(studentCourses, examRecords, evaluationSessions, studentAlerts, radarGuard);
  const radarData = {
    quality: radarGuard.quality.canDisplay ? buildRadar('quality') : { templateType: 'quality', items: [] },
    fitness: radarGuard.fitness.canDisplay ? buildRadar('fitness') : { templateType: 'fitness', items: [] },
    fitnessComposite: radarGuard.fitness.canDisplay ? fitnessProgress.compositeRadar : { templateType: 'fitness_composite', items: [] },
    fitnessSessions: radarGuard.fitness.canDisplay ? fitnessProgress.sessionRadars : [],
    qualityComposite: radarGuard.quality.canDisplay ? qualityProgress.compositeRadar : { templateType: 'quality_composite', items: [] },
    qualitySessions: radarGuard.quality.canDisplay ? qualityProgress.sessionRadars : [],
  };

  return NextResponse.json({
    student: studentInfo,
    examRecords,
    wrongQuestions,
    studentCourses,
    evaluationSessions,
    studentAlerts,
    fullAnalysis,
    courseAnalysis,
    radarData,
    radarGuard,
  });
}

// PUT - 更新学生信息
export async function PUT(request, { params }) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { id } = params;
  const body = await request.json();
  const { name, grade, class_name, birth_date, parent_name, parent_phone, notes } = body;

  db.prepare(`
    UPDATE students
    SET name = ?, grade = ?, class_name = ?, birth_date = ?, parent_name = ?, parent_phone = ?, notes = ?
    WHERE id = ? AND teacher_id IN (SELECT id FROM teachers WHERE user_id = ?)
  `).run(name, grade, class_name, birth_date, parent_name, parent_phone, notes, id, user.id);

  return NextResponse.json({ success: true });
}

// DELETE - 删除学生
export async function DELETE(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const { id } = params;
  const parsedId = parseInt(id, 10);
  if (Number.isNaN(parsedId)) return NextResponse.json({ error: '学生ID无效' }, { status: 400 });

  let result;
  if (user.role === 'boss') {
    result = db.prepare(`DELETE FROM students WHERE id = ?`).run(parsedId);
  } else {
    result = db.prepare(`
      DELETE FROM students WHERE id = ? AND teacher_id IN (SELECT id FROM teachers WHERE user_id = ?)
    `).run(parsedId, user.id);
  }
  if (!result || result.changes === 0) {
    return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

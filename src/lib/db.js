// 使用 Node.js 内置 SQLite 模块（Node 22+，无需原生依赖）
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve('./data/education.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

// 启用 WAL 模式
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// ── 兼容旧数据库调用方式的 prepare 包装 ──────────────────────────────────────
// node:sqlite 的 prepare() 返回 StatementSync，API 略有差异：
//   - run()  → 返回 { changes, lastInsertRowid }
//   - get()  → 返回单行对象或 undefined
//   - all()  → 返回数组
// 下面用薄包装让调用代码无需改动。

const _origPrepare = db.prepare.bind(db);
db.prepare = function (sql) {
  const stmt = _origPrepare(sql);
  return stmt; // node:sqlite StatementSync 已有 run/get/all，形参相同
};

// 初始化表结构
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('boss', 'teacher')),
      name TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT,
      class_name TEXT,
      feishu_webhook TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_code TEXT UNIQUE NOT NULL,
      global_student_id TEXT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      grade TEXT,
      class_name TEXT,
      birth_date TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      total_score REAL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS exam_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      ai_analysis TEXT,
      ai_suggestions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, exam_id)
    );

    CREATE TABLE IF NOT EXISTS wrong_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_record_id INTEGER NOT NULL REFERENCES exam_records(id) ON DELETE CASCADE,
      question_number INTEGER,
      question_content TEXT NOT NULL,
      student_answer TEXT,
      correct_answer TEXT NOT NULL,
      knowledge_point TEXT,
      ai_explanation TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('student_abnormal', 'class_abnormal')),
      target_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT,
      sent_feishu INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rag_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      doc_type TEXT DEFAULT 'general',
      metadata_json TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('arts', 'fitness', 'other')),
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, course_id, teacher_id)
    );

    CREATE TABLE IF NOT EXISTS evaluation_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL CHECK(template_type IN ('quality', 'fitness', 'custom')),
      score_scale_json TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evaluation_dimensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES evaluation_templates(id) ON DELETE CASCADE,
      dim_key TEXT NOT NULL,
      dim_name TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      rubric_hint TEXT,
      UNIQUE(template_id, dim_key)
    );

    CREATE TABLE IF NOT EXISTS evaluation_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES evaluation_templates(id) ON DELETE RESTRICT,
      evaluator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_type IN ('manual', 'scheduled', 'course_end')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'reviewed', 'final')),
      model_name TEXT,
      standard_version TEXT,
      retrieval_snapshot_json TEXT,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finalized_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS evaluation_dimension_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
      dimension_id INTEGER NOT NULL REFERENCES evaluation_dimensions(id) ON DELETE RESTRICT,
      score REAL NOT NULL,
      grade TEXT,
      confidence REAL,
      rationale TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluation_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
      dimension_id INTEGER REFERENCES evaluation_dimensions(id) ON DELETE SET NULL,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('course_note', 'work', 'performance', 'attendance', 'history_case', 'standard_clause', 'other')),
      content TEXT NOT NULL,
      source_ref TEXT,
      cited_standard_clause TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evaluation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action TEXT NOT NULL CHECK(action IN ('approve', 'edit', 'reject')),
      comment TEXT,
      revised_payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pose_analysis_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      source_json TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_template_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_identity_code TEXT NOT NULL,
      template_type TEXT NOT NULL CHECK(template_type IN ('quality', 'fitness')),
      labels_json TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_identity_code, template_type)
    );

    -- 框架模板（教案/考卷/考核标准）
    CREATE TABLE IF NOT EXISTS generation_frameworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      framework_type TEXT NOT NULL CHECK(framework_type IN ('lesson_plan', 'exam_paper', 'assessment_standard')),
      hexagon_type TEXT CHECK(hexagon_type IN ('quality', 'fitness')),
      course_id INTEGER REFERENCES courses(id),
      content_template TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- AI 生成的成品文档
    CREATE TABLE IF NOT EXISTS generated_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      framework_id INTEGER REFERENCES generation_frameworks(id),
      doc_type TEXT NOT NULL CHECK(doc_type IN ('lesson_plan', 'exam_paper', 'assessment_standard')),
      title TEXT NOT NULL,
      topic TEXT,
      content TEXT NOT NULL,
      scoring_rubric TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'archived')),
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 上传评估任务
    CREATE TABLE IF NOT EXISTS assessment_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id),
      hexagon_type TEXT NOT NULL CHECK(hexagon_type IN ('quality', 'fitness')),
      upload_type TEXT NOT NULL CHECK(upload_type IN ('exam_paper', 'video', 'image')),
      file_path TEXT,
      file_base64 TEXT,
      generated_doc_id INTEGER REFERENCES generated_documents(id),
      total_score REAL,
      ai_suggestion TEXT,
      personalized_suggestion TEXT,
      feishu_sent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      error_message TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 评估六边形维度评分
    CREATE TABLE IF NOT EXISTS assessment_hex_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER NOT NULL REFERENCES assessment_uploads(id) ON DELETE CASCADE,
      dim_key TEXT NOT NULL,
      dim_name TEXT NOT NULL,
      score REAL NOT NULL,
      rationale TEXT,
      UNIQUE(upload_id, dim_key)
    );
  `);

  // 插入默认账号
  const existingBoss = db.prepare('SELECT id FROM users WHERE username = ?').get('boss');
  if (!existingBoss) {
    const bossHash = bcrypt.hashSync('boss123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, 'boss', '管理员', '13800000000')`).run('boss', bossHash);

    const teacherHash = bcrypt.hashSync('teacher123', 10);
    const t1 = db.prepare(`INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, 'teacher', '张老师', '13811111111')`).run('teacher1', teacherHash);
    db.prepare(`INSERT INTO teachers (user_id, subject, class_name) VALUES (?, '数学', '高一1班')`).run(t1.lastInsertRowid);

    const t2 = db.prepare(`INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, 'teacher', '李老师', '13822222222')`).run('teacher2', teacherHash);
    db.prepare(`INSERT INTO teachers (user_id, subject, class_name) VALUES (?, '语文', '高一2班')`).run(t2.lastInsertRowid);

    console.log('✅ 默认账号已创建 (boss/boss123, teacher1&2/teacher123)');
  } else {
    // Schema Migration: Add feishu_webhook to teachers if it doesn't exist
    try {
      db.exec('ALTER TABLE teachers ADD COLUMN feishu_webhook TEXT;');
      console.log('🔧 数据库结构更新: 已在 teachers 表中添加 feishu_webhook 字段');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) {
        console.error('Migration error (teachers.feishu_webhook):', e);
      }
    }
    
    // Schema Migration: Remove feishu_webhook from users via rebuilding table (SQLite does not support dropping columns until very recently, so we just ignore the old column if it's still there instead of dropping it to avoid complexity, since our queries specify exactly what they want)
  }

  // Schema Migration: enrich rag_documents
  try {
    db.exec("ALTER TABLE rag_documents ADD COLUMN doc_type TEXT DEFAULT 'general';");
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Migration error (rag_documents.doc_type):', e);
    }
  }
  try {
    db.exec('ALTER TABLE rag_documents ADD COLUMN metadata_json TEXT;');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Migration error (rag_documents.metadata_json):', e);
    }
  }

  // Schema Migration: add global_student_id for cross-teacher identity
  try {
    db.exec('ALTER TABLE students ADD COLUMN global_student_id TEXT;');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Migration error (students.global_student_id):', e);
    }
  }

  try {
    db.exec('ALTER TABLE evaluation_sessions ADD COLUMN retrieval_snapshot_json TEXT;');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Migration error (evaluation_sessions.retrieval_snapshot_json):', e);
    }
  }

  // 默认评定模板与维度
  const existingQualityTpl = db.prepare("SELECT id FROM evaluation_templates WHERE name = '默认素质评定模板'").get();
  if (!existingQualityTpl) {
    const scale = JSON.stringify({ min: 1, max: 5, grades: { A: [4.5, 5], B: [3.5, 4.49], C: [2.5, 3.49], D: [1, 2.49] } });
    const qualityTpl = db.prepare(`
      INSERT INTO evaluation_templates (name, template_type, score_scale_json, active, version)
      VALUES ('默认素质评定模板', 'quality', ?, 1, 1)
    `).run(scale).lastInsertRowid;
    const qualityDims = [
      ['focus', '专注力'],
      ['expression', '表达力'],
      ['aesthetic', '审美力'],
      ['creativity', '创造力'],
      ['collaboration', '协作力'],
      ['self_learning', '自主学习力'],
    ];
    for (let i = 0; i < qualityDims.length; i++) {
      db.prepare(`
        INSERT INTO evaluation_dimensions (template_id, dim_key, dim_name, weight, sort_order, rubric_hint)
        VALUES (?, ?, ?, 1, ?, '')
      `).run(qualityTpl, qualityDims[i][0], qualityDims[i][1], i + 1);
    }
  }

  const existingFitnessTpl = db.prepare("SELECT id FROM evaluation_templates WHERE name = '默认体能评定模板'").get();
  if (!existingFitnessTpl) {
    const scale = JSON.stringify({ min: 1, max: 5, grades: { A: [4.5, 5], B: [3.5, 4.49], C: [2.5, 3.49], D: [1, 2.49] } });
    const fitnessTpl = db.prepare(`
      INSERT INTO evaluation_templates (name, template_type, score_scale_json, active, version)
      VALUES ('默认体能评定模板', 'fitness', ?, 1, 1)
    `).run(scale).lastInsertRowid;
    const fitnessDims = [
      ['flexibility', '柔韧性'],
      ['coordination', '协调性'],
      ['core_strength', '核心力量'],
      ['endurance', '耐力'],
      ['explosive_power', '爆发力'],
      ['movement_quality', '动作规范度'],
    ];
    for (let i = 0; i < fitnessDims.length; i++) {
      db.prepare(`
        INSERT INTO evaluation_dimensions (template_id, dim_key, dim_name, weight, sort_order, rubric_hint)
        VALUES (?, ?, ?, 1, ?, '')
      `).run(fitnessTpl, fitnessDims[i][0], fitnessDims[i][1], i + 1);
    }
  }

  // ── 默认课程（素质6门 + 体能6门）────────────────────────────
  const existingCourses = db.prepare("SELECT id FROM courses WHERE name = '少儿编程'").get();
  if (!existingCourses) {
    const qualityCourses = [
      ['少儿编程', 'arts', '逻辑思维、创造力培养'],
      ['美术绘画', 'arts', '审美力、创造力表达'],
      ['口才演讲', 'arts', '表达力、自信心培养'],
      ['书法国学', 'arts', '专注力、传统文化素养'],
      ['音乐素养', 'arts', '审美力、协作力培养'],
      ['思维数学', 'arts', '自主学习力、逻辑推理'],
    ];
    const fitnessCourses = [
      ['瑜伽', 'fitness', '柔韧性、核心力量'],
      ['跆拳道', 'fitness', '爆发力、协调性'],
      ['体适能', 'fitness', '综合体能训练'],
      ['舞蹈', 'fitness', '协调性、动作规范度'],
      ['游泳', 'fitness', '耐力、核心力量'],
      ['篮球', 'fitness', '爆发力、协调性'],
    ];
    for (const [name, category, desc] of [...qualityCourses, ...fitnessCourses]) {
      db.prepare(`INSERT INTO courses (name, category, description, active) VALUES (?, ?, ?, 1)`).run(name, category, desc);
    }
    console.log('✅ 默认课程已创建（素质6门 + 体能6门）');
  }

  // ── 默认框架模板（教案/考卷/考核标准）────────────────────────
  const existingFramework = db.prepare("SELECT id FROM generation_frameworks WHERE name = '通用教案框架'").get();
  if (!existingFramework) {
    const lessonPlanTpl = `一、教学目标
  1.1 知识目标：（请根据主题填写）
  1.2 能力目标：（请根据主题填写）
  1.3 情感目标：（请根据主题填写）

二、教学重难点
  2.1 教学重点：
  2.2 教学难点：

三、课程导入（5分钟）
  - 导入方式/情境创设

四、教学过程（30分钟）
  4.1 新知讲授
  4.2 示范演示
  4.3 学生练习
  4.4 互动讨论

五、课堂练习与检测（10分钟）
  - 练习题目/实操任务

六、总结反思（5分钟）
  - 本课要点回顾
  - 课后作业/延伸任务`;

    const examPaperTpl = `一、基本信息
  - 科目/课程名称：
  - 考试时长：  分钟
  - 总分：  分

二、题型分布
  2.1 选择题（__题，每题__分，共__分）
  2.2 填空题（__题，每题__分，共__分）
  2.3 判断题（__题，每题__分，共__分）
  2.4 简答题（__题，每题__分，共__分）
  2.5 综合/实操题（__题，每题__分，共__分）

三、难度分级
  - 基础题（60%）
  - 提高题（30%）
  - 拓展题（10%）

四、评分标准
  - 客观题：对即得分
  - 主观题评分要点：（AI自动生成，需人工审核确认）

五、试卷正文
  （根据以上结构生成具体题目）`;

    const assessmentStdTpl = `一、考核维度（与所属六边形一致）
  维度1：     权重：
  维度2：     权重：
  维度3：     权重：
  维度4：     权重：
  维度5：     权重：
  维度6：     权重：

二、评分等级
  A（4.5-5分）：卓越
  B（3.5-4.49分）：良好
  C（2.5-3.49分）：合格
  D（1-2.49分）：待提升

三、各维度评分细则
  维度X：
  - 5分：表现卓越，___
  - 4分：表现良好，___
  - 3分：基本合格，___
  - 2分：有待提升，___
  - 1分：明显不足，___

四、特殊说明
  - 视频考核：需录制约90秒的动作展示视频
  - 试卷考核：需按教案内容判分，出总分
  - 综合评定：六维度加权平均`;

    db.prepare(`INSERT INTO generation_frameworks (name, framework_type, hexagon_type, content_template) VALUES (?, 'lesson_plan', NULL, ?)`).run('通用教案框架', lessonPlanTpl);
    db.prepare(`INSERT INTO generation_frameworks (name, framework_type, hexagon_type, content_template) VALUES (?, 'exam_paper', NULL, ?)`).run('通用考卷框架', examPaperTpl);
    db.prepare(`INSERT INTO generation_frameworks (name, framework_type, hexagon_type, content_template) VALUES (?, 'assessment_standard', 'quality', ?)`).run('素质考核标准框架', assessmentStdTpl);
    db.prepare(`INSERT INTO generation_frameworks (name, framework_type, hexagon_type, content_template) VALUES (?, 'assessment_standard', 'fitness', ?)`).run('体能考核标准框架', assessmentStdTpl);
    console.log('✅ 默认框架模板已创建（教案/考卷/考核标准）');
  }

  console.log('✅ 数据库初始化完成:', dbPath);
}

if (process.env.NEXT_PHASE === 'phase-production-build') {
  console.log('ℹ️ 检测到 Next.js build 阶段，跳过数据库写入初始化');
} else {
  initializeDatabase();
}

module.exports = db;

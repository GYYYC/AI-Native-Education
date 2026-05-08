// RAG 服务 - 基于 DeepSeek 和本地 JSON 向量存储
const { callDeepSeek } = require('./ai-service');
const db = require('./db');
const fs = require('fs');
const path = require('path');

const VECTOR_STORE_PATH = process.env.VECTOR_STORE_PATH || './data/vector_store.json';

function loadVectorStore() {
  if (!fs.existsSync(VECTOR_STORE_PATH)) {
    const dir = path.dirname(VECTOR_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify({ documents: [] }));
  }
  return JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, 'utf-8'));
}

function saveVectorStore(store) {
  fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify(store, null, 2));
}

function getDocumentChunks(documentId) {
  const store = loadVectorStore();
  return store.documents
    .filter(d => d.documentId === documentId)
    .sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));
}

function getDocumentContent(documentId) {
  return getDocumentChunks(documentId).map(c => c.text).join('\n\n');
}

function updateDocumentMetadata(documentId, patch = {}) {
  const store = loadVectorStore();
  let changed = false;
  for (const doc of store.documents) {
    if (doc.documentId !== documentId) continue;
    const prev = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
    doc.metadata = { ...prev, ...patch };
    changed = true;
  }
  if (changed) saveVectorStore(store);
  return changed;
}

/**
 * 文本切分（简单按段落和字数切分）
 */
function splitText(text, chunkSize = 500, overlap = 50) {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > chunkSize) {
      if (current) {
        chunks.push(current.trim());
        current = current.slice(-overlap) + para;
      } else {
        // 段落本身超出，按字数切
        for (let i = 0; i < para.length; i += chunkSize - overlap) {
          chunks.push(para.slice(i, i + chunkSize).trim());
        }
        current = '';
      }
    } else {
      current += '\n\n' + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 20);
}

/**
 * 简单余弦相似度（基于词频，不需要 embedding API）
 */
function buildTF(text) {
  const words = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const tf = {};
  for (const w of words) tf[w] = (tf[w] || 0) + 1;
  return tf;
}

function cosineSimilarity(tf1, tf2) {
  const keys = new Set([...Object.keys(tf1), ...Object.keys(tf2)]);
  let dot = 0, norm1 = 0, norm2 = 0;
  for (const k of keys) {
    const a = tf1[k] || 0, b = tf2[k] || 0;
    dot += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }
  if (!norm1 || !norm2) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 添加文档到知识库
 */
async function addDocument(title, content, documentId, options = {}) {
  const store = loadVectorStore();
  const docType = options.docType || 'general';
  const metadata = options.metadata && typeof options.metadata === 'object' ? options.metadata : {};
  
  // 删除同 documentId 的旧数据
  store.documents = store.documents.filter(d => d.documentId !== documentId);

  const chunks = splitText(content);
  for (let i = 0; i < chunks.length; i++) {
    store.documents.push({
      documentId,
      title,
      docType,
      metadata,
      chunkIndex: i,
      text: chunks[i],
      tf: buildTF(chunks[i]),
    });
  }
  saveVectorStore(store);
  return chunks.length;
}

/**
 * 检索相关文档片段
 */
function retrieveRelevantChunks(query, topK = 5, options = {}) {
  const store = loadVectorStore();
  const queryTF = buildTF(query);
  const docTypes = Array.isArray(options.docTypes) ? options.docTypes : [];
  const metadataFilters = options.metadataFilters && typeof options.metadataFilters === 'object'
    ? options.metadataFilters
    : null;
  
  const filtered = store.documents.filter(doc => {
    if (docTypes.length > 0) {
      const currentType = doc.docType || 'general';
      if (!docTypes.includes(currentType)) return false;
    }
    if (metadataFilters) {
      const meta = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
      for (const [k, v] of Object.entries(metadataFilters)) {
        if (v === undefined || v === null || v === '') continue;
        if (String(meta[k] ?? '') !== String(v)) return false;
      }
    }
    return true;
  });

  const scored = filtered.map(doc => ({
    ...doc,
    score: cosineSimilarity(queryTF, doc.tf),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(d => d.score > 0.01);
}

/**
 * RAG 问答
 */
async function ragQuery(question) {
  const chunks = retrieveRelevantChunks(question);
  
  if (chunks.length === 0) {
    return {
      answer: '知识库中暂无相关内容，请先上传相关文档。',
      sources: [],
    };
  }

  const context = chunks.map((c, i) => `[来源${i + 1}：${c.title}]\n${c.text}`).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: `你是一位教育领域的知识助手。请根据提供的参考资料回答用户问题。
如果参考资料中没有相关信息，请如实说明。
请用简洁的中文回答，并注明信息来源。`
    },
    {
      role: 'user',
      content: `【参考资料】\n${context}\n\n【问题】${question}`
    }
  ];

  const answer = await callDeepSeek(messages, { temperature: 0.3, max_tokens: 1500 });
  
  return {
    answer,
    sources: [...new Set(chunks.map(c => c.title))],
  };
}

/**
 * 删除文档
 */
function deleteDocument(documentId) {
  const store = loadVectorStore();
  store.documents = store.documents.filter(d => d.documentId !== documentId);
  saveVectorStore(store);
}

/**
 * 获取知识库文档列表
 */
function listDocuments() {
  const store = loadVectorStore();
  const docMap = {};
  for (const chunk of store.documents) {
    if (!docMap[chunk.documentId]) {
      docMap[chunk.documentId] = {
        documentId: chunk.documentId,
        title: chunk.title,
        docType: chunk.docType || 'general',
        metadata: chunk.metadata || {},
        chunkCount: 0,
        source: chunk.documentId.startsWith('auto_') ? 'auto' : 'manual',
      };
    }
    docMap[chunk.documentId].chunkCount++;
  }
  return Object.values(docMap);
}

/**
 * 自动将考试数据（错题 + AI 分析）写入 RAG 知识库
 */
async function autoIngestExamData(student, examRecord, wrongQuestions, aiAnalysis) {
  try {
    const docId = `auto_exam_${student.id}_${examRecord.exam_id}`;
    const parts = [];

    parts.push(`【考试成绩记录】`);
    parts.push(`学生：${student.name}，年级：${student.grade || ''}，班级：${student.class_name || ''}`);
    parts.push(`考试：${examRecord.exam_name}，科目：${examRecord.subject}，日期：${examRecord.exam_date}`);
    parts.push(`得分：${examRecord.score}/${examRecord.total_score}（得分率 ${((examRecord.score / examRecord.total_score) * 100).toFixed(1)}%）`);

    if (wrongQuestions.length > 0) {
      parts.push('');
      parts.push(`【错题详情】共 ${wrongQuestions.length} 道`);
      for (const wq of wrongQuestions) {
        parts.push(`题号${wq.question_number || '?'}：${wq.question_content || '（无内容）'}`);
        if (wq.knowledge_point) parts.push(`  知识点：${wq.knowledge_point}`);
        if (wq.student_answer) parts.push(`  学生答案：${wq.student_answer}`);
        if (wq.correct_answer) parts.push(`  正确答案：${wq.correct_answer}`);
      }
    }

    if (aiAnalysis) {
      parts.push('');
      parts.push(`【AI 学情分析】`);
      parts.push(aiAnalysis);
    }

    const title = `${student.name} - ${examRecord.exam_name}（${examRecord.subject}）`;
    const content = parts.join('\n');

    await addDocument(title, content, docId);
    console.log(`📚 RAG 自动积累：${title}（${docId}）`);
  } catch (err) {
    console.error('RAG 自动积累考试数据失败:', err.message);
  }
}

/**
 * 自动将异常告警写入 RAG 知识库
 */
async function autoIngestAlert(alertData) {
  try {
    const docId = `auto_alert_${alertData.id || Date.now()}`;
    const typeLabel = alertData.type === 'class_abnormal' ? '班级异常' : '学生异常';
    const parts = [
      `【${typeLabel}告警】`,
      `对象：${alertData.target_name}`,
      `告警信息：${alertData.message}`,
      `详细说明：${alertData.detail}`,
      `时间：${new Date().toLocaleString('zh-CN')}`,
    ];

    const title = `告警：${alertData.message}`;
    const content = parts.join('\n');

    await addDocument(title, content, docId);
    console.log(`📚 RAG 自动积累告警：${title}（${docId}）`);
  } catch (err) {
    console.error('RAG 自动积累告警数据失败:', err.message);
  }
}

/**
 * 自动将评测证据样本写入 RAG 案例库（不修改标准，仅用于检索参考）
 */
async function autoIngestEvaluationCase(caseData) {
  try {
    const now = Date.now();
    const docId = `auto_eval_case_${caseData.sessionId || 'na'}_${caseData.evidenceDetailType || 'metric'}_${now}`;
    const metricsText = (() => {
      try { return JSON.stringify(caseData.metrics || {}, null, 2); } catch { return ''; }
    })();
    const parts = [
      '【评测案例样本】',
      `学生ID：${caseData.studentId || ''}`,
      `会话ID：${caseData.sessionId || ''}`,
      `模板类型：${caseData.templateType || ''}`,
      `能力维度：${caseData.dimensionKey || '通用'}`,
      `证据类型：${caseData.evidenceDetailType || ''}`,
      `来源：${caseData.source || ''}`,
      `来源引用：${caseData.sourceRef || ''}`,
      `记录时间：${new Date().toISOString()}`,
      '',
      '【摘要】',
      String(caseData.note || '无'),
      '',
      '【指标(JSON)】',
      metricsText || '{}',
    ];
    const title = `评测案例 ${caseData.templateType || 'unknown'}-${caseData.evidenceDetailType || 'metric'}-${new Date().toLocaleDateString('zh-CN')}`;
    const metadata = {
      owner_scope: 'org_private',
      template_type: String(caseData.templateType || ''),
      dim_key: String(caseData.dimensionKey || ''),
      evidence_detail_type: String(caseData.evidenceDetailType || ''),
      source: String(caseData.source || ''),
      session_id: String(caseData.sessionId || ''),
      student_id: String(caseData.studentId || ''),
      generated_at: new Date().toISOString(),
    };
    await addDocument(title, parts.join('\n'), docId, {
      docType: 'evaluation_case',
      metadata,
    });
    db.prepare(`
      INSERT INTO rag_documents (title, content, doc_type, metadata_json, uploaded_by)
      VALUES (?, ?, 'evaluation_case', ?, ?)
    `).run(title, parts.join('\n'), JSON.stringify(metadata), caseData.userId || null);
  } catch (err) {
    console.error('RAG 自动积累评测案例失败:', err.message);
  }
}

function getHalfYearWindow(referenceDate = new Date()) {
  const month = referenceDate.getMonth() + 1;
  const half = month <= 6 ? 1 : 2;
  const year = referenceDate.getFullYear();
  const start = new Date(year, half === 1 ? 0 : 6, 1, 0, 0, 0, 0);
  const end = new Date(year, half === 1 ? 5 : 11, 31, 23, 59, 59, 999);
  return {
    cycleKey: `${year}-H${half}`,
    startISO: start.toISOString().slice(0, 10),
    endISO: end.toISOString().slice(0, 10),
  };
}

async function generateHalfYearStandardDrafts({ templateType, triggerByUserId, force = false }) {
  const tpl = db.prepare(`
    SELECT id, name, template_type, version
    FROM evaluation_templates
    WHERE template_type = ? AND active = 1
    ORDER BY version DESC, id DESC
    LIMIT 1
  `).get(templateType);
  if (!tpl) throw new Error(`未找到已启用模板: ${templateType}`);

  const window = getHalfYearWindow(new Date());
  const existingDraft = listDocuments().find(d =>
    d.docType === 'evaluation_standard_draft' &&
    String(d.metadata?.template_type || '') === templateType &&
    String(d.metadata?.cycle_key || '') === window.cycleKey &&
    String(d.metadata?.status || 'draft') === 'draft');
  if (existingDraft && !force) {
    throw new Error(`本周期(${window.cycleKey})已生成草稿，请直接审核或使用 force 重跑`);
  }

  const dims = db.prepare(`
    SELECT id, dim_key, dim_name
    FROM evaluation_dimensions
    WHERE template_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(tpl.id);
  if (!dims.length) throw new Error('模板维度为空，无法生成草稿');

  const generated = [];
  for (const dim of dims) {
    const rows = db.prepare(`
      SELECT es.id as session_id, es.summary, eds.score, eds.rationale,
             ee.content as evidence_content, ee.source_ref, ee.cited_standard_clause
      FROM evaluation_sessions es
      JOIN evaluation_dimension_scores eds ON eds.session_id = es.id
      JOIN evaluation_dimensions d ON d.id = eds.dimension_id
      LEFT JOIN evaluation_evidence ee ON ee.session_id = es.id AND ee.dimension_id = d.id
      WHERE es.template_id = ?
        AND es.status = 'final'
        AND d.id = ?
        AND date(es.finalized_at) >= date(?)
        AND date(es.finalized_at) <= date(?)
      ORDER BY es.finalized_at DESC
      LIMIT 120
    `).all(tpl.id, dim.id, window.startISO, window.endISO);

    const sampleCount = rows.length;
    const avgScore = sampleCount
      ? rows.reduce((sum, r) => sum + Number(r.score || 0), 0) / sampleCount
      : 0;
    const rationaleSamples = rows.map(r => r.rationale).filter(Boolean).slice(0, 20).join('\n- ');
    const evidenceSamples = rows.map(r => r.evidence_content).filter(Boolean).slice(0, 20).join('\n- ');

    const baseStandard = retrieveRelevantChunks(
      `${tpl.name} ${dim.dim_name} 评定标准`,
      5,
      {
        docTypes: ['evaluation_standard'],
        metadataFilters: {
          template_type: tpl.template_type,
          dim_key: dim.dim_key,
          owner_scope: 'org_private',
          version: String(tpl.version),
        },
      },
    );
    const baseContext = baseStandard.map((c, i) => `${i + 1}. ${c.text}`).join('\n');

    const messages = [
      {
        role: 'system',
        content: '你是机构标准优化助手。请基于提供的六个月样本，仅产出“标准草稿文本”，不要输出JSON或多余说明。',
      },
      {
        role: 'user',
        content: `模板：${tpl.name}(${tpl.template_type})\n维度：${dim.dim_name}(${dim.dim_key})\n周期：${window.startISO}~${window.endISO}\n样本数：${sampleCount}\n平均分：${avgScore.toFixed(2)}\n\n现行标准：\n${baseContext || '暂无'}\n\n评分理由样本：\n- ${rationaleSamples || '暂无'}\n\n证据样本：\n- ${evidenceSamples || '暂无'}\n\n请输出：\n1) 建议保留条款\n2) 建议新增条款\n3) 建议修改阈值\n4) 风险提示与反例\n每项用中文短句，便于boss审核。`,
      },
    ];
    const draftText = await callDeepSeek(messages, { temperature: 0.2, max_tokens: 1600 });

    const draftDocId = `draft_std_${tpl.template_type}_${dim.dim_key}_${window.cycleKey}_${Date.now()}`;
    const metadata = {
      template_type: tpl.template_type,
      dim_key: dim.dim_key,
      base_version: String(tpl.version),
      owner_scope: 'org_private',
      source_window_start: window.startISO,
      source_window_end: window.endISO,
      cycle_key: window.cycleKey,
      status: 'draft',
      sample_count: sampleCount,
      generated_by: String(triggerByUserId),
      generated_at: new Date().toISOString(),
    };
    const title = `标准草稿[${window.cycleKey}] ${tpl.template_type}-${dim.dim_name}`;
    await addDocument(title, String(draftText || '').trim(), draftDocId, {
      docType: 'evaluation_standard_draft',
      metadata,
    });
    db.prepare(`
      INSERT INTO rag_documents (title, content, doc_type, metadata_json, uploaded_by)
      VALUES (?, ?, 'evaluation_standard_draft', ?, ?)
    `).run(title, String(draftText || '').trim(), JSON.stringify(metadata), triggerByUserId);

    generated.push({ documentId: draftDocId, dim_key: dim.dim_key, dim_name: dim.dim_name, sampleCount });
  }
  return { ...window, templateType: tpl.template_type, templateVersion: tpl.version, generated };
}

function listStandardDrafts({ templateType, status } = {}) {
  return listDocuments().filter(d => {
    if (d.docType !== 'evaluation_standard_draft') return false;
    if (templateType && String(d.metadata?.template_type || '') !== String(templateType)) return false;
    if (status && String(d.metadata?.status || 'draft') !== String(status)) return false;
    return true;
  });
}

function publishStandardDraft({ documentId, userId }) {
  const docs = listStandardDrafts();
  const draft = docs.find(d => d.documentId === documentId);
  if (!draft) throw new Error('草稿不存在');
  if (String(draft.metadata?.status || 'draft') !== 'draft') throw new Error('仅草稿状态可发布');

  const templateType = String(draft.metadata?.template_type || '');
  const dimKey = String(draft.metadata?.dim_key || '');
  const tpl = db.prepare(`
    SELECT id, version
    FROM evaluation_templates
    WHERE template_type = ? AND active = 1
    ORDER BY version DESC, id DESC
    LIMIT 1
  `).get(templateType);
  if (!tpl) throw new Error('未找到对应模板');

  const baseVersion = Number(draft.metadata?.base_version || tpl.version || 1);
  const newVersion = Math.max(Number(tpl.version || 1), baseVersion + 1);
  const content = getDocumentContent(documentId);
  const publishedDocId = `std_${templateType}_${dimKey}_v${newVersion}_${Date.now()}`;
  const publishedMeta = {
    template_type: templateType,
    dim_key: dimKey,
    version: String(newVersion),
    owner_scope: 'org_private',
    source_draft_document_id: documentId,
    status: 'published',
    published_at: new Date().toISOString(),
    published_by: String(userId),
  };
  addDocument(`机构标准 ${templateType}-${dimKey} v${newVersion}`, content, publishedDocId, {
    docType: 'evaluation_standard',
    metadata: publishedMeta,
  });
  db.prepare(`
    INSERT INTO rag_documents (title, content, doc_type, metadata_json, uploaded_by)
    VALUES (?, ?, 'evaluation_standard', ?, ?)
  `).run(`机构标准 ${templateType}-${dimKey} v${newVersion}`, content, JSON.stringify(publishedMeta), userId);

  updateDocumentMetadata(documentId, {
    status: 'published',
    published_version: String(newVersion),
    published_at: publishedMeta.published_at,
    published_by: String(userId),
  });
  if (Number(tpl.version || 1) < newVersion) {
    db.prepare('UPDATE evaluation_templates SET version = ? WHERE id = ?').run(newVersion, tpl.id);
  }
  return { publishedDocumentId: publishedDocId, newVersion, templateType, dimKey };
}

function rejectStandardDraft({ documentId, userId, reason = '' }) {
  const docs = listStandardDrafts();
  const draft = docs.find(d => d.documentId === documentId);
  if (!draft) throw new Error('草稿不存在');
  updateDocumentMetadata(documentId, {
    status: 'rejected',
    rejected_at: new Date().toISOString(),
    rejected_by: String(userId),
    reject_reason: String(reason || ''),
  });
  return { success: true };
}

function listPublishedStandards({ templateType } = {}) {
  return listDocuments().filter(d => {
    if (d.docType !== 'evaluation_standard') return false;
    if (templateType && String(d.metadata?.template_type || '') !== String(templateType)) return false;
    return true;
  });
}

function rollbackStandardVersion({ templateType, targetVersion, userId }) {
  const targets = listPublishedStandards({ templateType }).filter(d =>
    String(d.metadata?.version || '') === String(targetVersion));
  if (!targets.length) throw new Error('目标版本不存在');
  const tpl = db.prepare(`
    SELECT id, version
    FROM evaluation_templates
    WHERE template_type = ? AND active = 1
    ORDER BY version DESC, id DESC
    LIMIT 1
  `).get(templateType);
  if (!tpl) throw new Error('未找到模板');
  const newVersion = Number(tpl.version || 1) + 1;
  let created = 0;
  for (const target of targets) {
    const content = getDocumentContent(target.documentId);
    const dimKey = String(target.metadata?.dim_key || '');
    const publishedDocId = `std_${templateType}_${dimKey}_rollback_v${targetVersion}_v${newVersion}_${Date.now()}_${created + 1}`;
    const publishedMeta = {
      template_type: templateType,
      dim_key: dimKey,
      version: String(newVersion),
      owner_scope: 'org_private',
      rollback_from: String(targetVersion),
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: String(userId),
    };
    addDocument(`机构标准 ${templateType}-${dimKey} 回滚到v${targetVersion}（新v${newVersion}）`, content, publishedDocId, {
      docType: 'evaluation_standard',
      metadata: publishedMeta,
    });
    db.prepare(`
      INSERT INTO rag_documents (title, content, doc_type, metadata_json, uploaded_by)
      VALUES (?, ?, 'evaluation_standard', ?, ?)
    `).run(`机构标准 ${templateType}-${dimKey} 回滚到v${targetVersion}（新v${newVersion}）`, content, JSON.stringify(publishedMeta), userId);
    created++;
  }
  db.prepare('UPDATE evaluation_templates SET version = ? WHERE id = ?').run(newVersion, tpl.id);
  return { newVersion, createdCount: created };
}

module.exports = {
  addDocument,
  ragQuery,
  deleteDocument,
  listDocuments,
  retrieveRelevantChunks,
  autoIngestExamData,
  autoIngestAlert,
  autoIngestEvaluationCase,
  generateHalfYearStandardDrafts,
  listStandardDrafts,
  publishStandardDraft,
  rejectStandardDraft,
  listPublishedStandards,
  rollbackStandardVersion,
  getDocumentContent,
};

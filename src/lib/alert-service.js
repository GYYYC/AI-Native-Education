// 异常检测和告警服务
const db = require('./db');
const { sendStudentAlert, sendClassAlert, sendRepeatedWrongAlert } = require('./feishu-service');
const { autoIngestAlert } = require('./rag-service');

/**
 * 检测学生成绩是否异常
 * 规则：当前成绩与历史均值相差超过 20分 或 历史成绩标准差的 2 倍
 */
async function detectStudentAnomaly(studentId, examRecordId) {
  try {
    // 获取当前考试记录
    const currentRecord = db.prepare(`
      SELECT er.*, e.name as exam_name, e.subject, e.total_score, e.exam_date,
             s.name as student_name, s.class_name,
             u.name as teacher_name, t.subject as teacher_subject,
             t.feishu_webhook as teacher_webhook
      FROM exam_records er
      JOIN exams e ON er.exam_id = e.id
      JOIN students s ON er.student_id = s.id
      JOIN teachers t ON s.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE er.id = ?
    `).get(examRecordId);

    if (!currentRecord) return null;

    // 获取历史成绩（排除当前）
    const history = db.prepare(`
      SELECT er.score, e.total_score
      FROM exam_records er
      JOIN exams e ON er.exam_id = e.id
      WHERE er.student_id = ? AND er.id != ? AND e.subject = ?
      ORDER BY e.exam_date ASC
    `).all(studentId, examRecordId, currentRecord.subject);

    if (history.length < 2) return null; // 历史数据不足

    // 计算百分制得分率
    const toPercent = (r) => (r.score / r.total_score) * 100;
    const currentPct = toPercent(currentRecord);
    const histScores = history.map(toPercent);
    const avg = histScores.reduce((a, b) => a + b, 0) / histScores.length;
    const stdDev = Math.sqrt(histScores.map(s => (s - avg) ** 2).reduce((a, b) => a + b, 0) / histScores.length);
    
    const change = currentPct - avg;
    const threshold = Math.max(stdDev * 1.5, 15); // 至少15分差异才告警

    const isAnomaly = Math.abs(change) >= threshold;

    if (isAnomaly) {
      // 检查最近 12 小时内是否已经为该学生发过异常告警，防止刷屏
      const recentAlert = db.prepare(`
        SELECT id FROM alerts 
        WHERE type = 'student_abnormal' 
          AND target_id = ? 
          AND created_at > datetime('now', '-12 hours')
      `).get(currentRecord.student_id);

      if (recentAlert) {
        console.log(`[Alert] 学生 ${currentRecord.student_name} 的成绩异常预警近期已发送，跳过。`);
        return { anomaly: false, detail: '跳过重复告警' };
      }

      const detail = change < 0
        ? `该学生本次得分率 ${currentPct.toFixed(1)}%，低于历史均值 ${avg.toFixed(1)}% 约 ${Math.abs(change).toFixed(1)} 个百分点，下降幅度较大，请关注。`
        : `该学生本次得分率 ${currentPct.toFixed(1)}%，高于历史均值 ${avg.toFixed(1)}% 约 ${change.toFixed(1)} 个百分点，成绩提升明显。`;

      // 保存告警记录
      const alertMessage = `学生 ${currentRecord.student_name} 在 "${currentRecord.exam_name}" 中成绩${change < 0 ? '异常下降' : '显著提升'}`;
      const alertDetail = `较平均分下降 ${Math.abs(change).toFixed(1)}%。这是该生首次出现大幅波动，请关注其近期学习状态。`;

      // 4.1 写入预警记录 (DB)
      const insertAlert = db.prepare(`
        INSERT INTO alerts (type, target_id, target_name, message, detail, is_read, sent_feishu)
        VALUES ('student_abnormal', ?, ?, ?, ?, 0, 0)
      `);
      const alertId = insertAlert.run(
        studentId,
        currentRecord.student_name,
        alertMessage,
        alertDetail
      ).lastInsertRowid;

      // 自动写入 RAG 知识库
      await autoIngestAlert({
        id: alertId,
        type: 'student_abnormal',
        target_name: currentRecord.student_name,
        message: alertMessage,
        detail,
      });

      // 4.2 发送飞书通知 (包含老师专属 Webhook 和 老板全局 Webhook)
      const feishuSuccess = await sendStudentAlert({
        webhookUrls: [currentRecord.teacher_webhook],
        studentName: currentRecord.student_name,
        teacherName: currentRecord.teacher_name,
        className: currentRecord.class_name,
        subject: currentRecord.subject,
        examName: currentRecord.exam_name,
        currentScore: currentRecord.score,
        avgScore: (avg / 100) * currentRecord.total_score,
        changePercent: change,
        detail: alertDetail,
      });

      // 更新发送状态
      if (feishuSuccess) {
        db.prepare("UPDATE alerts SET sent_feishu = 1 WHERE id = ?")
          .run(alertId);
      }

      return { anomaly: true, change, detail };
    }

    return { anomaly: false };
  } catch (err) {
    console.error('异常检测失败:', err);
    return null;
  }
}

/**
 * 检测班级整体成绩是否异常
 * 规则：班级最近3次平均分持续下降
 */
async function detectClassAnomaly(teacherId) {
  try {
    const teacher = db.prepare(`
      SELECT t.*, u.name, t.feishu_webhook
      FROM teachers t JOIN users u ON t.user_id = u.id
      WHERE t.id = ?
    `).get(teacherId);

    if (!teacher) return null;

    // 获取最近5次考试的班级不及格人数（分数 < 满分的 60%）
    const classStats = db.prepare(`
      SELECT e.id, e.name as exam_name, e.exam_date, e.subject,
             SUM(CASE WHEN er.score < e.total_score * 0.6 THEN 1 ELSE 0 END) as fail_count,
             COUNT(er.id) as total_students
      FROM exams e
      JOIN exam_records er ON e.id = er.exam_id
      JOIN students s ON er.student_id = s.id
      WHERE s.teacher_id = ?
      GROUP BY e.id
      ORDER BY e.exam_date DESC
      LIMIT 5
    `).all(teacherId);

    if (classStats.length < 3) return null;

    // 检查是否不及格人数连续上升（取最近3次，按时间正序）
    const recent = classStats.slice(0, 3).reverse();
    const isDeclining = recent[1].fail_count > recent[0].fail_count && recent[2].fail_count > recent[1].fail_count;

    if (isDeclining) {
      const latestExamId = recent[2].id;
      // 检查最近 12 小时内是否已经为该班级的这场考试发过告警，防止刷屏
      const recentAlert = db.prepare(`
        SELECT id FROM alerts 
        WHERE type = 'class_abnormal' 
          AND target_id = ? 
          AND created_at > datetime('now', '-12 hours')
      `).get(teacherId);

      if (recentAlert) {
        console.log(`[Alert] 班级 ${teacher.class_name} 的滑坡预警近期已发送，跳过。`);
        return { anomaly: false, detail: '跳过重复告警' };
      }

      const detail = `班级最近三次考试不及格人数持续上升：${recent.map(s => `${s.exam_name}(${s.fail_count}人不及格)`).join(' → ')}，请关注班级整体学习状态。`;

      const scoresText = recent.map(s => `${s.exam_name}(${s.fail_count}人不及格)`).join(' → ');
      const alertDetail = `连续两次考试不及格人数达到或超过 30%。\n数据：${scoresText}`;

      // 写入预警记录
      const insertAlert = db.prepare(`
        INSERT INTO alerts (type, target_id, target_name, message, detail, is_read, sent_feishu)
        VALUES ('class_abnormal', ?, ?, ?, ?, 0, 0)
      `);
      const alertId = insertAlert.run(
        teacherId,
        teacher.class_name,
        `班级整体成绩预警：${teacher.class_name} ${teacher.subject}`,
        alertDetail
      ).lastInsertRowid;

      // 自动写入 RAG 知识库
      await autoIngestAlert({
        id: alertId,
        type: 'class_abnormal',
        target_name: teacher.class_name,
        message: `班级 ${teacher.class_name} 成绩持续下降预警`,
        detail: alertDetail,
      });

      // 发送飞书通知 (仅发给老板，也可以发给老师，这里选择同时发)
      const feishuSuccess = await sendClassAlert({
        webhookUrls: [teacher.feishu_webhook],
        teacherName: teacher.name,
        className: teacher.class_name,
        subject: teacher.subject,
        failStats: recent.map(s => ({ exam_name: s.exam_name, fail_count: s.fail_count })),
        detail,
      });

      if (feishuSuccess) {
        db.prepare("UPDATE alerts SET sent_feishu = 1 WHERE id = ?")
          .run(alertId);
      }

      return { anomaly: true, detail };
    }

    return { anomaly: false };
  } catch (err) {
    console.error('班级异常检测失败:', err);
    return null;
  }
}
/**
 * 检测学生错题是否有重复出错的知识点
 * 规则：同一知识点在不同考试中出错 >= 2 次
 */
async function detectRepeatedWrongQuestions(studentId, examRecordId) {
  try {
    // 获取当前考试记录的错题知识点
    const currentWQ = db.prepare(`
      SELECT wq.knowledge_point
      FROM wrong_questions wq
      WHERE wq.exam_record_id = ? AND wq.knowledge_point IS NOT NULL AND wq.knowledge_point != ''
    `).all(examRecordId);

    if (currentWQ.length === 0) return null;

    const currentPoints = currentWQ.map(w => w.knowledge_point);

    // 获取学生信息
    const student = db.prepare(`
      SELECT s.*, u.name as teacher_name, t.subject as teacher_subject, s.class_name,
             t.feishu_webhook as teacher_webhook
      FROM students s
      JOIN teachers t ON s.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE s.id = ?
    `).get(studentId);

    if (!student) return null;

    // 统计该学生所有历史错题的知识点出现次数（包括本次）
    const allWQ = db.prepare(`
      SELECT wq.knowledge_point, COUNT(*) as count, GROUP_CONCAT(DISTINCT e.name) as exam_names
      FROM wrong_questions wq
      JOIN exam_records er ON wq.exam_record_id = er.id
      JOIN exams e ON er.exam_id = e.id
      WHERE er.student_id = ? AND wq.knowledge_point IS NOT NULL AND wq.knowledge_point != ''
      GROUP BY wq.knowledge_point
      HAVING count >= 2
    `).all(studentId);

    // 只关注本次出现的且历史也出现过的知识点
    const repeatedPoints = allWQ.filter(w => currentPoints.includes(w.knowledge_point));

    if (repeatedPoints.length === 0) return { repeated: false };

    // 检查最近 12 小时内是否已经为该学生发过重复错题告警，防止刷屏
    const recentAlert = db.prepare(`
      SELECT id FROM alerts 
      WHERE type = 'student_abnormal' 
        AND target_id = ? 
        AND created_at > datetime('now', '-12 hours')
    `).get(studentId);

    if (recentAlert) {
      console.log(`[Alert] 学生 ${student.name} 的错题重复预警近期已发送，跳过。`);
      return { repeated: true, detail: '跳过重复告警' };
    }

    const pointsList = repeatedPoints.map(p => `${p.knowledge_point}（${p.count}次，涉及：${p.exam_names}）`).join('；');
    const alertMessage = `学生 ${student.name} 存在 ${repeatedPoints.length} 个知识点重复出错`;
    const detail = `以下知识点在多次考试中重复出错：${pointsList}。建议针对这些知识点进行专项辅导。`;

    // 保存告警
    const alertResult = db.prepare(`
      INSERT INTO alerts (type, target_id, target_name, message, detail, sent_feishu)
      VALUES ('student_abnormal', ?, ?, ?, ?, 0)
    `).run(studentId, student.name, alertMessage, detail);

    // 写入 RAG
    await autoIngestAlert({
      id: alertResult.lastInsertRowid,
      type: 'repeated_wrong',
      target_name: student.name,
      message: alertMessage,
      detail,
    });

    // 发送飞书通知 (包含老师专属 Webhook 和 老板全局 Webhook)
    const sent = await sendRepeatedWrongAlert({
      webhookUrls: [student.teacher_webhook],
      studentName: student.name,
      teacherName: student.teacher_name,
      className: student.class_name || '',
      subject: student.teacher_subject || '',
      repeatedPoints: repeatedPoints.map(p => ({ point: p.knowledge_point, count: p.count })),
      detail: `建议对以上知识点进行专项辅导和练习。`,
    });

    if (sent) {
      db.prepare("UPDATE alerts SET sent_feishu = 1 WHERE id = ?")
        .run(alertResult.lastInsertRowid);
    }

    return { repeated: true, points: repeatedPoints };
  } catch (err) {
    console.error('错题重复检测失败:', err);
    return null;
  }
}

module.exports = { detectStudentAnomaly, detectClassAnomaly, detectRepeatedWrongQuestions };

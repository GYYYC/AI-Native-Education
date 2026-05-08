import { NextResponse } from 'next/server';
const db = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const XLSX = require('xlsx');

/**
 * POST /api/import
 * body: FormData with:
 *   - type: 'students' | 'scores'
 *   - file: Excel/CSV file
 *   - examId: (only for scores import)
 */
export async function POST(request) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const formData = await request.formData();
    const type = formData.get('type');
    const file = formData.get('file');
    const examId = formData.get('examId');

    if (!file) return NextResponse.json({ error: '请选择文件' }, { status: 400 });

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    let rows = [];

    if (fileName.endsWith('.csv')) {
      // CSV parsing - manual split
      const text = buffer.toString('utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return NextResponse.json({ error: 'CSV 文件为空或格式错误' }, { status: 400 });
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      });
    } else {
      // Excel parsing via xlsx
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }

    if (rows.length === 0) return NextResponse.json({ error: '文件内容为空' }, { status: 400 });

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    if (type === 'students') {
      // === 批量导入学生 ===
      const teacherId = formData.get('teacherId');
      if (!teacherId) return NextResponse.json({ error: '请选择导入目标班级' }, { status: 400 });

      // 获取班级信息用于验证和预填充
      const targetClass = db.prepare('SELECT subject, class_name FROM teachers WHERE id = ? AND user_id = ?')
        .get(teacherId, user.id);
      
      if (!targetClass) return NextResponse.json({ error: '无权导入该班级' }, { status: 403 });

      // 期望列: 姓名, 家长姓名, 家长电话, 备注
      const insertStudent = db.prepare(`
        INSERT OR IGNORE INTO students (student_code, teacher_id, name, grade, class_name, parent_name, parent_phone, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = row['姓名'] || row['name'] || row['Name'] || '';
        if (!name) { errors.push(`第 ${i + 2} 行：姓名为空，跳过`); errorCount++; continue; }

        const year = new Date().getFullYear().toString().slice(-2);
        const studentCode = `STU${year}${Math.floor(100000 + Math.random() * 900000)}`;

        try {
          insertStudent.run(
            studentCode,
            teacherId,
            name.trim(),
            '', // 年级在班级里可以通过 class_name 涵盖，此处留空或后续改进
            targetClass.class_name,
            (row['家长姓名'] || row['parent_name'] || '').trim(),
            (row['家长电话'] || row['parent_phone'] || '').trim(),
            (row['备注'] || row['notes'] || '').trim()
          );
          successCount++;
        } catch (err) {
          errors.push(`第 ${i + 2} 行：${err.message}`);
          errorCount++;
        }
      }

    } else if (type === 'scores') {
      // === 批量导入成绩 ===
      // 期望列: 学生姓名 或 学生ID, 分数
      if (!examId) return NextResponse.json({ error: '请选择考试' }, { status: 400 });
      const parsedExamId = parseInt(examId, 10);
      if (Number.isNaN(parsedExamId)) return NextResponse.json({ error: '考试ID无效' }, { status: 400 });

      // 校验考试归属，防止导入到非本人班级考试
      const exam = db.prepare(`
        SELECT e.id
        FROM exams e
        JOIN teachers t ON e.teacher_id = t.id
        WHERE e.id = ? AND t.user_id = ?
      `).get(parsedExamId, user.id);
      if (!exam) return NextResponse.json({ error: '考试不存在或无权导入该考试成绩' }, { status: 403 });

      // 获取本教师所有学生（用于名字匹配）
      const students = db.prepare(`
        SELECT s.id, s.name, s.student_code, s.global_student_id
        FROM students s
        JOIN teachers t ON s.teacher_id = t.id
        WHERE t.user_id = ?
      `).all(user.id);
      const studentByName = {};
      const studentByCode = {};
      students.forEach(s => {
        studentByName[s.name] = s.id;
        studentByCode[s.student_code] = s.id;
        if (s.global_student_id) studentByCode[s.global_student_id] = s.id;
      });

      const upsertScore = db.prepare(`
        INSERT INTO exam_records (student_id, exam_id, score)
        VALUES (?, ?, ?)
        ON CONFLICT(student_id, exam_id) DO UPDATE SET score = excluded.score
      `);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const nameOrCode = (row['学生姓名'] || row['姓名'] || row['name'] || row['学生ID'] || row['student_code'] || '').trim();
        const score = parseFloat(row['分数'] || row['得分'] || row['score'] || '');

        if (!nameOrCode) { errors.push(`第 ${i + 2} 行：学生信息为空，跳过`); errorCount++; continue; }
        if (isNaN(score)) { errors.push(`第 ${i + 2} 行：${nameOrCode} 分数格式错误`); errorCount++; continue; }

        const studentId = studentByName[nameOrCode] || studentByCode[nameOrCode];
        if (!studentId) { errors.push(`第 ${i + 2} 行：找不到学生"${nameOrCode}"`); errorCount++; continue; }

        try {
          upsertScore.run(studentId, parsedExamId, score);
          successCount++;
        } catch (err) {
          errors.push(`第 ${i + 2} 行：${err.message}`);
          errorCount++;
        }
      }
    } else {
      return NextResponse.json({ error: '不支持的导入类型' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      successCount,
      errorCount,
      errors: errors.slice(0, 20),
      message: `成功导入 ${successCount} 条，失败 ${errorCount} 条`,
    });

  } catch (err) {
    console.error('导入错误:', err);
    return NextResponse.json({ error: '文件解析失败: ' + err.message }, { status: 500 });
  }
}

// GET /api/import?type=students|scores - 下载模板
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  const XLSX = require('xlsx');
  let data, filename;

  if (type === 'students') {
    data = [
      { '姓名': '张三', '家长姓名': '张父', '家长电话': '13800000001', '备注': '' },
      { '姓名': '李四', '家长姓名': '李父', '家长电话': '13800000002', '备注': '' },
    ];
    filename = '学生导入模板.xlsx';
  } else {
    data = [
      { '学生姓名': '张三', '分数': 85 },
      { '学生姓名': '李四', '分数': 92 },
    ];
    filename = '成绩导入模板.xlsx';
  }

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

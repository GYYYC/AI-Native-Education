const fs = require('fs');
const envStr = fs.readFileSync('.env.local', 'utf8');
envStr.split('\n').forEach(line => {
  const parts = line.split('=');
  if(parts.length >= 2) process.env[parts[0].trim()] = parts.slice(1).join('=').trim();
});
const jwt = require('jsonwebtoken');
const db = require('../src/lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'education_system_jwt_secret_2024';

async function run() {
  try {
    const teacher = db.prepare('SELECT id, user_id FROM teachers LIMIT 1').get();
    if (!teacher) {
      console.log('No teacher found in database. Please register a teacher first.');
      return;
    }

    const token = jwt.sign(
      { id: teacher.user_id, role: 'teacher', teacherId: teacher.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const fetchApi = async (path, method, body) => {
      const res = await fetch(`http://localhost:3000${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };

    const delay = ms => new Promise(r => setTimeout(r, ms));

    console.log("=> creating simulated students...");
    await fetchApi('/api/students', 'POST', { name: '李雷(自动测)', grade: '高一', class_name: '高一1班' });
    await fetchApi('/api/students', 'POST', { name: '韩梅梅(自动测)', grade: '高一', class_name: '高一1班' });

    const students = await fetchApi('/api/students', 'GET');
    // find the last inserted ones
    const list = students.students;
    const s1 = list.find(s => s.name === '李雷(自动测)');
    const s2 = list.find(s => s.name === '韩梅梅(自动测)');
    console.log(`=> Students created: ID ${s1?.id}, ID ${s2?.id}`);

    console.log("=> creating simulated exams...");
    const e1 = await fetchApi('/api/exams', 'POST', { name: '三月摸底测(模拟)', subject: '数学', exam_date: '2026-03-10', total_score: 100 });
    const e2 = await fetchApi('/api/exams', 'POST', { name: '期中大考(模拟)', subject: '数学', exam_date: '2026-03-12', total_score: 100 });
    const e3 = await fetchApi('/api/exams', 'POST', { name: '专项摸底测(模拟)', subject: '数学', exam_date: '2026-03-14', total_score: 100 });
    console.log(`=> Exams created: ID ${e1?.exam?.id}, ID ${e2?.exam?.id}, ID ${e3?.exam?.id}`);

    console.log("\n=> STEP 1: Posting Exam 1 scores (Baseline 95 & 80 - 0 Failures) ...");
    await fetchApi('/api/exam-records', 'POST', { studentId: s1.id, examId: e1.exam.id, score: 95 });
    await fetchApi('/api/exam-records', 'POST', { studentId: s2.id, examId: e1.exam.id, score: 80 });
    console.log("=> Waiting 5 seconds for backend AI processing...");
    await delay(5000);

    console.log("\n=> STEP 2: Posting Exam 2 scores (A drop to 55 & 80 -> trigger Student Alert & 1 Failure) ...");
    await fetchApi('/api/exam-records', 'POST', {
      studentId: s1.id, examId: e2.exam.id, score: 55,
      wrongQuestions: [{ question_number: '1', knowledge_point: '导数与微分', question_content: '求函数f(x)=x^2在x=1处的导数', student_answer: 'x', correct_answer: '2x' }]
    });
    await fetchApi('/api/exam-records', 'POST', { studentId: s2.id, examId: e2.exam.id, score: 80 });
    console.log("=> Waiting 8 seconds... (Check Feishu for 红色 个人成绩下滑告警)");
    await delay(8000);

    console.log("\n=> STEP 3: Posting Exam 3 scores (A repeated wrong + Class drop to 2 Failures triggers orange alert) ...");
    await fetchApi('/api/exam-records', 'POST', {
      studentId: s1.id, examId: e3.exam.id, score: 55,
      wrongQuestions: [{ question_number: '5', knowledge_point: '导数与微分', question_content: '求(x^3)的导数', student_answer: 'x^2', correct_answer: '3x^2' }]
    });
    await fetchApi('/api/exam-records', 'POST', { studentId: s2.id, examId: e3.exam.id, score: 45 });
    console.log("=> Processing done!");
    console.log("\n✅ ALL DONE. You should see 3 messages in Feishu now: 1.李雷单次暴跌(红) 2.李雷导数重复错题(黄) 3.班级成绩连续下滑(橙, 不及格人数)");
  } catch (err) {
    console.error("Simulation failed:", err);
  }
}

run();

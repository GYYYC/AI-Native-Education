import { NextResponse } from 'next/server';
const db = require('../../../../../lib/db');
const { requireAuth } = require('../../../../../lib/auth');

function getOwnedStudent(studentId, user) {
  return db.prepare(`
    SELECT s.*, t.user_id, t.id as teacher_id
    FROM students s
    JOIN teachers t ON s.teacher_id = t.id
    WHERE s.id = ? AND (t.user_id = ? OR ? = 'boss')
  `).get(studentId, user.id, user.role);
}

export async function GET(request, { params }) {
  const user = requireAuth(request, ['teacher', 'boss']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const studentId = parseInt(params.id, 10);
  if (Number.isNaN(studentId)) return NextResponse.json({ error: '学生ID无效' }, { status: 400 });

  const student = getOwnedStudent(studentId, user);
  if (!student) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

  const courses = db.prepare(`
    SELECT sc.*, c.name, c.category, c.description, u.name as teacher_name
    FROM student_courses sc
    JOIN courses c ON sc.course_id = c.id
    JOIN teachers t ON sc.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE sc.student_id = ?
    ORDER BY sc.created_at DESC
  `).all(studentId);

  return NextResponse.json({ courses });
}

export async function POST(request, { params }) {
  const user = requireAuth(request, ['teacher']);
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const studentId = parseInt(params.id, 10);
  if (Number.isNaN(studentId)) return NextResponse.json({ error: '学生ID无效' }, { status: 400 });

  const student = getOwnedStudent(studentId, user);
  if (!student) return NextResponse.json({ error: '学生不存在或无权限' }, { status: 404 });

  try {
    const { courseId, startDate = '', endDate = '', status = 'active', notes = '' } = await request.json();
    const parsedCourseId = parseInt(courseId, 10);
    if (Number.isNaN(parsedCourseId)) return NextResponse.json({ error: '课程ID无效' }, { status: 400 });

    const course = db.prepare('SELECT id FROM courses WHERE id = ? AND active = 1').get(parsedCourseId);
    if (!course) return NextResponse.json({ error: '课程不存在或已禁用' }, { status: 404 });
    if (!['active', 'paused', 'completed'].includes(status)) {
      return NextResponse.json({ error: '学习状态无效' }, { status: 400 });
    }

    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
    if (!teacher) return NextResponse.json({ error: '教师信息缺失' }, { status: 403 });

    const result = db.prepare(`
      INSERT INTO student_courses (student_id, course_id, teacher_id, start_date, end_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, course_id, teacher_id) DO UPDATE SET
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        notes = excluded.notes
    `).run(studentId, parsedCourseId, teacher.id, startDate, endDate, status, notes);

    return NextResponse.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('绑定学生课程失败:', err);
    return NextResponse.json({ error: '绑定学生课程失败' }, { status: 500 });
  }
}


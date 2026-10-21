// Client-side permission helpers. They decide what the UI SHOWS.
// Real enforcement is Row Level Security in supabase/migrations/0003_rls.sql
// (see supabase/tests/security.test.js, which proves the database agrees with this matrix).

export const ROLES = { ADMIN: 'admin', TEACHER: 'teacher', REVIEWER: 'reviewer' }

const MATRIX = {
  'school.manage': ['admin'],
  'users.manage': ['admin'],
  'grading.configure': ['admin'],
  'years.manage': ['admin'],
  'sections.manage': ['admin'],
  'subjects.manage': ['admin'],
  'assignments.manage': ['admin'],
  'students.write': ['admin', 'teacher'],
  'students.delete': ['admin'],
  'assessments.write': ['admin', 'teacher'],
  'scores.write': ['admin', 'teacher'],
  'grades.finalize': ['admin', 'teacher'],
  'grades.reopen': ['admin', 'teacher', 'reviewer'],
  'grades.approve': ['admin', 'reviewer'],
  'attendance.write': ['admin', 'teacher'],
  'attendance.delete': ['admin'],
  'audit.read': ['admin', 'reviewer'],
  'reports.view': ['admin', 'teacher', 'reviewer'],
}

export function can(role, action) {
  return !!role && (MATRIX[action] ?? []).includes(role)
}

export const ROLE_LABELS = { admin: 'Administrator', teacher: 'Teacher', reviewer: 'School head / reviewer' }

/**
 * Sections a user may see. Mirrors public.can_read_section():
 * admins and reviewers see all, a teacher sees sections they teach or advise.
 */
export function visibleSections({ role, userId, sections, assignments }) {
  if (role === 'admin' || role === 'reviewer') return sections
  const taught = new Set(assignments.filter((a) => a.teacher_id === userId).map((a) => a.section_id))
  return sections.filter((s) => s.adviser_id === userId || taught.has(s.id))
}

/** Classes whose grades a user may edit. Mirrors public.can_write_assignment(). */
export function editableAssignments({ role, userId, assignments }) {
  if (role === 'admin') return assignments
  if (role === 'teacher') return assignments.filter((a) => a.teacher_id === userId)
  return []
}

export function canEditAssignment({ role, userId, assignment }) {
  return editableAssignments({ role, userId, assignments: [assignment] }).length === 1
}

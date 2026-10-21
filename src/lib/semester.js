// Senior High School (Grades 11-12) runs in semesters of 2 quarters each:
// semester 1 = quarters 1-2, semester 2 = quarters 3-4. A subject belongs to ONE semester,
// and its final grade is the average of those two quarters. Grades 7-10 have no semester (null).
export const SEMESTER_LABELS = { 1: '1st Semester', 2: '2nd Semester' }

export const SHS_MIN_LEVEL = 11

export function isSeniorHighLevel(level) {
  return Number(level) >= SHS_MIN_LEVEL
}

/** The grading periods that count for an assignment: all of them, or only its semester's two quarters. */
export function periodsForSemester(periods, semester, termCount) {
  if (!semester || termCount !== 4) return periods
  const first = (semester - 1) * 2 + 1
  return periods.filter((p) => p.term_no === first || p.term_no === first + 1)
}

/** Suggested SHS descriptors (DepEd Order 8, s. 2015). Verify before use. */
export const SHS_DESCRIPTORS = [
  { min: '90', label: 'Outstanding' },
  { min: '85', label: 'Very Satisfactory' },
  { min: '80', label: 'Satisfactory' },
  { min: '75', label: 'Fairly Satisfactory' },
  { min: '0', label: 'Did Not Meet Expectations' },
]

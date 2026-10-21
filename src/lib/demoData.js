// DEMO MODE ONLY. Fictional numbers shown when Supabase is not configured, so the interface can be
// previewed. Nothing here is real, nothing is saved, and no learner data is involved.
export const DEMO_SUMMARY = {
  students: 48,
  sections: 4,
  subjects: 8,
  students_complete: 31,
  class_average: 84.6,
  histogram: { 95: 6, 91: 11, 88: 14, 85: 9, 82: 6, 79: 4, 76: 3, 72: 2, 68: 1 },
  attendance: { present: 41, absent: 2, late: 3, excused: 2, total: 48 },
}

export const DEMO_DESCRIPTORS = [
  { min: 90, label: 'Advancing' }, { min: 80, label: 'Benchmarking' }, { min: 75, label: 'Connecting' },
  { min: 65, label: 'Developing' }, { min: 0, label: 'Emerging' },
]

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused']

export const ATTENDANCE_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' }

/**
 * Summarise attendance rows. The attendance rate uses the school's preferences:
 * late (and optionally excused) learners count as attending.
 */
export function summarizeAttendance(rows, prefs = {}) {
  const lateCounts = prefs.late_counts_as_present ?? true
  const excusedCounts = prefs.excused_counts_as_present ?? false
  const c = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const r of rows) if (c[r.status] !== undefined) c[r.status] += 1
  const total = c.present + c.absent + c.late + c.excused
  const attended = c.present + (lateCounts ? c.late : 0) + (excusedCounts ? c.excused : 0)
  return { ...c, total, rate: total === 0 ? null : (attended / total) * 100 }
}

/** Group rows by a key function and summarise each group. */
export function groupAttendance(rows, keyFn, prefs) {
  const groups = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return [...groups.entries()].map(([key, list]) => ({ key, ...summarizeAttendance(list, prefs) }))
}

export const monthKey = (isoDate) => String(isoDate).slice(0, 7)

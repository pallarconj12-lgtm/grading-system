// Transmutation is DATA. This module only provides (a) lookup mechanics, (b) validation of a table,
// and (c) a REFERENCE copy of the SY 2026-2027 table used to seed new schools.
//
// !! The reference table below was transcribed from third-party summaries of
// !! DepEd Order No. 015, s. 2026. It has NOT been verified against the official issuance.
// !! Administrators must compare it with the official annex before marking it verified.

// [minimum initial grade, transmuted grade]. A row applies from its minimum up to the next row's minimum.
const DO_015_S2026_MINIMUMS = [
  [0.0, 60], [4.68, 61], [9.35, 62], [14.01, 63], [18.68, 64], [23.35, 65], [28.01, 66],
  [32.68, 67], [37.34, 68], [42.01, 69], [46.67, 70], [51.34, 71], [56.01, 72], [60.67, 73],
  [65.34, 74], [70.0, 75], [71.18, 76], [72.36, 77], [73.54, 78], [74.72, 79], [75.9, 80],
  [77.08, 81], [78.26, 82], [79.44, 83], [80.62, 84], [81.8, 85], [82.98, 86], [84.16, 87],
  [85.34, 88], [86.52, 89], [87.7, 90], [88.88, 91], [90.06, 92], [91.24, 93], [92.42, 94],
  [93.6, 95], [94.78, 96], [95.96, 97], [97.14, 98], [98.32, 99], [99.5, 100],
]

const r2 = (n) => Math.round(n * 100) / 100

/** Turn [min, grade] pairs into rows with a computed max_initial (next min minus 0.01; last row ends at 100). */
export function buildRowsFromMinimums(pairs) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0])
  return sorted.map(([min, grade], i) => ({
    min_initial: r2(min),
    max_initial: i < sorted.length - 1 ? r2(sorted[i + 1][0] - 0.01) : 100,
    transmuted: grade,
  }))
}

export const DO_015_S2026_REFERENCE = {
  name: 'SY 2026-2027 adjusted table (DO 015 s. 2026)',
  policy_version: 'SY 2026-2027',
  policy_source:
    'DepEd Order No. 015, s. 2026. Transcribed from third-party summaries. NOT yet verified against the official issuance.',
  rows: buildRowsFromMinimums(DO_015_S2026_MINIMUMS),
}

/**
 * Look up the transmuted grade for an initial grade.
 * Returns null (never a guess) when there is no table, no matching row, or the grade is out of range.
 */
export function transmute(initialGrade, rows) {
  if (initialGrade == null || Number.isNaN(Number(initialGrade))) return null
  const g = Number(initialGrade)
  if (g < 0 || g > 100) return null
  if (!rows || rows.length === 0) return null
  let best = null
  for (const row of rows) {
    const min = Number(row.min_initial)
    if (min <= g && (best === null || min > Number(best.min_initial))) best = row
  }
  return best ? Number(best.transmuted) : null
}

/** Check a table before it is saved. Returns { valid, errors }. */
export function validateTransmutationRows(rows) {
  const errors = []
  if (!Array.isArray(rows) || rows.length < 2) {
    return { valid: false, errors: ['A transmutation table needs at least two rows.'] }
  }
  const sorted = [...rows].map((r) => ({
    min: Number(r.min_initial),
    max: Number(r.max_initial),
    grade: Number(r.transmuted),
  }))
  sorted.sort((a, b) => a.min - b.min)

  sorted.forEach((r, i) => {
    const n = i + 1
    if ([r.min, r.max, r.grade].some((v) => Number.isNaN(v))) errors.push(`Row ${n}: every value must be a number.`)
    if (r.min < 0 || r.max > 100) errors.push(`Row ${n}: initial grades must stay between 0 and 100.`)
    if (r.min > r.max) errors.push(`Row ${n}: the minimum is higher than the maximum.`)
    if (r.grade < 0 || r.grade > 100) errors.push(`Row ${n}: the transmuted grade must be between 0 and 100.`)
  })
  if (sorted[0].min !== 0) errors.push('The first row must start at an initial grade of 0.')
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.min === prev.min) errors.push(`Two rows start at ${cur.min}.`)
    if (cur.grade < prev.grade) errors.push(`The transmuted grade drops from ${prev.grade} to ${cur.grade} at ${cur.min}.`)
    if (Math.abs(r2(cur.min - prev.max) - 0.01) > 0.005) {
      errors.push(`There is a gap or overlap between ${prev.max} and ${cur.min}.`)
    }
  }
  if (sorted[sorted.length - 1].max !== 100) errors.push('The last row must end at 100.')
  return { valid: errors.length === 0, errors }
}

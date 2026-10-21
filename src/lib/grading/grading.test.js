import { describe, it, expect } from 'vitest'
import {
  computeTermGrade, computeFinalGrade, computeGeneralAverage, roundHalfUp,
  remarkFor, descriptorFor, bucketHistogram,
  transmute, validateTransmutationRows, DO_015_S2026_REFERENCE, buildRowsFromMinimums,
  parseScoreInput, validateWeights, validateLrn, validateStudent, normalizeLrn,
} from './index.js'

const ROWS = DO_015_S2026_REFERENCE.rows
const CORE = {
  ww_weight: 20, pt_weight: 50, qa_weight: 30,
  missing_policy: 'exclude_flag', initial_decimals: 2,
  transmutation_mode: 'table', minimum_reportable_grade: 60,
}

describe('roundHalfUp', () => {
  it('rounds .5 up and survives binary floating point', () => {
    expect(roundHalfUp(82.5, 0)).toBe(83)
    expect(roundHalfUp(82.49, 0)).toBe(82)
    expect(roundHalfUp(1.005, 2)).toBe(1.01)
    expect(roundHalfUp(86.69166, 2)).toBe(86.69)
  })
})

describe('rounding on an exact boundary (regression)', () => {
  it('rounds an initial grade that is exactly x.xx5 up, in every case', () => {
    // 29.53 / 40 = 73.825 exactly; the double nearest to it is 73.82499999999999
    const r = computeTermGrade({
      assessments: [{ id: 'a', category: 'WW', max_score: 40 }],
      scores: { a: { score: 29.53, is_excused: false } },
      config: { ...CORE, ww_weight: 100, pt_weight: 0, qa_weight: 0 },
      transmutationRows: ROWS,
    })
    expect(r.initialGrade).toBe(73.83)
    // 29/36 repeats forever; thirds and sixths must not disturb a clean total either
    const t = computeTermGrade({
      assessments: [{ id: 'a', category: 'WW', max_score: 36 }, { id: 'b', category: 'PT', max_score: 3 }],
      scores: { a: { score: 29, is_excused: false }, b: { score: 2, is_excused: false } },
      config: { ...CORE, ww_weight: 50, pt_weight: 50, qa_weight: 0 },
      transmutationRows: ROWS,
    })
    expect(t.initialGrade).toBe(73.61) // (80.5555... + 66.6666...) / 2 = 73.6111...
  })
})

describe('reference transmutation table (SY 2026-2027, unverified)', () => {
  it('is structurally valid: starts at 0, ends at 100, contiguous, never decreasing', () => {
    expect(ROWS).toHaveLength(41)
    expect(validateTransmutationRows(ROWS)).toEqual({ valid: true, errors: [] })
    expect(ROWS[0]).toMatchObject({ min_initial: 0, max_initial: 4.67, transmuted: 60 })
    expect(ROWS.at(-1)).toMatchObject({ min_initial: 99.5, max_initial: 100, transmuted: 100 })
  })

  it('maps band edges as printed in the published table', () => {
    const cases = [
      [100, 100], [99.5, 100], [99.49, 99], [98.32, 99], [98.31, 98],
      [90.06, 92], [90.05, 91], [75.9, 80], [75.89, 79],
      [71.18, 76], [71.17, 75], [70.0, 75], [69.99, 74], [65.34, 74], [65.33, 73],
      [46.67, 70], [4.68, 61], [4.67, 60], [0, 60],
    ]
    for (const [initial, expected] of cases) {
      expect(transmute(initial, ROWS), `initial ${initial}`).toBe(expected)
    }
  })

  it('returns null, never a guess, when there is no table or the grade is out of range', () => {
    expect(transmute(80, [])).toBeNull()
    expect(transmute(80, undefined)).toBeNull()
    expect(transmute(null, ROWS)).toBeNull()
    expect(transmute(101, ROWS)).toBeNull()
    expect(transmute(-1, ROWS)).toBeNull()
  })
})

describe('validateTransmutationRows', () => {
  it('rejects tables that do not start at 0, have gaps, or go down', () => {
    expect(validateTransmutationRows([]).valid).toBe(false)
    const noZero = buildRowsFromMinimums([[10, 60], [50, 75]])
    expect(validateTransmutationRows(noZero).errors.join(' ')).toMatch(/start at an initial grade of 0/)
    const gap = [
      { min_initial: 0, max_initial: 40, transmuted: 60 },
      { min_initial: 50, max_initial: 100, transmuted: 75 },
    ]
    expect(validateTransmutationRows(gap).errors.join(' ')).toMatch(/gap or overlap/)
    const down = buildRowsFromMinimums([[0, 70], [50, 60]])
    expect(validateTransmutationRows(down).errors.join(' ')).toMatch(/drops/)
  })
})

describe('computeTermGrade', () => {
  // Worked example, checked by hand:
  //   WW pooled      67/75   = 89.3333%
  //   PT pooled      175/200 = 87.5%
  //   QA weighted    0.3*87.5 + 0.3*80 + 0.4*83.3333 = 83.5833%
  //   initial        0.2*89.3333 + 0.5*87.5 + 0.3*83.5833 = 86.69  -> table band 86.52-87.69 -> 89
  const assessments = [
    { id: 'w1', category: 'WW', max_score: 20 }, { id: 'w2', category: 'WW', max_score: 25 }, { id: 'w3', category: 'WW', max_score: 30 },
    { id: 'p1', category: 'PT', max_score: 50 }, { id: 'p2', category: 'PT', max_score: 50 }, { id: 'p3', category: 'PT', max_score: 100 },
    { id: 'e1', category: 'QA', max_score: 40, weight: 30 }, { id: 'e2', category: 'QA', max_score: 40, weight: 30 }, { id: 'e3', category: 'QA', max_score: 60, weight: 40 },
  ]
  const full = Object.fromEntries(
    Object.entries({ w1: 18, w2: 22, w3: 27, p1: 45, p2: 40, p3: 90, e1: 35, e2: 32, e3: 50 })
      .map(([k, v]) => [k, { score: v, is_excused: false }]),
  )

  it('follows the workflow: component % -> weight -> initial grade -> transmutation', () => {
    const r = computeTermGrade({ assessments, scores: full, config: CORE, transmutationRows: ROWS })
    expect(r.components.WW.pct).toBeCloseTo(89.3333, 3)
    expect(r.components.PT.pct).toBeCloseTo(87.5, 6)
    expect(r.components.QA.weighted).toBe(true)
    expect(r.components.QA.pct).toBeCloseTo(83.5833, 3)
    expect(r.initialGrade).toBe(86.69)
    expect(r.transmutedGrade).toBe(89)
    expect(r.isComplete).toBe(true)
    expect(r.status).toBe('provisional')
    expect(r.reasons).toEqual([])
  })

  it('never silently treats a missing score as zero', () => {
    const missing = { ...full }
    delete missing.p3
    const asMissing = computeTermGrade({ assessments, scores: missing, config: CORE, transmutationRows: ROWS })
    const asZero = computeTermGrade({
      assessments, scores: { ...full, p3: { score: 0, is_excused: false } }, config: CORE, transmutationRows: ROWS,
    })
    expect(asMissing.missingCount).toBe(1)
    expect(asMissing.isComplete).toBe(false)
    expect(asMissing.reasons.join(' ')).toMatch(/1 score is missing/)
    expect(asMissing.components.PT.pct).toBeCloseTo(85, 6) // 85/100 of the scored work only
    expect(asZero.components.PT.pct).toBeCloseTo(42.5, 6) // an explicit zero DOES count: 85/200
    expect(asMissing.initialGrade).not.toBe(asZero.initialGrade)
  })

  it('"block" policy withholds the grade until everything is entered or excused', () => {
    const missing = { ...full }
    delete missing.w2
    const blocked = computeTermGrade({
      assessments, scores: missing, config: { ...CORE, missing_policy: 'block' }, transmutationRows: ROWS,
    })
    expect(blocked.initialGrade).toBeNull()
    expect(blocked.transmutedGrade).toBeNull()
    expect(blocked.status).toBe('incomplete')

    const excused = { ...missing, w2: { score: null, is_excused: true } }
    const ok = computeTermGrade({
      assessments, scores: excused, config: { ...CORE, missing_policy: 'block' }, transmutationRows: ROWS,
    })
    expect(ok.transmutedGrade).not.toBeNull()
    expect(ok.isComplete).toBe(true)
    expect(ok.components.WW.possible).toBe(50) // excused work is removed from the total
  })

  it('is incomplete when a weighted component has nothing scored', () => {
    const noQa = { ...full }
    delete noQa.e1; delete noQa.e2; delete noQa.e3
    const r = computeTermGrade({ assessments, scores: noQa, config: CORE, transmutationRows: ROWS })
    expect(r.transmutedGrade).toBeNull()
    expect(r.status).toBe('incomplete')
    expect(r.reasons.join(' ')).toMatch(/No QA scores/)
  })

  it('ignores a component whose weight is 0', () => {
    const r = computeTermGrade({
      assessments: assessments.filter((a) => a.category !== 'QA'),
      scores: full,
      config: { ...CORE, ww_weight: 40, pt_weight: 60, qa_weight: 0 },
      transmutationRows: ROWS,
    })
    expect(r.initialGrade).toBeCloseTo(0.4 * 89.3333 + 0.6 * 87.5, 1)
    expect(r.transmutedGrade).not.toBeNull()
  })

  it('does not invent a transmuted grade when no table is configured', () => {
    const r = computeTermGrade({ assessments, scores: full, config: CORE, transmutationRows: [] })
    expect(r.initialGrade).toBe(86.69)
    expect(r.transmutedGrade).toBeNull()
    expect(r.status).toBe('incomplete')
    expect(r.reasons.join(' ')).toMatch(/transmutation table/i)
  })

  it('zero-based mode: the computed grade is the term grade, with a configurable floor', () => {
    const zb = { ...CORE, transmutation_mode: 'zero_based', minimum_reportable_grade: 60 }
    const high = computeTermGrade({ assessments, scores: full, config: zb })
    expect(high.transmutedGrade).toBe(87) // 86.69 rounds to 87, no table involved
    const low = computeTermGrade({
      assessments,
      scores: Object.fromEntries(assessments.map((a) => [a.id, { score: a.max_score * 0.3, is_excused: false }])),
      config: zb,
    })
    expect(low.initialGrade).toBe(30)
    expect(low.transmutedGrade).toBe(60)
  })

  it('uses pooled points when exam assessments do not all have weights', () => {
    const mixed = assessments.map((a) => (a.id === 'e3' ? { ...a, weight: undefined } : a))
    const r = computeTermGrade({ assessments: mixed, scores: full, config: CORE, transmutationRows: ROWS })
    expect(r.components.QA.weighted).toBe(false)
    expect(r.components.QA.pct).toBeCloseTo((35 + 32 + 50) / 140 * 100, 6)
  })
})

describe('final grade, general average, remarks, descriptors', () => {
  it('averages the term grades and rounds .5 up', () => {
    expect(computeFinalGrade([88, 90, 85], 3)).toBe(88) // 87.67
    expect(computeFinalGrade([82, 83, 82, 83], 4)).toBe(83) // 82.5 -> 83
    expect(computeFinalGrade([88, 90], 3)).toBeNull()
    expect(computeFinalGrade([88, null, 90], 3)).toBeNull()
  })
  it('computes the general average only when every subject has a final grade', () => {
    expect(computeGeneralAverage([88, 90, 85, 79])).toBe(86) // 85.5 -> 86
    expect(computeGeneralAverage([88, null])).toBeNull()
    expect(computeGeneralAverage([])).toBeNull()
  })
  it('remarks follow the configured passing grade', () => {
    expect(remarkFor(75)).toBe('Passed')
    expect(remarkFor(74)).toBe('Failed')
    expect(remarkFor(74, 70)).toBe('Passed')
    expect(remarkFor(null)).toBe('')
  })
  it('descriptors and histogram buckets come from configurable bands', () => {
    const d = [{ min: 90, label: 'A' }, { min: 80, label: 'B' }, { min: 0, label: 'C' }]
    expect(descriptorFor(95, d)).toBe('A')
    expect(descriptorFor(80, d)).toBe('B')
    expect(descriptorFor(79, d)).toBe('C')
    const buckets = bucketHistogram({ 95: 2, 85: 3, 70: 1 }, d)
    expect(buckets.map((b) => [b.label, b.count])).toEqual([['A', 2], ['B', 3], ['C', 1]])
  })
})

describe('input validation', () => {
  it('score input: blank is missing, X is excused, ranges are enforced', () => {
    expect(parseScoreInput('', 20)).toEqual({ kind: 'missing' })
    expect(parseScoreInput('  ', 20)).toEqual({ kind: 'missing' })
    expect(parseScoreInput('x', 20)).toEqual({ kind: 'excused' })
    expect(parseScoreInput('EX', 20)).toEqual({ kind: 'excused' })
    expect(parseScoreInput('0', 20)).toEqual({ kind: 'value', value: 0 })
    expect(parseScoreInput('17.5', 20)).toEqual({ kind: 'value', value: 17.5 })
    expect(parseScoreInput('20', 20).kind).toBe('value')
    expect(parseScoreInput('20.01', 20).kind).toBe('error')
    expect(parseScoreInput('-1', 20).kind).toBe('error')
    expect(parseScoreInput('abc', 20).kind).toBe('error')
    expect(parseScoreInput('1.234', 20).kind).toBe('error')
  })
  it('weights must be numbers that total exactly 100', () => {
    expect(validateWeights(20, 50, 30).valid).toBe(true)
    expect(validateWeights('20', '60', '20').valid).toBe(true)
    expect(validateWeights(20, 50, 20).errors[0]).toMatch(/add up to 100/)
    expect(validateWeights(20, 50, '').valid).toBe(false)
    expect(validateWeights(-10, 60, 50).valid).toBe(false)
    expect(validateWeights(0, 0, 100).valid).toBe(true)
  })
  it('LRN must be 12 digits; spreadsheet text wrappers are removed', () => {
    expect(validateLrn('900000000001').valid).toBe(true)
    expect(validateLrn('90000000001').valid).toBe(false)
    expect(validateLrn('90000000000a').valid).toBe(false)
    expect(normalizeLrn('="900000000001"')).toBe('900000000001')
    expect(normalizeLrn(' 9000 0000 0001 ')).toBe('900000000001')
  })
  it('validates a learner record', () => {
    const ok = validateStudent({ lrn: '900000000001', first_name: ' Juan ', last_name: 'Dela Cruz', sex: 'male' })
    expect(ok.valid).toBe(true)
    expect(ok.clean).toMatchObject({ first_name: 'Juan', sex: 'Male', middle_name: null })
    const bad = validateStudent({ lrn: '123', first_name: '', last_name: 'X', sex: 'robot' })
    expect(bad.valid).toBe(false)
    expect(bad.errors).toHaveLength(3)
  })
})

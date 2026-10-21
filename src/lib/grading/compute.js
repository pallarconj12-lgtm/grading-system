// The grade engine. It mirrors the SQL functions in supabase/migrations/0002_functions.sql
// (recompute_term_grade / recompute_final_grade). A parity test runs both against the same data.
import { transmute } from './transmutation.js'

export const COMPONENTS = ['WW', 'PT', 'QA']

export const COMPONENT_LABELS = {
  WW: 'Written / Oral Works',
  PT: 'Product / Performance Tasks',
  QA: 'Quarterly Assessment / Examinations',
}

export const COMPONENT_SHORT = { WW: 'WW', PT: 'PT', QA: 'QA' }

/**
 * Round half up at a number of decimals (0.5 always rounds up).
 * The 1e-9 tolerance matches the SQL engine (see recompute_term_grade) so that a value which is
 * mathematically exactly on a .xx5 boundary rounds up in both, despite floating point / numeric truncation.
 */
export function roundHalfUp(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const f = 10 ** decimals
  return Math.floor((value + 1e-9) * f + 0.5) / f
}

const weightKey = { WW: 'ww_weight', PT: 'pt_weight', QA: 'qa_weight' }

/**
 * Compute one learner's grade for one term.
 *
 * @param assessments  [{ id, category, max_score, weight? }]  all assessments of this class and term
 * @param scores       { [assessmentId]: { score: number|null, is_excused: boolean } }  this learner's rows
 * @param config       { ww_weight, pt_weight, qa_weight, missing_policy, initial_decimals,
 *                       transmutation_mode, minimum_reportable_grade }
 * @param transmutationRows  rows of the transmutation table (used when mode is 'table')
 */
export function computeTermGrade({ assessments, scores = {}, config, transmutationRows = [] }) {
  const reasons = []
  const components = {}
  let missingCount = 0

  for (const cat of COMPONENTS) {
    const list = assessments.filter((a) => a.category === cat)
    // weighted mode only when EVERY assessment of the component carries a weight
    const weighted = list.length > 0 && list.every((a) => a.weight !== null && a.weight !== undefined)
    let earned = 0
    let possible = 0
    let wsum = 0
    let wscore = 0
    let missing = 0
    let scored = 0

    for (const a of list) {
      const row = scores[a.id]
      const excused = !!row?.is_excused
      const has = row && row.score !== null && row.score !== undefined
      if (excused) continue
      if (!has) {
        missing += 1
        continue
      }
      scored += 1
      earned += Number(row.score)
      possible += Number(a.max_score)
      if (weighted) {
        wsum += Number(a.weight)
        wscore += (Number(a.weight) * Number(row.score)) / Number(a.max_score)
      }
    }

    let pct = null
    if (weighted) {
      if (wsum > 0) pct = (wscore / wsum) * 100
    } else if (possible > 0) {
      pct = (earned / possible) * 100
    }

    const weight = Number(config[weightKey[cat]])
    components[cat] = {
      weight,
      weighted,
      assessmentCount: list.length,
      scored,
      missing,
      earned,
      possible,
      pct,
      weightedScore: pct === null ? null : (pct * weight) / 100,
    }
    missingCount += missing
  }

  // A component that carries weight needs at least one scored assessment.
  const usable = COMPONENTS.every((c) => components[c].weight === 0 || components[c].pct !== null)
  if (!usable) {
    for (const c of COMPONENTS) {
      if (components[c].weight > 0 && components[c].pct === null) {
        reasons.push(
          components[c].assessmentCount === 0
            ? `No ${c} assessments have been added.`
            : `No ${c} scores have been entered yet.`,
        )
      }
    }
  }
  if (missingCount > 0) reasons.push(`${missingCount} score${missingCount === 1 ? ' is' : 's are'} missing.`)

  const blocked = config.missing_policy === 'block' && missingCount > 0
  let initialGrade = null
  let transmutedGrade = null

  if (usable && !blocked) {
    const total = COMPONENTS.reduce((sum, c) => sum + (components[c].pct ?? 0) * (components[c].weight / 100), 0)
    initialGrade = roundHalfUp(total, config.initial_decimals ?? 2)

    if (config.transmutation_mode === 'zero_based') {
      transmutedGrade = Math.max(Number(config.minimum_reportable_grade ?? 60), roundHalfUp(initialGrade, 0))
    } else {
      transmutedGrade = transmute(initialGrade, transmutationRows)
      if (transmutedGrade === null) reasons.push('No transmutation table is configured for this subject.')
    }
  } else if (blocked) {
    reasons.push('This subject does not allow a grade until every score is entered or excused.')
  }

  const isComplete = usable && missingCount === 0 && transmutedGrade !== null
  return {
    components,
    missingCount,
    initialGrade,
    transmutedGrade,
    status: transmutedGrade === null ? 'incomplete' : 'provisional',
    isComplete,
    reasons,
  }
}

/** Final grade = average of all term grades, rounded to a whole number. Null until every term has a grade. */
export function computeFinalGrade(termGrades, termCount) {
  const used = termGrades.slice(0, termCount)
  if (used.length < termCount || used.some((g) => g === null || g === undefined)) return null
  return roundHalfUp(used.reduce((s, g) => s + Number(g), 0) / termCount, 0)
}

/** General average = average of final grades. Null if any subject is still missing a final grade. */
export function computeGeneralAverage(finalGrades) {
  if (!finalGrades.length || finalGrades.some((g) => g === null || g === undefined)) return null
  return roundHalfUp(finalGrades.reduce((s, g) => s + Number(g), 0) / finalGrades.length, 0)
}

/** Pass/fail remark from the configured passing grade. */
export function remarkFor(grade, passingGrade = 75) {
  if (grade === null || grade === undefined) return ''
  return Number(grade) >= Number(passingGrade) ? 'Passed' : 'Failed'
}

/** Grade descriptor from configurable bands: [{ min, label }]. Highest matching minimum wins. */
export function descriptorFor(grade, descriptors) {
  if (grade === null || grade === undefined || !descriptors?.length) return ''
  const sorted = [...descriptors].sort((a, b) => b.min - a.min)
  return sorted.find((d) => Number(grade) >= d.min)?.label ?? ''
}

/** Roll a grade histogram ({ '88': 3, ... }) up into descriptor bands. */
export function bucketHistogram(histogram, descriptors) {
  const sorted = [...descriptors].sort((a, b) => b.min - a.min)
  return sorted.map((d, i) => {
    const upper = i === 0 ? Infinity : sorted[i - 1].min
    const count = Object.entries(histogram || {})
      .filter(([g]) => Number(g) >= d.min && Number(g) < upper)
      .reduce((s, [, n]) => s + Number(n), 0)
    return { label: d.label, min: d.min, count }
  })
}

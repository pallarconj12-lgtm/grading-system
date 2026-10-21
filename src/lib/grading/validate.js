// Input validation shared by the gradebook, CSV import and student forms.

/**
 * Interpret what a teacher typed into a score cell.
 *   ''            -> { kind: 'missing' }   (a missing score; NEVER treated as zero)
 *   'x' / 'ex'    -> { kind: 'excused' }
 *   '17.5'        -> { kind: 'value', value: 17.5 }
 *   anything else -> { kind: 'error', error }
 */
export function parseScoreInput(raw, maxScore) {
  if (raw === null || raw === undefined) return { kind: 'missing' }
  const text = String(raw).trim()
  if (text === '') return { kind: 'missing' }
  if (/^(x|ex|exc|excused)$/i.test(text)) return { kind: 'excused' }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { kind: 'error', error: 'Enter a number, or X for excused.' }
  const value = Number(text)
  if (value < 0) return { kind: 'error', error: 'A score cannot be below 0.' }
  if (maxScore != null && value > Number(maxScore)) {
    return { kind: 'error', error: `A score cannot be above the maximum of ${maxScore}.` }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { kind: 'error', error: 'Use at most 2 decimal places.' }
  return { kind: 'value', value }
}

/** Component weights must be numbers from 0 to 100 that add up to exactly 100. */
export function validateWeights(ww, pt, qa) {
  const errors = []
  const parts = { 'Written Works': ww, 'Performance Tasks': pt, 'Quarterly Assessment': qa }
  let total = 0
  for (const [label, raw] of Object.entries(parts)) {
    const v = Number(raw)
    if (raw === '' || raw === null || raw === undefined || Number.isNaN(v)) {
      errors.push(`${label}: enter a number.`)
      continue
    }
    if (v < 0 || v > 100) errors.push(`${label}: must be between 0 and 100.`)
    total += v
  }
  if (errors.length === 0 && Math.abs(total - 100) > 0.005) {
    errors.push(`Weights must add up to 100% (currently ${Math.round(total * 100) / 100}%).`)
  }
  return { valid: errors.length === 0, errors, total }
}

export const LRN_PATTERN = /^[0-9]{12}$/

/** Remove the spreadsheet text wrapper (="...") and whitespace from an LRN. */
export function normalizeLrn(value) {
  let s = String(value ?? '').trim()
  const wrapped = s.match(/^="?(.*?)"?$/)
  if (s.startsWith('=') && wrapped) s = wrapped[1]
  return s.replace(/\s+/g, '')
}

export function validateLrn(value) {
  const lrn = normalizeLrn(value)
  if (!LRN_PATTERN.test(lrn)) return { valid: false, lrn, error: 'The LRN must be exactly 12 digits.' }
  return { valid: true, lrn }
}

const SEX_VALUES = { male: 'Male', m: 'Male', lalaki: 'Male', female: 'Female', f: 'Female', babae: 'Female' }

export function normalizeSex(value) {
  const key = String(value ?? '').trim().toLowerCase()
  if (key === '') return { ok: true, value: null }
  return SEX_VALUES[key] ? { ok: true, value: SEX_VALUES[key] } : { ok: false, value: null }
}

/** Validate one learner (form or CSV row). Returns { valid, errors, clean }. */
export function validateStudent(input) {
  const errors = []
  const lrn = validateLrn(input.lrn)
  if (!lrn.valid) errors.push(lrn.error)
  const first = String(input.first_name ?? '').trim()
  const last = String(input.last_name ?? '').trim()
  if (!first) errors.push('First name is required.')
  if (!last) errors.push('Last name is required.')
  const sex = normalizeSex(input.sex)
  if (!sex.ok) errors.push('Sex must be Male or Female (or left blank).')
  return {
    valid: errors.length === 0,
    errors,
    clean: {
      lrn: lrn.lrn,
      first_name: first,
      middle_name: String(input.middle_name ?? '').trim() || null,
      last_name: last,
      suffix: String(input.suffix ?? '').trim() || null,
      sex: sex.value,
    },
  }
}

export function fullName(s, { lastFirst = true } = {}) {
  if (!s) return ''
  const mid = s.middle_name ? `${s.middle_name.trim().charAt(0).toUpperCase()}.` : ''
  const suffix = s.suffix ? ` ${s.suffix}` : ''
  return lastFirst
    ? `${s.last_name}${suffix}, ${s.first_name}${mid ? ' ' + mid : ''}`
    : `${s.first_name}${mid ? ' ' + mid : ''} ${s.last_name}${suffix}`
}

export function fmtNum(n, decimals = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-'
  return Number(n).toFixed(decimals)
}

export function fmtPct(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-'
  return `${Number(n).toFixed(decimals)}%`
}

export function fmtGrade(n) {
  return n === null || n === undefined ? '-' : String(n)
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const todayIso = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function errorMessage(e) {
  if (!e) return 'Something went wrong.'
  return e.message || e.error_description || String(e)
}

export const STATUS_LABELS = {
  incomplete: 'Incomplete',
  provisional: 'Provisional',
  finalized: 'Finalized',
  approved: 'Approved',
}

export const ENROLLMENT_LABELS = {
  enrolled: 'Enrolled',
  transferred_out: 'Transferred out',
  dropped: 'Dropped',
  archived: 'Archived',
}

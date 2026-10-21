// CSV helpers. Exports are UTF-8 with a byte-order mark so Excel opens Filipino characters correctly.

/** Marks a value that must stay text in Excel (e.g. a 12-digit LRN, which Excel would show as 1.2E+11). */
export class ExcelText {
  constructor(value) {
    this.value = String(value ?? '')
  }
}

const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(cell) {
  if (cell === null || cell === undefined) return ''
  let text
  if (cell instanceof ExcelText) {
    text = `="${cell.value.replace(/"/g, '""')}"`
  } else if (typeof cell === 'number') {
    text = Number.isFinite(cell) ? String(cell) : ''
  } else {
    text = String(cell)
    // Stop spreadsheet formula injection: a text cell must never start a formula.
    if (FORMULA_START.test(text)) text = `'${text}`
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows, { bom = true } = {}) {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
  return (bom ? '﻿' : '') + body + '\r\n'
}

/** Parse CSV text into an array of string arrays. Handles quotes, escaped quotes, CRLF and a BOM. */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

/** Parse CSV into objects keyed by a normalised header (lower case, underscores). */
export function parseCsvObjects(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return { headers: [], records: [] }
  const headers = rows[0].map(normalizeHeader)
  const records = rows.slice(1).map((r, i) => {
    const rec = { __line: i + 2 }
    headers.forEach((h, idx) => {
      rec[h] = (r[idx] ?? '').trim()
    })
    return rec
  })
  return { headers, records }
}

export function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Browser only: download text as a file. */
export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename, rows) {
  downloadFile(filename, toCsv(rows))
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

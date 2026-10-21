import { describe, it, expect } from 'vitest'
import { toCsv, parseCsv, parseCsvObjects, ExcelText, normalizeHeader } from './csv.js'
import { can, visibleSections, editableAssignments, canEditAssignment } from './permissions.js'
import { summarizeAttendance, groupAttendance, monthKey } from './attendance.js'
import { fullName } from './format.js'

describe('csv', () => {
  it('round-trips quotes, commas, newlines and unicode', () => {
    const rows = [['Name', 'Note'], ['Dela Cruz, Juan', 'said "hi"\nbye'], ['Peña', 'ñ']]
    const parsed = parseCsv(toCsv(rows))
    expect(parsed).toEqual(rows)
  })
  it('prefixes cells that could run as spreadsheet formulas', () => {
    const csv = toCsv([['=HYPERLINK("x")', '+1', '@cmd', '-5', 'safe']])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+1")
    expect(csv).toContain("'@cmd")
    expect(csv).toContain("'-5")
    expect(csv).toContain('safe')
    expect(toCsv([[-5]], { bom: false })).toBe('-5\r\n') // real numbers are untouched
  })
  it('keeps LRNs as text in Excel and reads them back', () => {
    const csv = toCsv([['LRN'], [new ExcelText('900000000001')]])
    expect(csv).toContain('"=""900000000001"""')
    const { records } = parseCsvObjects(csv)
    expect(records[0].lrn).toBe('="900000000001"')
  })
  it('strips the BOM, handles CRLF and skips blank lines', () => {
    const { headers, records } = parseCsvObjects('﻿LRN,First Name\r\n1,A\r\n\r\n2,B\r\n')
    expect(headers).toEqual(['lrn', 'first_name'])
    expect(records.map((r) => r.first_name)).toEqual(['A', 'B'])
    expect(records[1].__line).toBe(3) // data row number + 1 (blank lines are skipped before numbering)
    expect(normalizeHeader('Last Name ')).toBe('last_name')
  })
})

describe('permissions matrix', () => {
  it('only administrators manage rules, users and structure', () => {
    for (const a of ['grading.configure', 'users.manage', 'sections.manage', 'subjects.manage', 'assignments.manage', 'school.manage']) {
      expect(can('admin', a)).toBe(true)
      expect(can('teacher', a)).toBe(false)
      expect(can('reviewer', a)).toBe(false)
    }
  })
  it('reviewers are read-only except approving and returning grades', () => {
    expect(can('reviewer', 'grades.approve')).toBe(true)
    expect(can('reviewer', 'grades.reopen')).toBe(true)
    expect(can('reviewer', 'scores.write')).toBe(false)
    expect(can('reviewer', 'students.write')).toBe(false)
    expect(can('reviewer', 'attendance.write')).toBe(false)
    expect(can('reviewer', 'audit.read')).toBe(true)
    expect(can('teacher', 'audit.read')).toBe(false)
    expect(can('teacher', 'grades.approve')).toBe(false)
  })
  it('unknown roles and actions are denied', () => {
    expect(can(undefined, 'reports.view')).toBe(false)
    expect(can('teacher', 'does.not.exist')).toBe(false)
  })

  const sections = [{ id: 's1', adviser_id: 'u2' }, { id: 's2', adviser_id: null }, { id: 's3', adviser_id: null }]
  const assignments = [
    { id: 'a1', section_id: 's1', teacher_id: 'u1' },
    { id: 'a2', section_id: 's2', teacher_id: 'u1' },
    { id: 'a3', section_id: 's3', teacher_id: 'u3' },
  ]
  it('a teacher sees only sections they teach or advise', () => {
    expect(visibleSections({ role: 'teacher', userId: 'u1', sections, assignments }).map((s) => s.id)).toEqual(['s1', 's2'])
    expect(visibleSections({ role: 'teacher', userId: 'u2', sections, assignments }).map((s) => s.id)).toEqual(['s1'])
    expect(visibleSections({ role: 'teacher', userId: 'nobody', sections, assignments })).toEqual([])
    expect(visibleSections({ role: 'reviewer', userId: 'x', sections, assignments })).toHaveLength(3)
  })
  it('a teacher edits only their own classes; reviewers and advisers cannot edit', () => {
    expect(editableAssignments({ role: 'teacher', userId: 'u1', assignments }).map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(editableAssignments({ role: 'reviewer', userId: 'u1', assignments })).toEqual([])
    expect(canEditAssignment({ role: 'teacher', userId: 'u2', assignment: assignments[0] })).toBe(false)
    expect(canEditAssignment({ role: 'admin', userId: 'x', assignment: assignments[2] })).toBe(true)
  })
})

describe('attendance summary', () => {
  const rows = [
    { status: 'present', attendance_date: '2026-10-01' }, { status: 'present', attendance_date: '2026-10-02' },
    { status: 'late', attendance_date: '2026-10-02' }, { status: 'absent', attendance_date: '2026-11-03' },
    { status: 'excused', attendance_date: '2026-11-03' },
  ]
  it('applies the school preferences to the rate', () => {
    expect(summarizeAttendance(rows).rate).toBeCloseTo(60, 6) // present + late
    expect(summarizeAttendance(rows, { late_counts_as_present: false }).rate).toBeCloseTo(40, 6)
    expect(summarizeAttendance(rows, { excused_counts_as_present: true }).rate).toBeCloseTo(80, 6)
    expect(summarizeAttendance([]).rate).toBeNull()
  })
  it('groups by month', () => {
    const g = groupAttendance(rows, (r) => monthKey(r.attendance_date))
    expect(g.map((x) => [x.key, x.total])).toEqual([['2026-10', 3], ['2026-11', 2]])
  })
})

describe('format', () => {
  it('formats learner names', () => {
    const s = { first_name: 'Juan', middle_name: 'Santos', last_name: 'Dela Cruz', suffix: 'Jr.' }
    expect(fullName(s)).toBe('Dela Cruz Jr., Juan S.')
    expect(fullName(s, { lastFirst: false })).toBe('Juan S. Dela Cruz Jr.')
  })
})

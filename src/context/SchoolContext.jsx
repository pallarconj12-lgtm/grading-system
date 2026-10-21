import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, unwrap, fetchAll } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'
import { can } from '../lib/permissions.js'

const SchoolContext = createContext(null)

const DEFAULT_DESCRIPTORS = [
  { min: 90, label: 'Advancing' }, { min: 80, label: 'Benchmarking' }, { min: 75, label: 'Connecting' },
  { min: 65, label: 'Developing' }, { min: 0, label: 'Emerging' },
]

/**
 * Loads everything the pages share: school, role, school years, sections, subjects, assignments,
 * grading rules and members. Row Level Security decides which rows each role receives, so a teacher
 * only ever gets their own sections and classes here.
 */
export function SchoolProvider({ children }) {
  const { user } = useAuth()
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [yearId, setYearId] = useState(null)

  const load = useCallback(async () => {
    try {
      const membership = unwrap(
        await supabase.from('school_memberships').select('id, role, school_id').eq('user_id', user.id).maybeSingle(),
      )
      if (!membership) {
        setState({ loading: false, error: null, data: { membership: null } })
        return
      }
      const sid = membership.school_id
      const [school, settings, years, levels, sections, subjects, periods, assignments, configs, tables, members, signatories, profile] =
        await Promise.all([
          supabase.from('schools').select('*').eq('id', sid).single(),
          supabase.from('school_settings').select('*').eq('school_id', sid).maybeSingle(),
          supabase.from('academic_years').select('*').eq('school_id', sid).order('label', { ascending: false }),
          supabase.from('grade_levels').select('*').eq('school_id', sid).order('level'),
          fetchAll(() => supabase.from('sections').select('*').eq('school_id', sid).order('name').order('id')),
          supabase.from('subjects').select('*').eq('school_id', sid).order('sort_order').order('name'),
          supabase.from('grading_periods').select('*').eq('school_id', sid).order('term_no'),
          fetchAll(() => supabase.from('teacher_assignments').select('*').eq('school_id', sid).order('id')),
          supabase.from('grading_configurations').select('*').eq('school_id', sid).order('name'),
          supabase.from('transmutation_tables').select('*').eq('school_id', sid).order('name'),
          supabase.from('school_memberships').select('id, user_id, role, profiles(full_name, email)').eq('school_id', sid),
          supabase.from('report_signatories').select('*').eq('school_id', sid).order('sort_order'),
          supabase.from('profiles').select('id, full_name, email').eq('id', user.id).single(),
        ])
      const get = (r) => unwrap(r)
      setState({
        loading: false,
        error: null,
        data: {
          membership,
          school: get(school),
          settings: get(settings),
          years: get(years),
          levels: get(levels),
          sections,
          subjects: get(subjects),
          periods: get(periods),
          assignments,
          configs: get(configs),
          tables: get(tables),
          members: get(members),
          signatories: get(signatories),
          profile: get(profile),
        },
      })
    } catch (error) {
      setState({ loading: false, error, data: null })
    }
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  const value = useMemo(() => {
    const d = state.data
    if (!d || !d.membership) {
      return { loading: state.loading, error: state.error, school: null, reload: load }
    }
    const year = d.years.find((y) => y.id === yearId) ?? d.years.find((y) => y.is_current) ?? d.years[0] ?? null
    const periods = d.periods.filter((p) => p.academic_year_id === year?.id)
    const memberName = (uid) => {
      const m = d.members.find((x) => x.user_id === uid)
      return m?.profiles?.full_name || m?.profiles?.email || 'Unassigned'
    }
    const role = d.membership.role
    return {
      loading: false,
      error: null,
      user,
      role,
      can: (action) => can(role, action),
      school: d.school,
      settings: d.settings,
      descriptors: d.settings?.descriptors?.length ? d.settings.descriptors : DEFAULT_DESCRIPTORS,
      years: d.years,
      year,
      setYearId,
      levels: d.levels,
      sections: d.sections,
      yearSections: d.sections.filter((s) => s.academic_year_id === year?.id),
      subjects: d.subjects,
      allPeriods: d.periods,
      periods,
      termWord: year?.term_count === 4 ? 'Quarter' : 'Term',
      assignments: d.assignments,
      yearAssignments: d.assignments.filter((a) => a.academic_year_id === year?.id),
      configs: d.configs,
      tables: d.tables,
      members: d.members,
      signatories: d.signatories,
      profile: d.profile,
      memberName,
      levelName: (id) => d.levels.find((l) => l.id === id)?.name ?? '',
      sectionLabel: (id) => {
        const s = d.sections.find((x) => x.id === id)
        if (!s) return ''
        return `${d.levels.find((l) => l.id === s.grade_level_id)?.name ?? ''} - ${s.name}`
      },
      anyUnverified: d.configs.some((c) => !c.is_verified) || d.tables.some((t) => !t.is_verified),
      reload: load,
    }
  }, [state, yearId, user, load])

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>
}

export const useSchool = () => useContext(SchoolContext)

import { createClient } from '@supabase/supabase-js'

// Only the PUBLIC anon/publishable key is used in the browser. Row Level Security protects the data.
// The service-role (secret) key must never be placed in any VITE_ variable or frontend file.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isConfigured = Boolean(url && key && !String(url).includes('YOUR-PROJECT'))

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/** Throw a readable error when a Supabase call returns one. */
export function unwrap({ data, error }) {
  if (error) throw error
  return data
}

/**
 * Supabase returns at most 1000 rows per request. fetchAll pages through a query.
 * @param build  () => a NEW query builder each call (select + filters + a stable order)
 */
export async function fetchAll(build, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

/** Translate common database errors into messages a teacher can act on. */
export function friendlyError(error) {
  if (!error) return 'Something went wrong.'
  const msg = error.message || String(error)
  if (error.code === '23505') {
    if (/lrn/i.test(msg) || /students/.test(msg)) return 'A learner with this LRN already exists for this school year.'
    return 'That record already exists.'
  }
  if (error.code === '23503') return 'This record is still in use by other records, so it cannot be removed. Archive or deactivate it instead.'
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'You do not have permission to do that.'
  }
  if (error.code === '23514' && /weight|check/.test(msg)) return 'A value is outside the allowed range.'
  return msg
}

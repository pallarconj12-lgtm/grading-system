import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext.jsx'
import { friendlyError } from './supabase.js'

/** Run an async loader and track loading / error. Stale responses are ignored. */
export function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null })
  const counter = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    const id = ++counter.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fnRef.current()
      if (id === counter.current) setState({ data, loading: false, error: null })
    } catch (error) {
      if (id === counter.current) setState({ data: null, loading: false, error })
    }
  }, [])

  useEffect(() => {
    if (enabled) run()
    else setState({ data: null, loading: false, error: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  return { ...state, reload: run }
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/** Warn before the tab closes while there is unsaved work. */
export function useBeforeUnload(active) {
  useEffect(() => {
    if (!active) return undefined
    const h = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [active])
}

/** Run an async action with a busy flag; failures become a readable toast, never a silent no-op. */
export function useRunner() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn, successMessage) => {
      setBusy(true)
      try {
        const result = await fn()
        if (successMessage) toast.success(successMessage)
        return { ok: true, result }
      } catch (e) {
        toast.error(friendlyError(e))
        return { ok: false, error: e }
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )
  return { busy, run }
}

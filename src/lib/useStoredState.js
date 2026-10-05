import { useState } from 'react'

/**
 * useState that remembers its value in this browser (e.g. "Show completed").
 * Storage can be unavailable (private mode, blocked site data) — then it
 * silently behaves like plain useState.
 */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  function set(next) {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
      return v
    })
  }
  return [value, set]
}

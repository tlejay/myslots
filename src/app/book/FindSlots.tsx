'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { DURATIONS, HOST_NAME } from '@/lib/config'
import { availabilityText, isWeekendDate, type DayWindows } from '@/lib/availability-text'

// A panel that writes a plain-text summary of free time over a stretch of days,
// ready to paste into a chat: pick a length, a first and last day, and copy.

const CUSTOM_MIN = 15
const CUSTOM_MAX = 480

interface Result {
  key: string
  days: DayWindows[] | null
  error: string | null
}

export function FindSlots({
  initialDuration,
  initialFrom,
  initialTo,
  minDate,
  maxDate,
  onClose,
}: {
  initialDuration: number
  initialFrom: string
  initialTo: string
  minDate: string
  maxDate: string
  onClose: () => void
}) {
  const [preset, setPreset] = useState<number | 'custom'>(initialDuration)
  const [customMinutes, setCustomMinutes] = useState('45')
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [includeWeekends, setIncludeWeekends] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const panelRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLPreElement>(null)

  const rangeKey = `${from}|${to}`
  const loading = !result || result.key !== rangeKey

  // Windows come back unfiltered, so only a new range needs the network —
  // length and weekends are applied to what is already here.
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/availability/windows?from=${from}&to=${to}`, { signal: controller.signal })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Calendar unavailable')
        setResult({ key: rangeKey, days: data.days, error: null })
      })
      .catch(err => {
        if (controller.signal.aborted) return
        setResult({ key: rangeKey, days: null, error: err instanceof Error ? err.message : 'Calendar unavailable' })
      })
    return () => controller.abort()
  }, [from, to, rangeKey])

  // Esc closes, the page behind stops scrolling, and focus starts in the panel.
  // Read through an effect event so a new `onClose` from the parent does not
  // re-run this and yank focus back to the panel mid-typing.
  const close = useEffectEvent(() => onClose())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [])

  const custom = Number(customMinutes)
  const customValid = Number.isInteger(custom) && custom >= CUSTOM_MIN && custom <= CUSTOM_MAX
  const duration = preset === 'custom' ? (customValid ? custom : null) : preset

  const shownDays = result?.days?.filter(d => includeWeekends || !isWeekendDate(d.date)) ?? []
  const onlyWeekends = !loading && result?.days && result.days.length > 0 && shownDays.length === 0

  // Written as the address people will actually type: no scheme, no "www.",
  // no trailing slash.
  const bookingLink = `${window.location.host.replace(/^www\./, '')}${window.location.pathname}`.replace(/\/$/, '')

  const text =
    !loading && result?.days && duration && shownDays.length > 0
      ? availabilityText({ days: result.days, duration, includeWeekends, hostName: HOST_NAME, bookingLink })
      : null

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      // Some browsers refuse clipboard access. Select the text instead, so one
      // keystroke still gets it out.
      const el = textRef.current
      const selection = window.getSelection()
      if (el && selection) {
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      setCopyState('failed')
    }
  }

  const changeFrom = (value: string) => {
    if (!value) return
    setFrom(value)
    // A first day after the last one drags the last day along with it.
    if (value > to) setTo(value)
    setCopyState('idle')
  }

  const changeTo = (value: string) => {
    if (!value) return
    setTo(value)
    if (value < from) setFrom(value)
    setCopyState('idle')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-slots-title"
        tabIndex={-1}
        className="relative w-full min-w-0 sm:max-w-lg max-h-[92dvh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div>
            <h2 id="find-slots-title" className="text-lg font-bold">Find slots</h2>
            <p className="text-xs text-[var(--color-muted-light)] mt-0.5">
              Copy {HOST_NAME}&apos;s free time as text, ready to paste into a chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-9 h-9 -mr-1.5 rounded-full flex items-center justify-center text-[var(--color-muted-light)] hover:text-[var(--color-foreground)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-4 space-y-5">
          {/* Meeting length */}
          <fieldset>
            <legend className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium mb-2">
              Meeting length
            </legend>
            {/* Four across, so Custom sits in the same row as the lengths it replaces */}
            <div className="grid grid-cols-4 gap-2">
              {DURATIONS.map(d => (
                <Chip key={d} active={preset === d} onClick={() => { setPreset(d); setCopyState('idle') }}>
                  {d} min
                </Chip>
              ))}
              <Chip active={preset === 'custom'} onClick={() => { setPreset('custom'); setCopyState('idle') }}>
                Custom
              </Chip>
            </div>
            {preset === 'custom' && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-[var(--color-muted-light)]">Length</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={CUSTOM_MIN}
                  max={CUSTOM_MAX}
                  step={15}
                  value={customMinutes}
                  autoFocus
                  onChange={e => { setCustomMinutes(e.target.value); setCopyState('idle') }}
                  aria-label="Custom meeting length in minutes"
                  className={`w-20 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border text-center tabular-nums focus:outline-none transition-colors ${
                    customValid
                      ? 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
                      : 'border-red-400/60 focus:border-red-400'
                  }`}
                />
                <span className="text-[var(--color-muted-light)]">min</span>
              </label>
            )}
            {preset === 'custom' && !customValid && (
              <p className="mt-1.5 text-xs text-red-400">
                Enter {CUSTOM_MIN}–{CUSTOM_MAX} minutes.
              </p>
            )}
          </fieldset>

          {/* Days */}
          <fieldset>
            <legend className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium mb-2">
              Days
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <DateField label="Start date" value={from} min={minDate} max={maxDate} onChange={changeFrom} />
              <DateField label="End date" value={to} min={minDate} max={maxDate} onChange={changeTo} />
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 cursor-pointer select-none">
              <span className="text-sm">Include weekends</span>
              <button
                type="button"
                role="switch"
                aria-checked={includeWeekends}
                onClick={() => { setIncludeWeekends(v => !v); setCopyState('idle') }}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  includeWeekends ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-muted)]/50'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    includeWeekends ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </label>
          </fieldset>

          {/* Preview */}
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium mb-2">
              Message
            </p>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 min-h-40">
              {loading ? (
                <div className="space-y-2.5" aria-label="Loading availability">
                  {[64, 24, 40, 32, 48, 28].map((w, i) => (
                    <span key={i} className="block h-3 rounded bg-[var(--color-border)] animate-pulse" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : result?.error ? (
                <p className="text-sm text-red-400">Couldn&apos;t read the calendar ({result.error}). Try again in a moment.</p>
              ) : onlyWeekends ? (
                <p className="text-sm text-[var(--color-muted-light)]">
                  These days are all weekend — turn on <span className="font-medium">Include weekends</span> or pick other days.
                </p>
              ) : !duration ? (
                <p className="text-sm text-[var(--color-muted-light)]">Enter a meeting length to see the message.</p>
              ) : (
                <pre ref={textRef} className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                  {text}
                </pre>
              )}
            </div>
          </div>
        </div>

        {/* Sticky footer — the copy button never scrolls out of reach */}
        <div
          className="px-5 pt-3 border-t border-[var(--color-border)]"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
          {copyState === 'failed' && (
            <p className="mb-2 text-xs text-[var(--color-muted-light)]">
              Your browser blocked copying — the message is selected, press ⌘C / Ctrl+C to copy it.
            </p>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={!text}
            className="w-full py-3 rounded-full bg-[var(--color-accent)] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
          >
            {copyState === 'copied' ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Copied
              </>
            ) : (
              'Copy to Clipboard'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap px-2 py-1.5 rounded-full border text-sm font-medium text-center transition-all ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-light)]'
          : 'border-[var(--color-border)] text-[var(--color-muted-light)] hover:border-[var(--color-border-light)]'
      }`}
    >
      {children}
    </button>
  )
}

function DateField({
  label, value, min, max, onChange,
}: {
  label: string
  value: string
  min: string
  max: string
  onChange: (value: string) => void
}) {
  return (
    // min-w-0 all the way down: iOS Safari gives a date input an intrinsic
    // width wider than half a phone, which otherwise spills into the next field.
    <label className="block min-w-0 space-y-1">
      <span className="text-xs text-[var(--color-muted-light)]">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        className="block w-full min-w-0 appearance-none px-3 py-2 min-h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-left [&::-webkit-date-and-time-value]:text-left text-[var(--color-foreground)] tabular-nums focus:outline-none focus:border-[var(--color-accent)] transition-colors"
      />
    </label>
  )
}

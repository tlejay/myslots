'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ThemeToggle } from '../theme-toggle'
import {
  BRAND_NAME,
  DEFAULT_DURATION,
  DURATIONS,
  Duration,
  HOST_NAME,
  MAX_DAYS_AHEAD,
  RANGE_DAYS,
  TIME_ZONE,
  TIME_ZONE_LABEL,
  UTC_OFFSET,
  workingHoursLabel,
} from '@/lib/config'

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotReason = 'available' | 'busy' | 'past'
interface SlotInfo { iso: string; display: string; reason: SlotReason }
type DaySlots = SlotInfo[]              // ordered by time
type RangeData = Map<string, DaySlots>  // dateKey → slots

interface SelectedSlot { iso: string; dateKey: string }

interface FormData {
  name: string
  email: string
  topic: string
}

type Step = 'pick' | 'details' | 'confirmed'

// Mirrors the check the booking endpoint runs; the server stays the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MAX_GUESTS = 10

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // indexed by getDay()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

function fmtRangeHeader(from: Date): string {
  const to = addDays(from, RANGE_DAYS - 1)
  if (from.getMonth() === to.getMonth()) {
    return `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${to.getDate()}, ${to.getFullYear()}`
  }
  return `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${to.getFullYear()}`
}

function fmtLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function fmtSlotEnd(iso: string, durationMin: number): string {
  return fmtSlot(new Date(new Date(iso).getTime() + durationMin * 60 * 1000).toISOString())
}

function rangeKeys(from: Date): string[] {
  return Array.from({ length: RANGE_DAYS }, (_, i) => toDateKey(addDays(from, i)))
}

function countAvailable(slots: DaySlots | undefined): number {
  return slots ? slots.filter(s => s.reason === 'available').length : 0
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow() {
  const [today] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })

  const [step, setStep] = useState<Step>('pick')
  // The strip starts at today — nobody books backwards.
  const [rangeStart, setRangeStart] = useState<Date>(() => startOfDay(new Date()))
  const [duration, setDuration] = useState<Duration>(DEFAULT_DURATION)
  const [rangeData, setRangeData] = useState<RangeData>(new Map())
  const [loadingDays, setLoadingDays] = useState<Set<string>>(
    () => new Set(rangeKeys(startOfDay(new Date())))
  )
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null)
  const [form, setForm] = useState<FormData>({ name: '', email: '', topic: '' })
  // Empty until someone asks for a guest field — the row only exists on request.
  const [guests, setGuests] = useState<string[]>([])
  // Remembers how many tiles the grid last held, so the loading skeleton keeps
  // the card at the same height instead of collapsing between fetches.
  const [skeletonCount, setSkeletonCount] = useState(12)
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  const fetchVersion = useRef(0)

  const loadRange = useCallback(async (from: Date, dur: Duration) => {
    const version = ++fetchVersion.current
    const keys = rangeKeys(from)

    setLoadingDays(new Set(keys))
    setRangeData(new Map())
    setSelectedSlot(null)

    await Promise.allSettled(
      keys.map(async (k) => {
        try {
          const res = await fetch(`/api/availability?date=${k}&duration=${dur}`)
          const data = await res.json()
          if (version !== fetchVersion.current) return
          setRangeData(prev => {
            const next = new Map(prev)
            const daySlots: DaySlots = ((data.slots ?? []) as { start: string; display: string; reason: SlotReason }[])
              .map(s => ({ iso: s.start, display: s.display, reason: s.reason }))
            next.set(k, daySlots)
            return next
          })
        } catch {
          if (version !== fetchVersion.current) return
          setRangeData(prev => { const next = new Map(prev); next.set(k, []); return next })
        } finally {
          if (version === fetchVersion.current) {
            setLoadingDays(prev => { const next = new Set(prev); next.delete(k); return next })
          }
        }
      })
    )
  }, [])

  useEffect(() => { loadRange(rangeStart, duration) }, [rangeStart, duration, loadRange])

  // Once the range has loaded, land on a day that actually has openings so the
  // time list is never empty on arrival.
  useEffect(() => {
    if (loadingDays.size > 0) return
    const keys = rangeKeys(rangeStart)
    setSelectedDay(prev => {
      if (prev && keys.includes(prev) && countAvailable(rangeData.get(prev)) > 0) return prev
      return keys.find(k => countAvailable(rangeData.get(k)) > 0) ?? null
    })
  }, [loadingDays, rangeData, rangeStart])

  useEffect(() => {
    if (loadingDays.size > 0 || !selectedDay) return
    const n = countAvailable(rangeData.get(selectedDay))
    if (n > 0) setSkeletonCount(n)
  }, [loadingDays, rangeData, selectedDay])

  // Blank rows are ignored; duplicates and the booker's own address are dropped
  // so nobody receives the invite twice.
  const cleanGuests = Array.from(
    new Set(
      guests
        .map(g => g.trim().toLowerCase())
        .filter(g => g && g !== form.email.trim().toLowerCase())
    )
  )
  const guestsValid = guests.every(g => !g.trim() || EMAIL_RE.test(g.trim()))

  const handleBook = async () => {
    if (!selectedSlot || !form.name.trim() || !form.email.trim() || !guestsValid) return
    setBooking(true)
    setBookError(null)
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTime: selectedSlot.iso, duration, ...form, guests: cleanGuests }),
      })
      if (!res.ok) throw new Error()
      setStep('confirmed')
    } catch {
      setBookError('Booking failed. The slot may already be taken — please try another time.')
    } finally {
      setBooking(false)
    }
  }

  // ─── Confirmed ───────────────────────────────────────────────────────────────

  if (step === 'confirmed' && selectedSlot) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
          <div className="max-w-md w-full text-center space-y-8">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto border border-emerald-500/20">
              <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">You&apos;re booked!</h1>
              <p className="text-[var(--color-muted-light)]">
                A calendar invite has been sent to{' '}
                <span className="text-[var(--color-foreground)]">{form.email}</span>
              </p>
            </div>
            <div className="text-left rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6 space-y-3">
              <DetailRow label="With" value={HOST_NAME} />
              <DetailRow label="Date" value={fmtLong(selectedSlot.iso)} />
              <DetailRow label="Time" value={`${fmtSlot(selectedSlot.iso)} (${TIME_ZONE_LABEL})`} />
              <DetailRow label="Duration" value={`${duration} minutes`} />
              {form.topic && <DetailRow label="Topic" value={form.topic} />}
              {cleanGuests.length > 0 && (
                <DetailRow
                  label={cleanGuests.length === 1 ? 'Guest' : 'Guests'}
                  value={cleanGuests.join(', ')}
                />
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="inline-block text-sm text-[var(--color-muted-light)] hover:text-[var(--color-foreground)] transition-colors"
            >
              ← Book another meeting
            </button>
          </div>
        </div>
      </PageShell>
    )
  }

  // ─── Details ─────────────────────────────────────────────────────────────────

  if (step === 'details' && selectedSlot) {
    return (
      <PageShell>
        <div className="max-w-md mx-auto px-6 py-12 space-y-8">
          <button
            onClick={() => setStep('pick')}
            className="flex items-center gap-1.5 text-sm text-[var(--color-muted-light)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m7-7-7 7 7 7" />
            </svg>
            Back
          </button>

          <div>
            <h1 className="text-2xl font-bold mb-1">Complete your booking</h1>
            <p className="text-sm text-[var(--color-muted-light)]">
              {fmtLong(selectedSlot.iso)} · {fmtSlot(selectedSlot.iso)} {TIME_ZONE_LABEL} · {duration} min
            </p>
          </div>

          <div className="space-y-4">
            <FormField label="Your Nickname" required>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="John"
                className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </FormField>
            <FormField label="Your Email" required>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </FormField>

            {guests.length > 0 && (
              <FormField label={guests.length === 1 ? 'Guest' : 'Guests'}>
                <div className="space-y-2">
                  {guests.map((guest, i) => {
                    const invalid = Boolean(guest.trim()) && !EMAIL_RE.test(guest.trim())
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="email"
                          value={guest}
                          autoFocus={i === guests.length - 1}
                          onChange={e =>
                            setGuests(g => g.map((v, j) => (j === i ? e.target.value : v)))
                          }
                          placeholder="guest@example.com"
                          className={`flex-1 min-w-0 px-4 py-3 rounded-xl bg-[var(--color-surface)] border text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none transition-colors ${
                            invalid
                              ? 'border-red-400/60 focus:border-red-400'
                              : 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setGuests(g => g.filter((_, j) => j !== i))}
                          aria-label={`Remove guest ${i + 1}`}
                          className="shrink-0 w-11 h-11 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border-light)] flex items-center justify-center transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </FormField>
            )}

            {guests.length < MAX_GUESTS && (
              <button
                type="button"
                onClick={() => setGuests(g => [...g, ''])}
                className="flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:opacity-80 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                Add guest
              </button>
            )}
            <FormField label="What would you like to discuss?">
              <input
                type="text"
                value={form.topic}
                onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                placeholder="e.g. Product consulting, Tech advice..."
                className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </FormField>
          </div>

          {bookError && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
              {bookError}
            </p>
          )}

          <button
            onClick={handleBook}
            disabled={booking || !form.name.trim() || !form.email.trim() || !guestsValid}
            className="w-full py-3.5 rounded-full bg-[var(--color-accent)] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {booking ? 'Booking...' : 'Confirm Booking →'}
          </button>

          <p className="text-xs text-center text-[var(--color-muted)]">
            A Google Calendar invite will be sent to {HOST_NAME}, you{cleanGuests.length > 0 &&
              ` and ${cleanGuests.length} guest${cleanGuests.length === 1 ? '' : 's'}`}.
          </p>
        </div>
      </PageShell>
    )
  }

  // ─── Pick: day strip → time list ──────────────────────────────────────────────

  const rangeDays = Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i))
  const rangeLoading = loadingDays.size > 0
  const atToday = toDateKey(rangeStart) === toDateKey(today)
  const nextDisabled = rangeStart >= addDays(today, MAX_DAYS_AHEAD - RANGE_DAYS)

  const daySlots = selectedDay ? rangeData.get(selectedDay) ?? [] : []
  const openSlots = daySlots.filter(s => s.reason === 'available')
  const rangeTotal = rangeDays.reduce((sum, d) => sum + countAvailable(rangeData.get(toDateKey(d))), 0)

  return (
    <PageShell>
      <div className={`max-w-3xl mx-auto px-4 sm:px-6 py-8 ${selectedSlot ? 'pb-32' : ''}`}>

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">Book a Meeting</h1>
          <p className="text-sm text-[var(--color-muted-light)]">
            Schedule a call with {HOST_NAME} · {workingHoursLabel()}
          </p>
        </div>

        {/* Step 1 — pick a day */}
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium">
            1 · Pick a day
          </p>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setRangeStart(startOfDay(new Date()))}
              disabled={atToday}
              className={`px-3 py-1 rounded-full border text-xs font-semibold transition-all ${
                atToday
                  ? 'border-[var(--color-border)] text-[var(--color-muted)] opacity-40 cursor-not-allowed'
                  : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 cursor-pointer'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setRangeStart(d => {
                const back = addDays(d, -RANGE_DAYS)
                return back < today ? startOfDay(today) : back
              })}
              disabled={atToday}
              aria-label="Earlier days"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-muted-light)] hover:text-[var(--color-foreground)] hover:bg-[var(--hover-bg)] disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold min-w-[152px] text-center tabular-nums">
              {fmtRangeHeader(rangeStart)}
            </span>
            <button
              onClick={() => setRangeStart(d => addDays(d, RANGE_DAYS))}
              disabled={nextDisabled}
              aria-label="Later days"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-muted-light)] hover:text-[var(--color-foreground)] hover:bg-[var(--hover-bg)] disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {rangeDays.map((day) => {
            const key = toDateKey(day)
            const isToday = key === toDateKey(today)
            const loading = loadingDays.has(key)
            const count = countAvailable(rangeData.get(key))
            const isSelected = key === selectedDay
            const disabled = loading || count === 0

            return (
              <button
                key={key}
                onClick={() => { setSelectedDay(key); setSelectedSlot(null) }}
                disabled={disabled}
                className={`rounded-xl border py-2.5 px-1 text-center transition-all ${
                  isSelected
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : disabled
                      ? 'border-[var(--color-border)] opacity-45 cursor-not-allowed'
                      : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--hover-bg)] cursor-pointer'
                }`}
              >
                <div className={`text-[10px] uppercase tracking-widest font-medium ${
                  isToday ? 'text-[var(--color-accent-light)]' : 'text-[var(--color-muted)]'
                }`}>
                  {isToday ? 'Today' : DAY_ABBR[day.getDay()]}
                </div>
                <div className={`text-lg sm:text-xl font-bold leading-tight tabular-nums ${
                  isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-foreground)]'
                }`}>
                  {day.getDate()}
                </div>
                <div className="mt-1 text-[10px] sm:text-[11px] leading-tight">
                  {loading ? (
                    <span className="inline-block w-8 h-2.5 rounded-full bg-[var(--color-border)] animate-pulse" />
                  ) : count > 0 ? (
                    <span className="text-emerald-500 font-semibold tabular-nums">
                      {count}<span className="hidden sm:inline"> free</span>
                    </span>
                  ) : (
                    <span className="text-[var(--color-muted)]">—</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Always rendered so switching meeting length never collapses this row */}
        <p className="mt-2 px-1 text-xs text-[var(--color-muted)]">
          {rangeLoading ? (
            <Bar className="h-3 w-44" />
          ) : rangeTotal > 0 ? (
            `${rangeTotal} slot${rangeTotal === 1 ? '' : 's'} open in these ${RANGE_DAYS} days`
          ) : (
            `No openings in these ${RANGE_DAYS} days`
          )}
        </p>

        {/* Step 2 — pick a time */}
        <div className="mt-6">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium mb-2">
            2 · Pick a time
          </p>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">

            {/* Meeting length lives with the times it produces */}
            <div className="flex flex-wrap items-center gap-2 pb-4 mb-4 border-b border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-muted)] mr-1">Meeting length</span>
              {DURATIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`px-4 py-1.5 rounded-full border text-sm font-medium transition-all ${
                    duration === d
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-light)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted-light)] hover:border-[var(--color-border-light)]'
                  }`}
                >
                  {d} min
                </button>
              ))}
            </div>

            {rangeLoading ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
                  <p className="text-sm font-semibold"><Bar className="h-3.5 w-44" /></p>
                  <p className="text-xs text-[var(--color-muted)]"><Bar className="h-3 w-24" /></p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {Array.from({ length: skeletonCount }, (_, i) => (
                    <div key={i} className="px-3 py-2 rounded-xl border border-[var(--color-border)] text-center">
                      <span className="inline-flex flex-col items-end">
                        <span className="text-base leading-snug"><Bar className="h-3.5 w-11" /></span>
                        <span className="text-[10px] leading-snug"><Bar className="h-2 w-11" /></span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : !selectedDay ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-[var(--color-muted-light)]">
                  No {duration}-minute openings in these 7 days.
                </p>
                {!nextDisabled && (
                  <button
                    onClick={() => setRangeStart(d => addDays(d, RANGE_DAYS))}
                    className="text-sm font-semibold text-[var(--color-accent)] hover:underline"
                  >
                    Check the next 7 days →
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
                  <p className="text-sm font-semibold">
                    {fmtLong(daySlots[0]?.iso ?? new Date(`${selectedDay}T12:00:00${UTC_OFFSET}`).toISOString())}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {openSlots.length} slot{openSlots.length === 1 ? '' : 's'} available
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {openSlots.map(slot => {
                    const isSelected = selectedSlot?.iso === slot.iso
                    return (
                      <button
                        key={slot.iso}
                        onClick={() => setSelectedSlot(isSelected ? null : { iso: slot.iso, dateKey: selectedDay })}
                        className={`px-3 py-2 rounded-xl border text-center transition-all ${
                          isSelected
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                            : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
                        }`}
                      >
                        <SlotTime
                          start={slot.display}
                          end={fmtSlotEnd(slot.iso, duration)}
                          selected={isSelected}
                        />
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sticky confirm bar — the choice stays reachable without scrolling */}
      {selectedSlot && (
        <div
          className="fixed bottom-0 inset-x-0 z-50 backdrop-blur-md"
          style={{ background: 'var(--nav-bg)', borderTop: '1px solid var(--nav-border)' }}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">
                {fmtLong(selectedSlot.iso)}
              </p>
              <p className="text-xs text-[var(--color-muted-light)] mt-0.5 tabular-nums">
                {fmtSlot(selectedSlot.iso)} – {fmtSlotEnd(selectedSlot.iso, duration)} {TIME_ZONE_LABEL} · {duration} min
              </p>
            </div>
            <button
              onClick={() => setStep('details')}
              className="shrink-0 px-6 py-2.5 rounded-full bg-[var(--color-accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}

function Bar({ className }: { className: string }) {
  return (
    <span
      className={`inline-block align-middle rounded bg-[var(--color-border)] animate-pulse ${className}`}
    />
  )
}

// The start time is what people scan for; the end time trails underneath it,
// smaller and quieter, right-aligned so the pair reads as one block.
function SlotTime({ start, end, selected }: { start: string; end: string; selected: boolean }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className="text-base font-semibold tabular-nums leading-snug">{start}</span>
      <span className={`text-[10px] tabular-nums leading-snug ${selected ? 'text-white/60' : 'text-[var(--color-muted)]'}`}>
        To {end}
      </span>
    </span>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav
        className="fixed top-0 inset-x-0 z-50 backdrop-blur-md"
        style={{ background: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-semibold">{BRAND_NAME}</span>
          <ThemeToggle />
        </div>
      </nav>
      <main className="pt-14">{children}</main>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-[var(--color-muted-light)] shrink-0">{label}</span>
      <span className="text-[var(--color-foreground)] text-right">{value}</span>
    </div>
  )
}

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-[var(--color-muted-light)]">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

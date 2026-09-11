'use client'

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { ThemeToggle } from '../theme-toggle'
import { FindSlots } from './FindSlots'
import {
  ADD_GOOGLE_MEET,
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

interface Booked {
  iso: string
  duration: Duration
  meetLink: string | null
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

function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`)
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

// ─── Shareable link ───────────────────────────────────────────────────────────
// The picker keeps its whole state in the query string — /book?date=2026-09-10
// &duration=60&time=14:00 — so any view can be copied and sent to someone else
// without a route having to exist for it.

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_PARAM_RE = /^\d{2}:\d{2}$/

interface UrlState {
  dateKey: string | null
  duration: Duration | null
  time: string | null
}

const NO_LINK: UrlState = { dateKey: null, duration: null, time: null }

function readUrlState(search: string, today: Date): UrlState {
  const params = new URLSearchParams(search)

  const rawDate = params.get('date') ?? ''
  const day = DATE_PARAM_RE.test(rawDate) ? fromDateKey(rawDate) : null
  // A link to a day that has already passed — or is past the booking horizon —
  // drops back to the default view rather than showing an empty strip.
  const dateKey =
    day && !Number.isNaN(day.getTime()) && day >= today && day <= addDays(today, MAX_DAYS_AHEAD - 1)
      ? toDateKey(day)
      : null

  const rawDuration = Number(params.get('duration'))
  const duration = (DURATIONS as readonly number[]).includes(rawDuration)
    ? (rawDuration as Duration)
    : null

  const rawTime = params.get('time') ?? ''

  return { dateKey, duration, time: dateKey && TIME_PARAM_RE.test(rawTime) ? rawTime : null }
}

// Written by hand rather than through URLSearchParams so the colon in the time
// stays a colon — a link people are meant to read and paste should look like
// one. Every value here is produced by the picker, so none of it needs escaping.
function buildUrl(dateKey: string, duration: Duration, time: string | null): string {
  const query = `date=${dateKey}&duration=${duration}${time ? `&time=${time}` : ''}`
  return `${window.location.pathname}?${query}`
}

// ─── Hydration ────────────────────────────────────────────────────────────────
// The page is prerendered, so the server knows neither the visitor's today nor
// their link. Until hydration is done the picker renders a date-free skeleton;
// from then on the client's own values drive it. False on the server and during
// hydration, true on every render after.

const subscribeToNothing = () => () => {}

function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow() {
  const hydrated = useHydrated()

  // Both read once. On the client they are read during the hydration render —
  // which is safe, because nothing derived from them is drawn until `hydrated`.
  const [today] = useState(() => startOfDay(new Date()))
  const [linked] = useState<UrlState>(() =>
    typeof window === 'undefined' ? NO_LINK : readUrlState(window.location.search, startOfDay(new Date()))
  )

  // What the visitor has chosen. `null` means "not yet" — the view falls back to
  // the link, then to the default. Picker state below is derived from these
  // during render rather than settled in effects once data lands.
  const [rangeChoice, setRangeChoice] = useState<Date | null>(null)
  const [durationChoice, setDurationChoice] = useState<Duration | null>(null)
  const [dayChoice, setDayChoice] = useState<string | null>(null)
  // `undefined` until the visitor touches anything, so a time named by the link
  // still applies; `null` once it has been cleared.
  const [slotChoice, setSlotChoice] = useState<SelectedSlot | null | undefined>(undefined)

  // Availability per `${duration}:${dateKey}`. A key that is absent is loading;
  // a week already seen comes back instantly.
  const [cache, setCache] = useState<Map<string, DaySlots>>(() => new Map())
  const inFlight = useRef(new Set<string>())

  const [step, setStep] = useState<Step>('pick')
  const [form, setForm] = useState<FormData>({ name: '', email: '', topic: '' })
  // Empty until someone asks for a guest field — the row only exists on request.
  const [guests, setGuests] = useState<string[]>([])
  // Remembers how many tiles the grid last held, so the loading skeleton keeps
  // the card at the same height instead of collapsing between fetches.
  const [skeletonCount, setSkeletonCount] = useState(12)
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const [slotTaken, setSlotTaken] = useState(false)
  const [booked, setBooked] = useState<Booked | null>(null)
  const [findOpen, setFindOpen] = useState(false)

  // ─── Derived picker state ────────────────────────────────────────────────────

  const duration = durationChoice ?? linked.duration ?? DEFAULT_DURATION
  // The strip starts at today — nobody books backwards — or on the day a
  // shared link names, so it is the first tile people see.
  const rangeStart = rangeChoice ?? (linked.dateKey ? fromDateKey(linked.dateKey) : today)
  const rangeStartKey = toDateKey(rangeStart)
  const keys = rangeKeys(rangeStart)

  const rangeData: RangeData = new Map()
  const loadingDays = new Set<string>()
  for (const k of keys) {
    const slots = cache.get(`${duration}:${k}`)
    if (slots) rangeData.set(k, slots)
    else loadingDays.add(k)
  }
  const rangeLoading = loadingDays.size > 0

  // Land on a day that actually has openings, so the time list is never empty
  // on arrival: the day picked (or linked) if it has any, else the first that does.
  const preferredDay = dayChoice ?? linked.dateKey
  const preferredInRange = preferredDay !== null && keys.includes(preferredDay)
  const selectedDay = rangeLoading
    ? (preferredInRange ? preferredDay : null)
    : preferredInRange && countAvailable(rangeData.get(preferredDay)) > 0
      ? preferredDay
      : keys.find(k => countAvailable(rangeData.get(k)) > 0) ?? null

  // A shared link can name a time too; it is selected once that day's slots
  // are in. If the slot was taken in the meantime the day still opens, just with
  // nothing selected.
  const linkedSlot = ((): SelectedSlot | null => {
    if (!linked.dateKey || !linked.time) return null
    const slot = rangeData.get(linked.dateKey)?.find(s => s.reason === 'available' && s.display === linked.time)
    return slot ? { iso: slot.iso, dateKey: linked.dateKey } : null
  })()
  const slotCandidate = slotChoice === undefined ? linkedSlot : slotChoice
  const selectedSlot =
    slotCandidate &&
    !rangeLoading &&
    slotCandidate.dateKey === selectedDay &&
    rangeData.get(selectedDay)?.some(s => s.iso === slotCandidate.iso && s.reason === 'available')
      ? slotCandidate
      : null

  const openCount = !rangeLoading && selectedDay ? countAvailable(rangeData.get(selectedDay)) : 0
  if (openCount > 0 && openCount !== skeletonCount) setSkeletonCount(openCount)

  // ─── Effects: only the outside world ─────────────────────────────────────────

  // Fetch whatever the visible week is missing. Results land in the cache; the
  // view above re-derives from it.
  useEffect(() => {
    if (!hydrated) return
    for (const k of rangeKeys(fromDateKey(rangeStartKey))) {
      const key = `${duration}:${k}`
      if (cache.has(key) || inFlight.current.has(key)) continue
      inFlight.current.add(key)
      fetch(`/api/availability?date=${k}&duration=${duration}`)
        .then(res => res.json())
        .then(data =>
          ((data.slots ?? []) as { start: string; display: string; reason: SlotReason }[])
            .map((s): SlotInfo => ({ iso: s.start, display: s.display, reason: s.reason }))
        )
        .catch((): DaySlots => [])
        .then(daySlots => {
          inFlight.current.delete(key)
          setCache(prev => new Map(prev).set(key, daySlots))
        })
    }
  }, [hydrated, rangeStartKey, duration, cache])

  // Keep the address bar in step with the picker so whatever is on screen is
  // always the thing that gets copied. Nothing is written while the week is
  // loading — that is the moment a linked time has not been applied yet.
  // replaceState keeps the back button pointing at wherever the visitor came
  // from instead of at every tile they tried.
  const selectedIso = selectedSlot?.iso ?? null
  useEffect(() => {
    if (!hydrated || rangeLoading || !selectedDay) return
    window.history.replaceState(
      null, '',
      buildUrl(selectedDay, duration, selectedIso ? fmtSlot(selectedIso) : null),
    )
  }, [hydrated, rangeLoading, selectedDay, duration, selectedIso])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const goToRange = (from: Date) => {
    setRangeChoice(from)
    setSlotChoice(null)
  }

  const pickDay = (key: string) => {
    setDayChoice(key)
    setSlotChoice(null)
    setSlotTaken(false)
  }

  const pickDuration = (d: Duration) => {
    setDurationChoice(d)
    setSlotChoice(null)
  }

  /** Drops what is known about a day, so the next render fetches it afresh. */
  const forgetDay = (dateKey: string) => {
    setCache(prev => {
      const next = new Map(prev)
      for (const d of DURATIONS) next.delete(`${d}:${dateKey}`)
      return next
    })
  }

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
      const data = await res.json().catch(() => ({}))

      if (res.status === 409) {
        // Someone else got there first. Back to the times, refreshed, with the
        // form kept as typed so picking again costs one tap.
        forgetDay(selectedSlot.dateKey)
        setSlotChoice(null)
        setSlotTaken(true)
        setStep('pick')
        return
      }
      if (res.status === 400 && typeof data.error === 'string') {
        setBookError(`${data.error}. Please check and try again.`)
        return
      }
      if (!res.ok) throw new Error()

      setBooked({ iso: selectedSlot.iso, duration, meetLink: data.meetLink ?? null })
      setStep('confirmed')
    } catch {
      setBookError(`Something went wrong on our side, and nothing was booked. Please try again in a moment.`)
    } finally {
      setBooking(false)
    }
  }

  // ─── Confirmed ───────────────────────────────────────────────────────────────

  if (step === 'confirmed' && booked) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-12">
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
              <DetailRow label="Date" value={fmtLong(booked.iso)} />
              <DetailRow label="Time" value={`${fmtSlot(booked.iso)} – ${fmtSlotEnd(booked.iso, booked.duration)} (${TIME_ZONE_LABEL})`} />
              <DetailRow label="Duration" value={`${booked.duration} minutes`} />
              {form.topic && <DetailRow label="Topic" value={form.topic} />}
              {cleanGuests.length > 0 && (
                <DetailRow
                  label={cleanGuests.length === 1 ? 'Guest' : 'Guests'}
                  value={cleanGuests.join(', ')}
                />
              )}
            </div>
            {booked.meetLink && (
              <div className="space-y-2">
                <a
                  href={booked.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-full bg-[var(--color-accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  <VideoIcon className="w-4 h-4" />
                  Google Meet link
                </a>
                <p className="text-xs text-[var(--color-muted)] break-all">
                  {booked.meetLink.replace(/^https?:\/\//, '')} · also in the invite
                </p>
              </div>
            )}
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
            A Google Calendar invite{ADD_GOOGLE_MEET && ' with a Google Meet link'} will be sent to {HOST_NAME}, you{cleanGuests.length > 0 &&
              ` and ${cleanGuests.length} guest${cleanGuests.length === 1 ? '' : 's'}`}.
          </p>
        </div>
      </PageShell>
    )
  }

  // ─── Pick: day strip → time list ──────────────────────────────────────────────

  if (!hydrated) {
    return (
      <PageShell>
        <PickSkeleton />
      </PageShell>
    )
  }

  const rangeDays = keys.map(fromDateKey)
  const atToday = rangeStartKey === toDateKey(today)
  const nextDisabled = rangeStart >= addDays(today, MAX_DAYS_AHEAD - RANGE_DAYS)

  // "Today" is the way back to now, so it wakes up as soon as the view leaves
  // today — moving to another day counts, not just another week. When today has
  // no openings it can't be landed on at all, so the button stays asleep.
  const todayKey = toDateKey(today)
  const todayOpen = countAvailable(rangeData.get(todayKey)) > 0
  const atTodayView = atToday && (!todayOpen || selectedDay === todayKey)

  const daySlots = selectedDay ? rangeData.get(selectedDay) ?? [] : []
  const openSlots = daySlots.filter(s => s.reason === 'available')
  const rangeTotal = keys.reduce((sum, k) => sum + countAvailable(rangeData.get(k)), 0)

  return (
    <PageShell>
      <div className={`max-w-3xl mx-auto px-4 sm:px-6 py-8 ${selectedSlot ? 'pb-44' : ''}`}>

        <PageHeader onFindSlots={() => setFindOpen(true)} />

        {/* Step 1 — pick a day */}
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium">
            1 · Pick a day
          </p>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => {
                if (!atToday) setRangeChoice(today)
                pickDay(todayKey)
              }}
              disabled={atTodayView}
              className={`px-3 py-1 rounded-full border text-xs font-semibold transition-all ${
                atTodayView
                  ? 'border-[var(--color-border)] text-[var(--color-muted)] opacity-40 cursor-not-allowed'
                  : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 cursor-pointer'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                const back = addDays(rangeStart, -RANGE_DAYS)
                goToRange(back < today ? today : back)
              }}
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
              onClick={() => goToRange(addDays(rangeStart, RANGE_DAYS))}
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
            const isToday = key === todayKey
            const loading = loadingDays.has(key)
            const count = countAvailable(rangeData.get(key))
            const isSelected = key === selectedDay
            const disabled = loading || count === 0

            return (
              <button
                key={key}
                onClick={() => pickDay(key)}
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

          {slotTaken && (
            <p className="mb-3 text-sm text-[var(--color-foreground)] bg-amber-400/15 border border-amber-400/40 rounded-xl px-4 py-3">
              That time was just booked by someone else. The times below are up to date — please pick another.
            </p>
          )}

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">

            {/* Meeting length lives with the times it produces — the three
                durations say what they are, so no label crowds them onto a
                second line on a phone. */}
            <div className="flex items-center gap-2 pb-4 mb-4 border-b border-[var(--color-border)]">
              {DURATIONS.map(d => (
                <button
                  key={d}
                  onClick={() => pickDuration(d)}
                  className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full border text-sm font-medium transition-all ${
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
                <SlotGridSkeleton count={skeletonCount} />
              </>
            ) : !selectedDay ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-[var(--color-muted-light)]">
                  No {duration}-minute openings in these 7 days.
                </p>
                {!nextDisabled && (
                  <button
                    onClick={() => goToRange(addDays(rangeStart, RANGE_DAYS))}
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
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-[var(--color-muted)]">
                      {openSlots.length} slot{openSlots.length === 1 ? '' : 's'} available
                    </p>
                    <CopyLinkButton />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {openSlots.map(slot => {
                    const isSelected = selectedSlot?.iso === slot.iso
                    return (
                      <button
                        key={slot.iso}
                        onClick={() => {
                          setSlotChoice(isSelected ? null : { iso: slot.iso, dateKey: selectedDay })
                          setSlotTaken(false)
                        }}
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
          {/* Extra bottom padding keeps the two lines clear of the phone's own
              home indicator instead of ending flush with the device edge. */}
          <div
            className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 flex items-center gap-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">
                {fmtLong(selectedSlot.iso)}
              </p>
              <p className="text-xs text-[var(--color-muted-light)] mt-0.5 tabular-nums">
                {fmtSlot(selectedSlot.iso)} – {fmtSlotEnd(selectedSlot.iso, duration)} {TIME_ZONE_LABEL} · {duration} min
              </p>
            </div>
            <button
              onClick={() => { setBookError(null); setStep('details') }}
              className="shrink-0 px-6 py-2.5 rounded-full bg-[var(--color-accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {findOpen && (
        <FindSlots
          initialDuration={duration}
          initialFrom={rangeStartKey}
          initialTo={keys[keys.length - 1]}
          minDate={todayKey}
          maxDate={toDateKey(addDays(today, MAX_DAYS_AHEAD - 1))}
          onClose={() => setFindOpen(false)}
        />
      )}
    </PageShell>
  )
}

// ─── Pieces of the pick step ──────────────────────────────────────────────────

function PageHeader({ onFindSlots }: { onFindSlots?: () => void }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">Book a Meeting</h1>
        <p className="text-sm text-[var(--color-muted-light)]">
          Schedule a call with {HOST_NAME} · {workingHoursLabel()}
        </p>
      </div>
      {/* Disabled until hydration, but drawn from the start so nothing shifts */}
      <button
        type="button"
        onClick={onFindSlots}
        disabled={!onFindSlots}
        className="shrink-0 mt-1 flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[var(--color-border)] text-sm font-medium text-[var(--color-foreground)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Find slots
      </button>
    </div>
  )
}

/** What the server renders: the page's shape with no dates in it. */
function PickSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8" aria-busy="true">
      <PageHeader />
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium">
          1 · Pick a day
        </p>
        <div className="flex items-center gap-2 ml-auto h-8">
          <Bar className="h-4 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {Array.from({ length: RANGE_DAYS }, (_, i) => (
          <div key={i} className="rounded-xl border border-[var(--color-border)] py-2.5 px-1 flex flex-col items-center gap-1.5">
            <Bar className="h-2.5 w-6" />
            <Bar className="h-5 w-5" />
            <Bar className="h-2.5 w-8" />
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs"><Bar className="h-3 w-44" /></p>
      <div className="mt-6">
        <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] font-medium mb-2">
          2 · Pick a time
        </p>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
          <div className="flex items-center gap-2 pb-4 mb-4 border-b border-[var(--color-border)]">
            {DURATIONS.map(d => (
              <span key={d} className="shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full border border-[var(--color-border)] text-sm font-medium text-[var(--color-muted-light)]">
                {d} min
              </span>
            ))}
          </div>
          <div className="mb-3"><Bar className="h-3.5 w-44" /></div>
          <SlotGridSkeleton count={12} />
        </div>
      </div>
    </div>
  )
}

function SlotGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="px-3 py-2 rounded-xl border border-[var(--color-border)] text-center">
          <span className="inline-flex flex-col items-end">
            <span className="text-base leading-snug"><Bar className="h-3.5 w-11" /></span>
            <span className="text-[10px] leading-snug"><Bar className="h-2 w-11" /></span>
          </span>
        </div>
      ))}
    </div>
  )
}

// Copies whatever the address bar currently holds — the day, the length and the
// time, if one is picked — so the link lands the next person on this exact view.
// time, if one is picked — so the link lands the next person on this exact view.
function CopyLinkButton() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused (older browsers, insecure origins);
      // the address bar still holds the link, so there is nothing to recover.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          Copy link
        </>
      )}
    </button>
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

function VideoIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

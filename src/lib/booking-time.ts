import {
  MAX_DAYS_AHEAD,
  SLOT_STEP_MINUTES,
  TIME_ZONE,
  UTC_OFFSET,
  hoursFor,
} from './config'

// Wall-clock arithmetic for the booking calendar. Everything here works in the
// host's zone, on `YYYY-MM-DD` date keys and minutes since local midnight, so
// no caller has to reason about the server's own clock.

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface Interval {
  start: Date
  end: Date
}

/** A free stretch of the day, as local wall-clock times: `{ start: '10:30', end: '13:00' }`. */
export interface FreeWindow {
  start: string
  end: string
}

export function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
}

export function addDaysToKey(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The instant a local wall-clock time on `dateKey` happens. */
export function localInstant(dateKey: string, minutes: number): Date {
  return new Date(`${dateKey}T${hhmm(minutes)}:00${UTC_OFFSET}`)
}

const PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** Where an instant falls on the host's calendar. */
export function localParts(date: Date): { dateKey: string; minutes: number; seconds: number } {
  const p = Object.fromEntries(PARTS_FMT.formatToParts(date).map(x => [x.type, x.value]))
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
  }
}

/** Today in the host's zone, and the last day people may book. */
export function bookingHorizon(now = new Date()): { first: string; last: string } {
  const first = localParts(now).dateKey
  return { first, last: addDaysToKey(first, MAX_DAYS_AHEAD - 1) }
}

/** Opening and closing time of `dateKey`, in minutes since local midnight. */
export function openingMinutes(dateKey: string): { open: number; close: number } {
  const { start, end } = hoursFor(dayOfWeek(dateKey))
  return { open: start * 60, close: end * 60 }
}

/**
 * The stretches of `dateKey` inside working hours that no busy block touches,
 * with anything already in the past cut off. Edges are snapped inward onto the
 * slot grid, so every window starts and ends on a time the booking page offers.
 */
export function freeWindows(dateKey: string, busy: Interval[], now = new Date()): FreeWindow[] {
  const { open, close } = openingMinutes(dateKey)
  const midnight = localInstant(dateKey, 0).getTime()
  const toMinutes = (d: Date) => (d.getTime() - midnight) / 60_000

  const ceil = (m: number) => Math.ceil(m / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES
  const floor = (m: number) => Math.floor(m / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES

  let cursor = ceil(Math.max(open, toMinutes(now)))
  const blocks = busy
    .map(b => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))
    .filter(b => b.end > cursor && b.start < close)
    .sort((a, b) => a.start - b.start)

  const windows: FreeWindow[] = []
  const push = (from: number, to: number) => {
    const s = ceil(from)
    const e = floor(Math.min(to, close))
    if (e > s) windows.push({ start: hhmm(s), end: hhmm(e) })
  }

  for (const block of blocks) {
    if (block.start > cursor) push(cursor, block.start)
    cursor = Math.max(cursor, block.end)
    if (cursor >= close) break
  }
  if (cursor < close) push(cursor, close)

  return windows
}

/**
 * Why a requested meeting cannot be booked, or null if it can. The booking page
 * only offers legal slots, but the endpoint is public, so it checks again.
 */
export function slotProblem(start: Date, durationMin: number, now = new Date()): string | null {
  if (Number.isNaN(start.getTime())) return 'Invalid start time'
  if (start <= now) return 'That time is in the past'

  const { dateKey, minutes, seconds } = localParts(start)
  const { last } = bookingHorizon(now)
  if (dateKey > last) return `Bookings open at most ${MAX_DAYS_AHEAD} days ahead`
  if (seconds !== 0 || minutes % SLOT_STEP_MINUTES !== 0) {
    return `Meetings start on the ${SLOT_STEP_MINUTES}-minute mark`
  }

  const { open, close } = openingMinutes(dateKey)
  if (minutes < open) return 'That time is before working hours'
  if (minutes + durationMin > close) return 'That time runs past working hours'
  return null
}

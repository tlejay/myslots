import {
  BUFFERS,
  DEFAULT_MODE,
  MAX_DAYS_AHEAD,
  SLOT_STEP_MINUTES,
  TIME_ZONE,
  UTC_OFFSET,
  openHoursFor,
  type MeetingMode,
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

/**
 * What a busy block is, for the time kept clear around it (BUFFERS): `onsite`
 * for an in-person meeting booked here, `other` for every other event, and
 * `away` for a stretch the host is not in the city being booked — which has no
 * buffer of its own, only the new meeting's.
 */
export type BlockKind = 'onsite' | 'other' | 'away'

export interface BusyBlock extends Interval {
  /** Left out = `other`. */
  kind?: BlockKind
}

function ownBuffers(kind: BlockKind = 'other') {
  return kind === 'away' ? { before: 0, after: 0 } : BUFFERS[kind]
}

/**
 * Busy blocks grown by the gap that must separate each one from the meeting
 * being booked, so every slot check can stay a plain overlap test. Buffers do
 * not stack: a meeting after a block needs the larger of the block's own
 * after-buffer and the meeting's before-buffer, and the same the other way
 * round. With 45 for in person, an in-person 14:00–15:00 grows to end at 15:45
 * whichever kind is being booked.
 */
export function withBuffers(busy: BusyBlock[], mode: MeetingMode = DEFAULT_MODE): Interval[] {
  const meeting = BUFFERS[mode]
  return busy.map(b => {
    const own = ownBuffers(b.kind)
    return {
      start: new Date(b.start.getTime() - Math.max(meeting.after, own.before) * 60_000),
      end: new Date(b.end.getTime() + Math.max(own.after, meeting.before) * 60_000),
    }
  })
}

/** The widest gap any block can need on either side, in minutes. */
const WIDEST_BUFFER = Math.max(...Object.values(BUFFERS).flatMap(b => [b.before, b.after]))

/**
 * The raw lookup range that can hold a block which, once buffered, touches
 * [from, to) — wide enough for the largest buffer of any kind, since what kind
 * a block is only shows once it has been read.
 */
export function bufferedLookupRange(from: Date, to: Date): Interval {
  return {
    start: new Date(from.getTime() - WIDEST_BUFFER * 60_000),
    end: new Date(to.getTime() + WIDEST_BUFFER * 60_000),
  }
}

export function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
}

export function addDaysToKey(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` and a day that exists — the pattern alone lets 2026-02-30 through. */
export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY_RE.test(value) && addDaysToKey(value, 0) === value
}

/** Every date key from `from` to `to`, both included. */
export function dateKeysBetween(from: string, to: string): string[] {
  const keys: string[] = []
  for (let d = from; d <= to; d = addDaysToKey(d, 1)) keys.push(d)
  return keys
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

/**
 * The stretches of `dateKey` open for meetings, in minutes since local midnight
 * and earliest first: working hours with the daily break taken out.
 */
export function openSegments(dateKey: string): { open: number; close: number }[] {
  return openHoursFor(dayOfWeek(dateKey)).map(({ start, end }) => ({
    open: start * 60,
    close: end * 60,
  }))
}

/**
 * The stretches of `dateKey` inside working hours that no busy block touches,
 * with anything already in the past cut off. Edges are snapped inward onto the
 * slot grid, so every window starts and ends on a time the booking page offers.
 */
export function freeWindows(dateKey: string, busy: Interval[], now = new Date()): FreeWindow[] {
  const midnight = localInstant(dateKey, 0).getTime()
  const toMinutes = (d: Date) => (d.getTime() - midnight) / 60_000

  const ceil = (m: number) => Math.ceil(m / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES
  const floor = (m: number) => Math.floor(m / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES

  const windows: FreeWindow[] = []

  // Each open stretch is walked on its own, so the daily break comes out as a
  // gap between two windows rather than being papered over.
  for (const { open, close } of openSegments(dateKey)) {
    let cursor = ceil(Math.max(open, toMinutes(now)))
    const blocks = busy
      .map(b => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))
      .filter(b => b.end > cursor && b.start < close)
      .sort((a, b) => a.start - b.start)

    const push = (from: number, to: number) => {
      const s = ceil(Math.max(from, open))
      const e = floor(Math.min(to, close))
      if (e > s) windows.push({ start: hhmm(s), end: hhmm(e) })
    }

    for (const block of blocks) {
      if (block.start > cursor) push(cursor, block.start)
      cursor = Math.max(cursor, block.end)
      if (cursor >= close) break
    }
    if (cursor < close) push(cursor, close)
  }

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

  const segments = openSegments(dateKey)
  if (segments.length === 0) return 'Bookings are closed that day'

  const open = segments[0].open
  const close = segments[segments.length - 1].close
  if (minutes < open) return 'That time is before working hours'
  if (minutes + durationMin > close) return 'That time runs past working hours'
  // Left over: it starts inside the day but crosses a closed stretch of it.
  if (!segments.some(s => minutes >= s.open && minutes + durationMin <= s.close)) {
    return 'That time runs into the daily break'
  }
  return null
}

export type SlotReason = 'available' | 'busy' | 'past'

export interface Slot {
  start: string   // ISO instant
  display: string // local HH:MM
  available: boolean
  reason: SlotReason
}

/**
 * Every slot of `durationMin` on `dateKey`, marked against the calendar. `busy`
 * must already carry the buffers of the kind of meeting being offered (see
 * `withBuffers`), so this stays the same for online and in person.
 */
export function daySlots(dateKey: string, durationMin: number, busy: Interval[], now = new Date()): Slot[] {
  const slots: Slot[] = []
  // One pass per open stretch of the day, so nothing is offered that would run
  // past closing time or across the daily break.
  for (const { open, close } of openSegments(dateKey)) {
    for (let m = open; m + durationMin <= close; m += SLOT_STEP_MINUTES) {
      const slotStart = localInstant(dateKey, m)
      const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000)
      const start = slotStart.toISOString()
      const display = hhmm(m)

      if (slotStart <= now) {
        slots.push({ start, display, available: false, reason: 'past' })
        continue
      }
      const overlaps = busy.some(b => slotStart < b.end && slotEnd > b.start)
      slots.push({ start, display, available: !overlaps, reason: overlaps ? 'busy' : 'available' })
    }
  }
  return slots
}

/**
 * The journey either side of an in-person meeting, as the two stretches the
 * booking endpoint puts on the calendar: one ending as the meeting starts, one
 * starting as it ends.
 */
export function travelLegs(start: Date, end: Date): [Interval, Interval] {
  const { before, after } = BUFFERS.onsite
  return [
    { start: new Date(start.getTime() - before * 60_000), end: start },
    { start: end, end: new Date(end.getTime() + after * 60_000) },
  ]
}

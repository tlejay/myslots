// ─── Everything you are likely to change lives here ──────────────────────────

/** Shown in the page heading and on the calendar invite. */
export const HOST_NAME = 'Alex'

/** Shown in the top-left of the nav. */
export const BRAND_NAME = 'MySlots'

/**
 * Fixed UTC offset for every slot the app generates, and the IANA zone used to
 * format times for display. Keep the two in agreement.
 *
 * The offset is fixed on purpose: slots are built as literal wall-clock strings
 * (`2026-09-01T09:00:00+07:00`). If your zone observes daylight saving, slots
 * will drift by an hour after the changeover — see README → "Time zones".
 */
export const UTC_OFFSET = '+07:00'
export const TIME_ZONE = 'Asia/Bangkok'
export const TIME_ZONE_LABEL = 'GMT+7'

/** Meeting lengths offered, in minutes. */
export const DURATIONS = [30, 60, 90] as const
export type Duration = (typeof DURATIONS)[number]
export const DEFAULT_DURATION: Duration = 60

/** Working hours, 24h. The last slot must *end* by `end`. */
export const WEEKDAY_HOURS = { start: 9, end: 20 }
export const WEEKEND_HOURS = { start: 10, end: 20 }

/**
 * A break kept clear every day of the week, 24h — lunch, a school run, a nap.
 * A meeting may finish at `start` and the next may begin at `end`, but nothing
 * is offered that runs across the middle. Unlike the buffers below this is a
 * closed stretch of the day, not a busy block: no buffer is grown around it, so
 * with `{ start: 12, end: 13 }` both 11:00-12:00 and 13:00-14:00 stay bookable
 * while 11:30-12:30 does not. `null` keeps the day in one piece.
 */
export const DAILY_BREAK: { start: number; end: number } | null = null

/** How the slot grid is stepped and paged. */
export const SLOT_STEP_MINUTES = 30
export const RANGE_DAYS = 7      // days visible in the strip at once
export const MAX_DAYS_AHEAD = 60 // how far ahead people may book

/**
 * Time kept clear around a booked meeting, in minutes — for travel, prep or a
 * breather. Checked against every busy block on the calendar, not only earlier
 * bookings: with 30 before, a 09:00–10:00 event makes 10:30 the first start.
 * Buffers may spill past working hours; they never become calendar events.
 * Set both to 0 for back-to-back meetings.
 */
export const BUFFER_BEFORE_MINUTES = 30
export const BUFFER_AFTER_MINUTES = 30

/** Give every booking a Google Meet room on the invite. */
export const ADD_GOOGLE_MEET = true

export function isWeekend(dow: number): boolean {
  return dow === 0 || dow === 6
}

export function hoursFor(dow: number) {
  return isWeekend(dow) ? WEEKEND_HOURS : WEEKDAY_HOURS
}

/**
 * The day's working hours with the daily break cut out, earliest first — one
 * range while `DAILY_BREAK` is null or falls outside the day, two otherwise.
 * Every part of the app that lays out a day walks these instead of a single
 * open/close pair.
 */
export function openHoursFor(dow: number): { start: number; end: number }[] {
  const day = hoursFor(dow)
  if (!DAILY_BREAK || DAILY_BREAK.end <= day.start || DAILY_BREAK.start >= day.end) return [day]

  const ranges: { start: number; end: number }[] = []
  if (DAILY_BREAK.start > day.start) ranges.push({ start: day.start, end: DAILY_BREAK.start })
  if (DAILY_BREAK.end < day.end) ranges.push({ start: DAILY_BREAK.end, end: day.end })
  return ranges
}

/**
 * "Mon–Fri 09:00–20:00 · Sat–Sun 10:00–20:00 (GMT+7)", or with a break set,
 * "Mon–Fri 09:00–12:00, 13:00–20:00 · …"
 *
 * Read off `openHoursFor`, so the break shows up as a gap and the label can
 * never drift away from what the picker actually offers.
 */
export function workingHoursLabel(): string {
  const f = (h: number) => `${String(h).padStart(2, '0')}:00`
  const ranges = (dow: number) =>
    openHoursFor(dow).map(r => `${f(r.start)}–${f(r.end)}`).join(', ')
  return `Mon–Fri ${ranges(1)} · Sat–Sun ${ranges(6)} (${TIME_ZONE_LABEL})`
}

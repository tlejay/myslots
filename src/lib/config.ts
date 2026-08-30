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

/** How the slot grid is stepped and paged. */
export const SLOT_STEP_MINUTES = 30
export const RANGE_DAYS = 7      // days visible in the strip at once
export const MAX_DAYS_AHEAD = 60 // how far ahead people may book

export function isWeekend(dow: number): boolean {
  return dow === 0 || dow === 6
}

export function hoursFor(dow: number) {
  return isWeekend(dow) ? WEEKEND_HOURS : WEEKDAY_HOURS
}

/** "Mon–Fri 09:00–20:00 · Sat–Sun 10:00–20:00 (GMT+7)" */
export function workingHoursLabel(): string {
  const f = (h: number) => `${String(h).padStart(2, '0')}:00`
  const weekday = `Mon–Fri ${f(WEEKDAY_HOURS.start)}–${f(WEEKDAY_HOURS.end)}`
  const weekend = `Sat–Sun ${f(WEEKEND_HOURS.start)}–${f(WEEKEND_HOURS.end)}`
  return `${weekday} · ${weekend} (${TIME_ZONE_LABEL})`
}

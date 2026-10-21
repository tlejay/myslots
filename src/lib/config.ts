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
 * Time kept clear around a booked online meeting, in minutes — for prep or a
 * breather. Checked against every busy block on the calendar, not only earlier
 * bookings: with 30 before, a 09:00–10:00 event makes 10:30 the first start.
 * Buffers may spill past working hours; an online meeting's never become
 * calendar events. Set both to 0 for back-to-back meetings. In-person meetings
 * use the ONSITE_ pair below.
 */
export const BUFFER_BEFORE_MINUTES = 30
export const BUFFER_AFTER_MINUTES = 30

/** Give every online booking a Google Meet room on the invite. */
export const ADD_GOOGLE_MEET = true

// ─── Meeting in person ───────────────────────────────────────────────────────
// A visitor books either a video call or a meeting at a place they name. In
// person is only offered while the host is in the city the visitor picked, and
// keeps a longer stretch clear on each side for the journey. Where the host is
// comes from the calendar itself — see LOCATION_EVENT_PREFIX.

export const MEETING_MODES = ['online', 'onsite'] as const
export type MeetingMode = (typeof MEETING_MODES)[number]
export const DEFAULT_MODE: MeetingMode = 'online'

/**
 * Where the host can be met in person. Adding a city here is the whole job: the
 * picker, the availability and booking checks all read this list. `id` goes in
 * links and requests — never change one that is in use. `label` is what people
 * see. `aliases` are other ways a location event may name the same city
 * (matched with `label` and `id`, ignoring case and extra spaces).
 */
export const CITIES = [
  { id: 'downtown', label: 'Downtown', aliases: ['city centre', 'city center', 'centre', 'center'] },
  { id: 'uptown', label: 'Uptown', aliases: ['north side'] },
] as const
export type CityId = (typeof CITIES)[number]['id']

/**
 * How the host tells the app where they are: an event on their own calendar
 * whose title starts with this — "@ Uptown" all day, or "@ Uptown" 10:00–22:00
 * for part of one. The rest of the title must be a city from CITIES and nothing
 * else; those events are never busy time, whether they are marked free or busy.
 * Any other title — "@ Lisbon", "@ Acme call", "@ Uptown (lunch)" — is an
 * ordinary event and takes up time like one. Matched exactly: with '@ ',
 * "@Uptown" is an ordinary event too.
 */
export const LOCATION_EVENT_PREFIX = '@ '

/**
 * Where the host is whenever no location event says otherwise. `null` = unknown,
 * so in person is only offered on stretches a location event covers.
 */
export const DEFAULT_LOCATION: CityId | null = 'downtown'

/**
 * Time kept clear around an in-person meeting, in minutes — the journey there
 * and back. The whole stretch, journey included, must fall inside a time the
 * host is in that city.
 */
export const ONSITE_BUFFER_BEFORE_MINUTES = 45
export const ONSITE_BUFFER_AFTER_MINUTES = 45

/**
 * Time kept clear around a meeting by the kind of thing on the calendar. `other`
 * is every event the app did not book as in person — online bookings included.
 *
 * Buffers do not stack: the gap between two things is the larger of the first
 * one's `after` and the second one's `before`. So after an in-person 14:00–15:00
 * the next meeting of either kind may start at 15:45, and after an online one an
 * online call may start at 15:30 but an in-person meeting only at 15:45.
 */
export const BUFFERS: Record<MeetingMode | 'other', { before: number; after: number }> = {
  online: { before: BUFFER_BEFORE_MINUTES, after: BUFFER_AFTER_MINUTES },
  onsite: { before: ONSITE_BUFFER_BEFORE_MINUTES, after: ONSITE_BUFFER_AFTER_MINUTES },
  other: { before: BUFFER_BEFORE_MINUTES, after: BUFFER_AFTER_MINUTES },
}

/**
 * An in-person booking also puts the journey either side on the calendar as
 * events of their own, so the host sees it. They are left out when working out
 * what is free — the meeting's own buffers already stand for them.
 */
export const TRAVEL_EVENT_TITLE = '🚗 Travel'

/** The longest meeting place a visitor may type. */
export const MAX_PLACE_LENGTH = 200

export function isCityId(value: unknown): value is CityId {
  return CITIES.some(c => c.id === value)
}

export function cityById(id: CityId) {
  return CITIES.find(c => c.id === id)!
}

/**
 * Reads the kind of meeting a request is about. Online is the default and needs
 * nothing else; in person must name a city from the list.
 */
export function parseMeetingKind(
  mode: unknown,
  city: unknown,
): { mode: 'online' } | { mode: 'onsite'; city: CityId } | { error: string } {
  if (mode === undefined || mode === null || mode === '' || mode === 'online') return { mode: 'online' }
  if (mode !== 'onsite') return { error: `Unknown meeting mode — expected ${MEETING_MODES.join(' or ')}` }
  if (!isCityId(city)) {
    return { error: `Pick where to meet — city must be one of ${CITIES.map(c => c.id).join(', ')}` }
  }
  return { mode: 'onsite', city }
}

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

/** 9 → "9am", 12 → "12pm", 20 → "8pm". Whole hours; a half hour reads "9.5am". */
function clock(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

/** "9am–8pm", tightened to "1–8pm" when both ends sit in the same half of the day. */
function span(from: number, to: number): string {
  const a = clock(from)
  const b = clock(to)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`
}

/**
 * The one-line answer to "when can I have you?", written the way it would be
 * said out loud:
 *
 *   "Alex is available weekdays 9am–8pm and weekends 10am–8pm. All times GMT+7."
 *
 * With `DAILY_BREAK` set it gains a clause: "… and weekends 10am–8pm, with a
 * break (12–1pm). All times GMT+7."
 *
 * Every number is read off `openHoursFor`, so the sentence cannot promise a
 * time the picker would not offer. A day split by the break is described by its
 * outer edges — the break gets its own clause rather than turning the hours into
 * a list of ranges to parse.
 */
export function workingHoursLabel(): string {
  const outer = (dow: number) => {
    const ranges = openHoursFor(dow)
    return span(ranges[0].start, ranges[ranges.length - 1].end)
  }
  // Only worth a clause on a week where it actually splits a day in two.
  const splits = [1, 6].some(dow => openHoursFor(dow).length > 1)
  const brk = DAILY_BREAK && splits ? `, with a break (${span(DAILY_BREAK.start, DAILY_BREAK.end)})` : ''

  return `${HOST_NAME} is available weekdays ${outer(1)} and weekends ${outer(6)}${brk}. All times ${TIME_ZONE_LABEL}.`
}

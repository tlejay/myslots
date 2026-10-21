import { google, type calendar_v3 } from 'googleapis'
import { demoBusyBetween, demoLocationsBetween } from './demo-availability'
import { addDaysToKey, bufferedLookupRange, localInstant, localParts, withBuffers, type Interval } from './booking-time'
import { BOOKING_TAG, busyBlocks, locationEvents } from './calendar-events'
import { hostDays, type HostDay } from './host-location'
import { DEFAULT_MODE, UTC_OFFSET, type MeetingMode } from './config'

export { BOOKING_TAG }

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN

/**
 * With no credentials the app still runs — it serves synthetic availability so
 * you can click through the whole flow before touching Google Cloud.
 */
export const isCalendarConfigured = Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN)

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? 'primary'

/** Shared across every Google call — one consent covers Calendar and Gmail. */
export const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN })

export const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

const dateKeyOf = (d: Date) => localParts(d).dateKey

/** Every event touching [from, to), recurring ones expanded, across every page of results. */
async function eventsBetween(from: Date, to: Date): Promise<calendar_v3.Schema$Event[]> {
  const items: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      maxResults: 250,
      pageToken,
    })
    items.push(...(res.data.items ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return items
}

/**
 * Every busy block on the host's calendar that touches [from, to), already grown
 * by the gap the kind of meeting being booked needs from it (see `withBuffers`)
 * — so every caller agrees on what counts as taken. Read from the events
 * themselves rather than free/busy, which cannot tell an in-person meeting from
 * any other block, or leave out location events and the journey around a
 * meeting. Without credentials it answers from the demo schedule, so the whole
 * app still runs.
 */
export async function busyBetween(from: Date, to: Date, mode: MeetingMode = DEFAULT_MODE): Promise<Interval[]> {
  const range = bufferedLookupRange(from, to)
  const raw = isCalendarConfigured
    ? busyBlocks(await eventsBetween(range.start, range.end))
    : demoBusyBetween(range.start, range.end, dateKeyOf, UTC_OFFSET)
  return withBuffers(raw, mode).filter(b => b.start < to && b.end > from)
}

/**
 * Where the host is on every day from `from` to `to` (date keys, both included),
 * from the location events on their calendar — or the demo ones without
 * credentials.
 */
export async function hostDaysBetween(from: string, to: string): Promise<HostDay[]> {
  const start = localInstant(from, 0)
  const end = localInstant(addDaysToKey(to, 1), 0)
  const events = isCalendarConfigured
    ? locationEvents(await eventsBetween(start, end))
    : demoLocationsBetween(start, end, dateKeyOf, UTC_OFFSET)
  return hostDays(from, to, events)
}

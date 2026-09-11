import { google } from 'googleapis'
import { demoBusyBetween } from './demo-availability'
import { localParts } from './booking-time'
import { UTC_OFFSET } from './config'

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

/**
 * Every busy block on the host's calendar that touches [from, to). Without
 * credentials it answers from the demo schedule, so the whole app still runs.
 */
export async function busyBetween(from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  if (!isCalendarConfigured) return demoBusyBetween(from, to, d => localParts(d).dateKey, UTC_OFFSET)

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  })
  const cal = fb.data.calendars?.[CALENDAR_ID]
  // Google reports a calendar it cannot read as an error on the calendar, not as
  // a failed request — an empty busy list there would read as "free all day".
  if (cal?.errors?.length) throw new Error(`Free/busy lookup failed: ${cal.errors[0].reason}`)
  return (cal?.busy ?? [])
    .filter(b => b.start && b.end)
    .map(b => ({ start: new Date(b.start!), end: new Date(b.end!) }))
}

import { google } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN

/**
 * With no credentials the app still runs — it serves synthetic availability so
 * you can click through the whole flow before touching Google Cloud.
 */
export const isCalendarConfigured = Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN)

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? 'primary'

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN })

export const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

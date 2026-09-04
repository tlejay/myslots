import { google } from 'googleapis'
import { oauth2Client, CALENDAR_ID } from './google-calendar'
import { BRAND_NAME, HOST_NAME, TIME_ZONE, TIME_ZONE_LABEL } from './config'
import {
  renderBookingCreated,
  renderBookingFailed,
  type BookingSummary,
  type EmailContext,
  type RenderedEmail,
} from './booking-email-template'

export type { BookingSummary }

const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

const CONTEXT: EmailContext = {
  hostName: HOST_NAME,
  brandName: BRAND_NAME,
  timeZone: TIME_ZONE,
  timeZoneLabel: TIME_ZONE_LABEL,
}

/**
 * Google emails every attendee except the account that created the event — and
 * every booking here is created with the host's own credentials. Without this,
 * a new meeting simply appears in the calendar with nobody told about it.
 *
 * Set NOTIFY_EMAIL to send the heads-up somewhere other than the calendar.
 */
const NOTIFY_TO = process.env.NOTIFY_EMAIL?.trim() || CALENDAR_ID

/** RFC 2047 — non-ASCII subjects (accents, emoji) survive only base64-encoded. */
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** RFC 2045 caps an encoded line at 76 characters. */
function encodeBody(html: string): string {
  return (Buffer.from(html, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
}

async function send({ subject, html }: RenderedEmail, replyTo: string): Promise<void> {
  const message = [
    `To: ${NOTIFY_TO}`,
    // No From header — Gmail stamps the authenticated account and rejects any
    // address that is not it or one of its aliases.
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(html),
  ].join('\r\n')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(message, 'utf8').toString('base64url') },
  })
}

/**
 * Best-effort by design: a meeting that reached the calendar must not be
 * reported as failed because Gmail was unhappy, so problems are logged here
 * and go no further.
 */
async function attempt(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${label} email failed:`, message)
    if (/insufficient|scope|invalid_grant/i.test(message)) {
      console.error(
        'The refresh token is probably missing the gmail.send scope. ' +
        'Run `pnpm token` again and replace GOOGLE_REFRESH_TOKEN.'
      )
    }
  }
}

export async function notifyBookingCreated(b: BookingSummary, eventLink?: string | null): Promise<void> {
  await attempt('Booking notification', () => send(renderBookingCreated(b, CONTEXT, eventLink), b.email))
}

export async function notifyBookingFailed(b: BookingSummary, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error)
  await attempt('Booking failure', () => send(renderBookingFailed(b, CONTEXT, reason), b.email))
}

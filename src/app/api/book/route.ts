import { NextRequest, NextResponse } from 'next/server'
import { calendar, CALENDAR_ID, isCalendarConfigured } from '@/lib/google-calendar'
import { DURATIONS, HOST_NAME, TIME_ZONE, hoursFor } from '@/lib/config'

interface BookingRequest {
  startTime: string
  duration: number
  name: string
  email: string
  topic?: string
  guests?: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Every guest is a person Google will email, so the list is capped. */
const MAX_GUESTS = 10

/** Trimmed, lowercased, de-duplicated, and never the booker or the host again. */
function normaliseGuests(guests: string[] | undefined, bookerEmail: string): string[] {
  if (!guests) return []
  const taken = new Set([bookerEmail.trim().toLowerCase(), CALENDAR_ID.toLowerCase()])
  const out: string[] = []
  for (const raw of guests) {
    const email = String(raw).trim().toLowerCase()
    if (!email || taken.has(email)) continue
    taken.add(email)
    out.push(email)
  }
  return out
}

/**
 * The browser only ever offers legal slots, but the endpoint is public — so it
 * re-checks the request against working hours and the calendar before writing.
 */
function validate(body: BookingRequest): string | null {
  const { startTime, duration, name, email, guests } = body

  if (!startTime || !name?.trim() || !email?.trim()) return 'Missing required fields'
  if (!EMAIL_RE.test(email.trim())) return 'Invalid email address'
  if (!(DURATIONS as readonly number[]).includes(duration)) return 'Unsupported meeting length'

  if (guests !== undefined) {
    if (!Array.isArray(guests)) return 'Guests must be a list of email addresses'
    if (guests.length > MAX_GUESTS) return `At most ${MAX_GUESTS} guests`
    const bad = guests.map(g => String(g).trim()).filter(g => g && !EMAIL_RE.test(g))
    if (bad.length > 0) return `Invalid guest email: ${bad[0]}`
  }

  const start = new Date(startTime)
  if (Number.isNaN(start.getTime())) return 'Invalid start time'
  if (start <= new Date()) return 'That time is in the past'

  // Re-derive the wall-clock time in the configured zone.
  const local = new Date(start.toLocaleString('en-US', { timeZone: TIME_ZONE }))
  const { start: openHour, end: closeHour } = hoursFor(local.getDay())
  const startMinutes = local.getHours() * 60 + local.getMinutes()
  if (startMinutes < openHour * 60) return 'That time is before working hours'
  if (startMinutes + duration > closeHour * 60) return 'That time runs past working hours'

  return null
}

async function isStillFree(start: Date, end: Date): Promise<boolean> {
  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  })
  return (fb.data.calendars?.[CALENDAR_ID]?.busy ?? []).length === 0
}

export async function POST(request: NextRequest) {
  let body: BookingRequest
  try {
    body = (await request.json()) as BookingRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const problem = validate(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { startTime, duration, name, email, topic } = body
  const guestEmails = normaliseGuests(body.guests, email)
  const start = new Date(startTime)
  const end = new Date(start.getTime() + duration * 60_000)

  // Demo mode: pretend it worked, but never send an invite to a real person.
  if (!isCalendarConfigured) {
    return NextResponse.json({ success: true, demo: true })
  }

  try {
    if (!(await isStillFree(start, end))) {
      return NextResponse.json({ error: 'That slot was just taken' }, { status: 409 })
    }

    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      requestBody: {
        summary: `${HOST_NAME} × ${name.trim()}`,
        description: [topic?.trim() ? `Topic: ${topic.trim()}` : null, 'Booked via MySlots']
          .filter(Boolean)
          .join('\n\n'),
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
        attendees: [
          { email: CALENDAR_ID, responseStatus: 'accepted' },
          { email: email.trim(), displayName: name.trim() },
          ...guestEmails.map(guest => ({ email: guest })),
        ],
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Booking failed:', err)
    return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
  }
}

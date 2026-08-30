import { NextRequest, NextResponse } from 'next/server'
import { calendar, CALENDAR_ID, isCalendarConfigured } from '@/lib/google-calendar'
import { DURATIONS, HOST_NAME, TIME_ZONE, hoursFor } from '@/lib/config'

interface BookingRequest {
  startTime: string
  duration: number
  name: string
  email: string
  topic?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The browser only ever offers legal slots, but the endpoint is public — so it
 * re-checks the request against working hours and the calendar before writing.
 */
function validate(body: BookingRequest): string | null {
  const { startTime, duration, name, email } = body

  if (!startTime || !name?.trim() || !email?.trim()) return 'Missing required fields'
  if (!EMAIL_RE.test(email.trim())) return 'Invalid email address'
  if (!(DURATIONS as readonly number[]).includes(duration)) return 'Unsupported meeting length'

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
        ],
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Booking failed:', err)
    return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
  }
}

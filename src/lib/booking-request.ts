import { DURATIONS, MAX_PLACE_LENGTH, parseMeetingKind, type CityId } from './config'
import { slotProblem } from './booking-time'

// The body of POST /api/book, checked field by field. The endpoint is public, so
// anything may arrive — `null`, a number where a name should be, a list for an
// object — and every such request must come back as a 400 with a reason, never
// reach `.trim()` or `new Date()` and fall over as a 500. Pure logic, so
// scripts/check-booking.mjs runs it without a server.

export interface BookingRequest {
  start: Date
  duration: number
  name: string
  email: string
  topic: string
  /** Trimmed and checked, not yet de-duplicated against the booker and host. */
  guests: string[]
  onsite: { city: CityId; place: string } | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Every guest is a person Google will email, so the list is capped. */
export const MAX_GUESTS = 10

const absent = (v: unknown) => v === undefined || v === null

/**
 * The browser only ever offers legal slots, but the endpoint is public — so it
 * re-checks the request against the booking rules before anything is written.
 */
export function parseBookingRequest(body: unknown, now = new Date()): BookingRequest | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'Invalid JSON body' }
  const b = body as Record<string, unknown>

  // Optional fields: left out or null is fine, anything but text is not.
  for (const field of ['topic', 'mode', 'city', 'place'] as const) {
    if (!absent(b[field]) && typeof b[field] !== 'string') return { error: `${field} must be text` }
  }

  const kind = parseMeetingKind(b.mode, b.city)
  if ('error' in kind) return kind
  let onsite: BookingRequest['onsite'] = null
  if (kind.mode === 'onsite') {
    const place = typeof b.place === 'string' ? b.place.trim() : ''
    if (!place) return { error: 'Tell us where to meet' }
    if (place.length > MAX_PLACE_LENGTH) return { error: `Keep the meeting place under ${MAX_PLACE_LENGTH} characters` }
    onsite = { city: kind.city, place }
  }

  const { startTime, duration } = b
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  if (typeof startTime !== 'string' || !startTime || !name || !email) return { error: 'Missing required fields' }
  if (!EMAIL_RE.test(email)) return { error: 'Invalid email address' }
  if (typeof duration !== 'number' || !(DURATIONS as readonly number[]).includes(duration)) {
    return { error: 'Unsupported meeting length' }
  }

  // Guests turn into real invitations, so the addresses are checked here too.
  let guests: string[] = []
  if (!absent(b.guests)) {
    if (!Array.isArray(b.guests) || b.guests.some(g => typeof g !== 'string')) {
      return { error: 'Guests must be a list of email addresses' }
    }
    if (b.guests.length > MAX_GUESTS) return { error: `At most ${MAX_GUESTS} guests` }
    guests = (b.guests as string[]).map(g => g.trim()).filter(Boolean)
    const bad = guests.find(g => !EMAIL_RE.test(g))
    if (bad) return { error: `Invalid guest email: ${bad}` }
  }

  const start = new Date(startTime)
  const problem = slotProblem(start, duration, now)
  if (problem) return { error: problem }

  return {
    start,
    duration,
    name,
    email,
    topic: typeof b.topic === 'string' ? b.topic.trim() : '',
    guests,
    onsite,
  }
}

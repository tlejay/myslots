import { createHash } from 'node:crypto'

// The journey either side of an in-person meeting goes on the calendar as two
// events of its own, and a failed insert is tried again. Google may have saved
// the event even though its answer never arrived — so each leg's id is fixed in
// advance, and the second try either creates the event or is told it is already
// there (409). Pure logic, so scripts/check-booking.mjs runs it without a
// calendar.

export type TravelDirection = 'there' | 'back'

/** Tries per leg before it is reported missing. */
export const TRAVEL_ATTEMPTS = 2

/**
 * One leg's calendar event id — the same on every try. Google accepts ids the
 * client chooses: base32hex (a–v, 0–9), 5–1024 characters. A hex digest is
 * within that alphabet; the meeting's own id keeps it unique per booking.
 */
export function travelEventId(meetingId: string, direction: TravelDirection): string {
  return createHash('sha256').update(`myslots-travel:${meetingId}:${direction}`).digest('hex')
}

/** Google's answer to an insert whose event id is already taken. */
export function isAlreadyCreated(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { status, response } = err as { status?: unknown; response?: { status?: unknown } }
  return status === 409 || response?.status === 409
}

/**
 * Puts one leg on the calendar, trying up to `TRAVEL_ATTEMPTS` times. True once
 * the event is there — whether this try made it, or an earlier one whose answer
 * was lost. `insert` must send the same event id every time.
 */
export async function insertTravelLeg(
  insert: () => Promise<unknown>,
  onError: (err: unknown, attempt: number) => void,
): Promise<boolean> {
  for (let attempt = 1; attempt <= TRAVEL_ATTEMPTS; attempt++) {
    try {
      await insert()
      return true
    } catch (err) {
      if (isAlreadyCreated(err)) return true
      onError(err, attempt)
    }
  }
  return false
}

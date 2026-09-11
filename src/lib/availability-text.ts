import type { FreeWindow } from './booking-time'

// Turns free windows into the plain-text message the Find slots panel copies —
// written to be pasted into LINE, Slack or an email as-is:
//
//   Here’s Tle’s availability during this period 😊
//
//   23/Sep (Wednesday)
//   10:30 - 13:00
//
//   24/Sep (Thursday)
//   No availability
//   —
//   Feel free to book a time that works for you here: example.com

export interface DayWindows {
  date: string // YYYY-MM-DD
  windows: FreeWindow[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "23/Sep (Wednesday)" */
export function dayHeading(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d}/${MONTHS[m - 1]} (${WEEKDAYS[dayOfWeek(date)]})`
}

export function isWeekendDate(date: string): boolean {
  const dow = dayOfWeek(date)
  return dow === 0 || dow === 6
}

/** Only the windows long enough to hold a meeting of `duration` minutes. */
export function windowsLongEnough(windows: FreeWindow[], duration: number): FreeWindow[] {
  return windows.filter(w => minutesOf(w.end) - minutesOf(w.start) >= duration)
}

export function availabilityText({
  days,
  duration,
  includeWeekends,
  hostName,
  bookingLink,
}: {
  days: DayWindows[]
  duration: number
  includeWeekends: boolean
  hostName: string
  bookingLink: string
}): string {
  const blocks = days
    .filter(day => includeWeekends || !isWeekendDate(day.date))
    .map(day => {
      const fits = windowsLongEnough(day.windows, duration)
      const lines = fits.length > 0 ? fits.map(w => `${w.start} - ${w.end}`) : ['No availability']
      return [dayHeading(day.date), ...lines].join('\n')
    })

  return [
    `Here’s ${hostName}’s availability during this period 😊`,
    '',
    blocks.join('\n\n'),
    '—',
    `Feel free to book a time that works for you here: ${bookingLink}`,
  ].join('\n')
}

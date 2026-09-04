/**
 * Renders the README's inbox mockups from the real email template, so the
 * pictures cannot quietly drift away from what a booking actually sends.
 *
 *   pnpm mockup
 *
 * Drives headless Chrome through its command line — no browser-automation
 * dependency for something that only ever runs when the docs change. Point
 * CHROME_PATH at your binary if it is not in the usual place.
 *
 * Requires Node 23.6+ (or `--experimental-strip-types`) to import the template
 * module directly.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderBookingCreated,
  renderBookingFailed,
} from '../src/lib/booking-email-template.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'docs')

const CHROME = process.env.CHROME_PATH ?? {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform]

const WIDTH = 720

/** Stands in for the host's own address in the mockup. */
const HOST_EMAIL = 'alex@example.com'

const ctx = {
  hostName: 'Alex',
  brandName: 'MySlots',
  timeZone: 'Asia/Bangkok',
  timeZoneLabel: 'GMT+7',
}

// One booking with every row the template can draw — a topic, several guests,
// and a link back to the calendar entry.
const sample = {
  name: 'Priya Raman',
  email: 'priya@northwind.dev',
  topic: 'Scoping the onboarding revamp',
  guests: ['dev@northwind.dev', 'design@northwind.dev'],
  start: new Date('2026-10-09T07:00:00.000Z'), // 14:00 in Asia/Bangkok
  end: new Date('2026-10-09T08:00:00.000Z'),
  duration: 60,
}

/**
 * A plain reading pane — enough chrome to show the subject line and who a reply
 * would reach, without dressing up as anybody's mail client.
 *
 * Chrome's command line screenshots a fixed window rather than an element, so
 * the height below is part of the shot. Adjust it if the template grows.
 */
function page({ subject, html }, replyTo, height) {
  const card = html
    .slice(html.indexOf('<body'), html.lastIndexOf('</body>') + 7)
    .replace('<body', '<div')
    .replace('</body>', '</div>')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  html, body { height: ${height}px; }
  body { margin: 0; background: #e4e4e7; padding: 28px; box-sizing: border-box;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .window { width: 640px; margin: 0 auto; background: #fff; border-radius: 14px;
            overflow: hidden; box-shadow: 0 18px 45px rgba(15, 23, 42, .18); }
  .bar { display: flex; gap: 7px; padding: 13px 18px; background: #f4f4f5;
         border-bottom: 1px solid #e4e4e7; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .head { padding: 18px 22px 16px; border-bottom: 1px solid #f1f1f4; }
  .subject { font-size: 17px; font-weight: 700; color: #111827; line-height: 1.45; }
  .meta { margin-top: 9px; font-size: 12px; color: #6b7280; line-height: 1.7; }
  .meta b { color: #374151; font-weight: 600; }
</style></head>
<body>
  <div class="window">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
    </div>
    <div class="head">
      <div class="subject">${subject}</div>
      <div class="meta"><b>To</b> ${HOST_EMAIL}<br><b>Reply-To</b> ${replyTo}</div>
    </div>
    ${card}
  </div>
</body></html>`
}

const shots = [
  {
    file: 'booking-email.png',
    height: 669,
    email: renderBookingCreated(
      sample, ctx,
      'https://calendar.google.com/calendar/u/0/r/eventedit/9k2m4x8vqp1n',
    ),
  },
  {
    file: 'booking-email-failure.png',
    height: 683,
    email: renderBookingFailed(sample, ctx, 'invalid_grant: Token has been expired or revoked.'),
  },
]

mkdirSync(OUT_DIR, { recursive: true })
const scratch = path.join(tmpdir(), `myslots-mockup-${process.pid}`)
mkdirSync(scratch, { recursive: true })

try {
  for (const { file, height, email } of shots) {
    const html = path.join(scratch, file.replace('.png', '.html'))
    writeFileSync(html, page(email, sample.email, height), 'utf8')

    const result = spawnSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${WIDTH},${height}`,
      `--screenshot=${path.join(OUT_DIR, file)}`,
      `file://${html}`,
    ], { stdio: 'ignore' })

    if (result.error || result.status !== 0) {
      console.error(`Could not run Chrome at ${CHROME} — set CHROME_PATH.`)
      process.exit(1)
    }
    console.log('wrote docs/' + file)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

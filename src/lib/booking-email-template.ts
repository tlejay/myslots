/**
 * How a booking looks in the host's inbox.
 *
 * Deliberately import-free — settings arrive as an argument rather than from
 * `config.ts` — so `scripts/render-email-mockup.mjs` can load this module on
 * its own and shoot the README's picture from the markup that really gets
 * mailed, instead of from a lookalike kept beside it.
 */

export interface BookingSummary {
  name: string
  email: string
  topic: string
  guests: string[]
  start: Date
  end: Date
  duration: number
}

/** The parts of `config.ts` the wording depends on. */
export interface EmailContext {
  hostName: string
  brandName: string
  timeZone: string
  timeZoneLabel: string
}

export interface RenderedEmail {
  subject: string
  html: string
}

function fmtDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-GB', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtTime(d: Date, timeZone: string): string {
  return d.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 16px 8px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${label}</td>
      <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600">${value}</td>
    </tr>`
}

// Inline styles and a table layout, because email clients are not browsers.
function shell(heading: string, accent: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:20px 24px;background:${accent};color:#ffffff;font-size:16px;font-weight:700">${heading}</div>
    <div style="padding:24px">${body}</div>
  </div>
</body></html>`
}

function detailRows(b: BookingSummary, ctx: EmailContext): string {
  const when =
    `${fmtDate(b.start, ctx.timeZone)} · ` +
    `${fmtTime(b.start, ctx.timeZone)}–${fmtTime(b.end, ctx.timeZone)} (${ctx.timeZoneLabel})`

  return [
    row('Name', esc(b.name)),
    row('Email', `<a href="mailto:${esc(b.email)}" style="color:#2563eb;text-decoration:none">${esc(b.email)}</a>`),
    row('When', esc(when)),
    row('Length', `${b.duration} minutes`),
    b.topic.trim() ? row('Topic', esc(b.topic.trim())) : '',
    b.guests.length > 0
      ? row(`Guests (${b.guests.length})`, b.guests.map(esc).join('<br>'))
      : row('Guests', '<span style="color:#9ca3af;font-weight:400">none</span>'),
  ].join('')
}

function subjectFor(prefix: string, b: BookingSummary, ctx: EmailContext): string {
  return `${prefix}: ${b.name} — ${fmtDate(b.start, ctx.timeZone)}, ${fmtTime(b.start, ctx.timeZone)}`
}

export function renderBookingCreated(
  b: BookingSummary,
  ctx: EmailContext,
  eventLink?: string | null,
): RenderedEmail {
  return {
    subject: subjectFor('📅 New booking', b, ctx),
    html: shell(
      `${b.name} booked time with you`,
      '#2563eb',
      `<table style="width:100%;border-collapse:collapse">${detailRows(b, ctx)}</table>
       ${eventLink
         ? `<a href="${esc(eventLink)}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#2563eb;color:#ffffff;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">Open in Google Calendar</a>`
         : '<p style="margin:20px 0 0;color:#6b7280;font-size:13px">Google returned no link for the event — it is in your calendar at the time above.</p>'}
       <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">Reply to this email to reach ${esc(b.name)} directly · Booked via ${esc(ctx.brandName)}</p>`
    ),
  }
}

export function renderBookingFailed(
  b: BookingSummary,
  ctx: EmailContext,
  reason: string,
): RenderedEmail {
  return {
    subject: subjectFor('⚠️ Booking failed', b, ctx),
    html: shell(
      'Someone tried to book, but the event was not created',
      '#dc2626',
      `<p style="margin:0 0 16px;color:#374151;font-size:14px">
         They saw an error and there is nothing in your calendar. If you want this
         meeting, reach out to them yourself.
       </p>
       <table style="width:100%;border-collapse:collapse">${detailRows(b, ctx)}</table>
       <p style="margin:20px 0 0;padding:12px;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(reason)}</p>`
    ),
  }
}

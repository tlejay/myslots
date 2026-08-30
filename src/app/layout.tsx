import type { Metadata } from 'next'
import { BRAND_NAME, HOST_NAME } from '@/lib/config'
import './globals.css'

export const metadata: Metadata = {
  title: `Book a meeting with ${HOST_NAME}`,
  description: `Pick a day and a time that works for you — ${BRAND_NAME}.`,
}

/**
 * Applies the saved theme before first paint so the page never flashes the
 * wrong background.
 */
const themeScript = `
try {
  if (localStorage.getItem('theme') === 'light') {
    document.documentElement.classList.add('light')
  }
} catch {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

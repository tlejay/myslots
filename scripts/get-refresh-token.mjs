/**
 * Mints a long-lived Google refresh token for this app.
 *
 *   1. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
 *   2. pnpm token
 *   3. Open the printed URL, approve, and copy the token it prints back
 *
 * Nothing is written to disk — paste the token into .env.local yourself.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { google } from 'googleapis'

const PORT = 5789
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

// Minimal .env.local reader — avoids adding a dotenv dependency.
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // file absent — fine, the value may already be exported
    }
  }
}

loadEnv()

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh_token even if you have approved before
  scope: [
    'https://www.googleapis.com/auth/calendar',
    // Lets the app email you when someone books. Google never notifies the
    // account that created an event, so the host would hear nothing otherwise.
    'https://www.googleapis.com/auth/gmail.send',
  ],
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end()
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400).end('Missing ?code')
    return
  }

  try {
    const { tokens } = await oauth2Client.getToken(code)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<p>Done — you can close this tab and go back to the terminal.</p>')

    console.log('\nAdd this to .env.local:\n')
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`)
    if (!tokens.refresh_token) {
      console.log('No refresh token came back. Revoke the app at')
      console.log('https://myaccount.google.com/permissions and run this again.\n')
    }
  } catch (err) {
    res.writeHead(500).end('Token exchange failed — see the terminal.')
    console.error(err)
  } finally {
    server.close()
  }
})

server.listen(PORT, () => {
  console.log(`\nOpen this URL, sign in, and approve:\n\n${authUrl}\n`)
  console.log(`Waiting for the redirect on ${REDIRECT_URI} …`)
})

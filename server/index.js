/**
 * Local / self-hosted entry point: runs schema migrations, then listens.
 * (On Vercel the app is served via api/index.js instead — no listener there,
 * and migrations run once per deploy during the build.)
 */
// Loads ./.env for local dev (no-op when the file doesn't exist, e.g. CI).
import 'dotenv/config'
import app from './app.js'
import { migrate } from './migrate.js'

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'

await migrate()

const server = app.listen(PORT, HOST, () => {
  console.log(`옵문철 게시판 auth server listening on http://${HOST}:${PORT}`)
})
server.on('error', (err) => {
  console.error('Server failed to start:', err)
  process.exit(1)
})

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err)
})

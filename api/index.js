// Vercel serverless entry point. vercel.json rewrites /api/* and /health
// here; the Express app receives the original request URL, so its routes
// (all prefixed with /api, plus /health) match unchanged.
// Schema migrations are NOT run here — they run once per deploy via the
// build command (`npm run db:migrate`), keeping cold starts fast.
import app from '../server/app.js'

export default app

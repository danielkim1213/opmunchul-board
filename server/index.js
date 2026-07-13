import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import db from './db.js'
import {
  fetchPlayerSummary,
  getBestRank,
  isValidBattleTag,
  PlayerNotFoundError,
} from './overfast.js'

const PORT = process.env.PORT || 3001
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
const BCRYPT_ROUNDS = 10

const app = express()
app.use(cors())
app.use(express.json())

const normalize = (battletag) => battletag.trim().toLowerCase()

const findUser = db.prepare('SELECT * FROM users WHERE battletag_key = ?')
const insertUser = db.prepare(`
  INSERT INTO users (battletag_key, battletag, password_hash, rank_label, rank_icon, avatar, created_at)
  VALUES (@battletag_key, @battletag, @password_hash, @rank_label, @rank_icon, @avatar, @created_at)
`)
const insertSession = db.prepare(`
  INSERT INTO sessions (token, battletag_key, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`)
const findSession = db.prepare('SELECT * FROM sessions WHERE token = ?')
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?')

/** Shape a user row for API responses (never expose the password hash). */
function toPublicUser(row) {
  return {
    battletag: row.battletag,
    rankLabel: row.rank_label,
    rankIcon: row.rank_icon,
    avatar: row.avatar,
    createdAt: row.created_at,
  }
}

function createSession(battletagKey) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  insertSession.run(token, battletagKey, now, now + SESSION_TTL_MS)
  return token
}

function authenticate(req) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const session = findSession.get(token)
  if (!session) return null
  if (session.expires_at < Date.now()) {
    deleteSession.run(token)
    return null
  }
  const user = findUser.get(session.battletag_key)
  return user ? { user, token } : null
}

/**
 * Step 2 of the auth flow: given a BattleTag, decide the branch.
 *  - registered  -> client shows the login (password) step
 *  - new + found -> client shows the sign-up step (with verified rank)
 *  - not found   -> 404 (nonexistent OR private profile)
 */
app.post('/api/auth/check', async (req, res) => {
  const battletag = String(req.body?.battletag ?? '').trim()
  if (!isValidBattleTag(battletag)) {
    return res.status(400).json({ error: 'INVALID_BATTLETAG' })
  }

  const existing = findUser.get(normalize(battletag))
  if (existing) {
    return res.json({ status: 'registered', battletag: existing.battletag })
  }

  try {
    const summary = await fetchPlayerSummary(battletag)
    const best = getBestRank(summary)
    return res.json({
      status: 'new',
      battletag,
      rankLabel: best?.label ?? 'Unranked',
      rankIcon: best?.rankIcon ?? null,
      avatar: summary.avatar ?? null,
      title: summary.title ?? null,
    })
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }
    console.error('OverFast lookup failed:', err)
    return res.status(502).json({ error: 'UPSTREAM_ERROR', message: String(err.message ?? err) })
  }
})

app.post('/api/auth/register', async (req, res) => {
  const battletag = String(req.body?.battletag ?? '').trim()
  const password = String(req.body?.password ?? '')

  if (!isValidBattleTag(battletag)) {
    return res.status(400).json({ error: 'INVALID_BATTLETAG' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD' })
  }
  if (findUser.get(normalize(battletag))) {
    return res.status(409).json({ error: 'ALREADY_REGISTERED' })
  }

  // Re-verify against OverFast so the rank is authoritative (not client-supplied).
  let summary
  try {
    summary = await fetchPlayerSummary(battletag)
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }
    return res.status(502).json({ error: 'UPSTREAM_ERROR' })
  }

  const best = getBestRank(summary)
  const row = {
    battletag_key: normalize(battletag),
    battletag,
    password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    rank_label: best?.label ?? 'Unranked',
    rank_icon: best?.rankIcon ?? null,
    avatar: summary.avatar ?? null,
    created_at: Date.now(),
  }
  insertUser.run(row)
  const token = createSession(row.battletag_key)
  return res.status(201).json({ token, user: toPublicUser(row) })
})

app.post('/api/auth/login', async (req, res) => {
  const battletag = String(req.body?.battletag ?? '').trim()
  const password = String(req.body?.password ?? '')

  const user = findUser.get(normalize(battletag))
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND' })
  }
  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    return res.status(401).json({ error: 'BAD_PASSWORD' })
  }
  const token = createSession(user.battletag_key)
  return res.json({ token, user: toPublicUser(user) })
})

app.get('/api/auth/me', (req, res) => {
  const auth = authenticate(req)
  if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })
  return res.json({ user: toPublicUser(auth.user) })
})

app.post('/api/auth/logout', (req, res) => {
  const auth = authenticate(req)
  if (auth) deleteSession.run(auth.token)
  return res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`옵문철 게시판 auth server listening on http://localhost:${PORT}`)
})

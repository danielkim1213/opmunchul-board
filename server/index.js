import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import db from './db.js'
import {
  buildRankProfile,
  isFetchedToday,
  isValidBattleTag,
  PlayerNotFoundError,
} from './overfast.js'

const PORT = process.env.PORT || 3001
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
const BCRYPT_ROUNDS = 10
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || true // true = reflect request origin in dev

const app = express()
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: false,
  }),
)
app.use(express.json())

const normalize = (battletag) => battletag.trim().toLowerCase()

const findUser = db.prepare(`
  SELECT
    battletag_key, battletag, password_hash, rank_label, rank_icon,
    rank_role, most_heroes, avatar, created_at, rank_fetched_at
  FROM users
  WHERE battletag_key = ?
`)
const insertUser = db.prepare(`
  INSERT INTO users (
    battletag_key, battletag, password_hash, rank_label, rank_icon,
    rank_role, most_heroes, avatar, created_at, rank_fetched_at
  )
  VALUES (
    @battletag_key, @battletag, @password_hash, @rank_label, @rank_icon,
    @rank_role, @most_heroes, @avatar, @created_at, @rank_fetched_at
  )
`)
const updateRankDetails = db.prepare(`
  UPDATE users
  SET rank_label = @rank_label,
      rank_icon = @rank_icon,
      rank_role = @rank_role,
      most_heroes = @most_heroes,
      avatar = COALESCE(@avatar, avatar),
      rank_fetched_at = @rank_fetched_at
  WHERE battletag_key = @battletag_key
`)
const insertSession = db.prepare(`
  INSERT INTO sessions (token, battletag_key, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`)
const findSession = db.prepare('SELECT * FROM sessions WHERE token = ?')
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?')

function parseMostHeroes(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toPublicUser(row) {
  return {
    battletag: row.battletag,
    rankLabel: row.rank_label,
    rankIcon: row.rank_icon,
    rankRole: row.rank_role ?? null,
    roleLabel:
      row.rank_role === 'tank'
        ? '탱커'
        : row.rank_role === 'damage'
          ? '딜러'
          : row.rank_role === 'support'
            ? '서포터'
            : null,
    mostHeroes: parseMostHeroes(row.most_heroes),
    avatar: row.avatar,
    createdAt: row.created_at,
    rankFetchedAt: row.rank_fetched_at ?? null,
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
 * Refresh OverFast data at most once per UTC day per account.
 * Later opens the same day read from SQLite only (no OverFast call).
 */
async function ensureDailyRank(user) {
  if (
    isFetchedToday(user.rank_fetched_at) &&
    user.rank_role &&
    user.most_heroes
  ) {
    return user
  }

  const { summary, rank } = await buildRankProfile(user.battletag)
  updateRankDetails.run({
    battletag_key: user.battletag_key,
    rank_label: rank.rankLabel,
    rank_icon: rank.rankIcon,
    rank_role: rank.rankRole,
    most_heroes: JSON.stringify(rank.mostHeroes),
    avatar: summary.avatar ?? null,
    rank_fetched_at: Date.now(),
  })
  return findUser.get(user.battletag_key)
}

app.post('/api/auth/check', async (req, res) => {
  const battletag = String(req.body?.battletag ?? '').trim()
  if (!isValidBattleTag(battletag)) {
    return res.status(400).json({ error: 'INVALID_BATTLETAG' })
  }

  const existing = findUser.get(normalize(battletag))
  if (existing) {
    return res.json({ status: 'registered', battletag: existing.battletag })
  }

  // New signup candidate — one OverFast lookup (queued / rate-limited).
  try {
    const { summary, rank } = await buildRankProfile(battletag)
    return res.json({
      status: 'new',
      battletag,
      rankLabel: rank.rankLabel,
      rankIcon: rank.rankIcon,
      rankRole: rank.rankRole,
      roleLabel: rank.roleLabel,
      mostHeroes: rank.mostHeroes,
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

  // Authoritative re-fetch on the server (queued). Prevents forged client ranks.
  let summary
  let rank
  try {
    ;({ summary, rank } = await buildRankProfile(battletag))
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }
    return res.status(502).json({ error: 'UPSTREAM_ERROR' })
  }

  const now = Date.now()
  const row = {
    battletag_key: normalize(battletag),
    battletag,
    password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    rank_label: rank.rankLabel,
    rank_icon: rank.rankIcon,
    rank_role: rank.rankRole,
    most_heroes: JSON.stringify(rank.mostHeroes),
    avatar: summary.avatar ?? null,
    created_at: now,
    rank_fetched_at: now,
  }
  insertUser.run(row)
  const token = createSession(row.battletag_key)
  return res.status(201).json({ token, user: toPublicUser(row) })
})

app.post('/api/auth/login', async (req, res) => {
  const battletag = String(req.body?.battletag ?? '').trim()
  const password = String(req.body?.password ?? '')

  let user = findUser.get(normalize(battletag))
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND' })
  }
  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    return res.status(401).json({ error: 'BAD_PASSWORD' })
  }

  try {
    user = await ensureDailyRank(user)
  } catch (err) {
    console.warn('Daily rank refresh skipped:', err.message ?? err)
  }

  const token = createSession(user.battletag_key)
  return res.json({ token, user: toPublicUser(user) })
})

app.get('/api/auth/me', async (req, res) => {
  const auth = authenticate(req)
  if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

  let user = auth.user
  try {
    user = await ensureDailyRank(user)
  } catch (err) {
    console.warn('Daily rank refresh skipped:', err.message ?? err)
  }
  return res.json({ user: toPublicUser(user) })
})

app.post('/api/auth/logout', (req, res) => {
  const auth = authenticate(req)
  if (auth) deleteSession.run(auth.token)
  return res.json({ ok: true })
})

const server = app.listen(PORT, () => {
  console.log(`옵문철 게시판 auth server listening on http://localhost:${PORT}`)
})
server.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

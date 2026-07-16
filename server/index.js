import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import db from './db.js'
import {
  buildRankProfile,
  isFetchedToday,
  PlayerNotFoundError,
} from './overfast.js'
import {
  BlizzardOAuthError,
  exchangeCodeForToken,
  fetchBlizzardUser,
  getAuthorizeUrl,
  getSwitchAccountAuthorizeUrl,
  isBlizzardConfigured,
} from './blizzard.js'
import { registerPostRoutes } from './posts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const LINK_TTL_MS = 1000 * 60 * 10
const BCRYPT_ROUNDS = 10
const MIN_PASSWORD_LENGTH = 8
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || true
// Built Vite assets (Docker copies dist → server/public)
const PUBLIC_DIR =
  process.env.PUBLIC_DIR ||
  [join(__dirname, 'public'), join(__dirname, '..', 'dist')].find((p) =>
    existsSync(join(p, 'index.html')),
  )

const app = express()
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: false }))
app.use(express.json())

// username: 3–16 chars, Korean/latin letters, digits, underscore.
const USERNAME_RE = /^[A-Za-z0-9가-힣_]{3,16}$/
const normalizeUsername = (username) => username.trim().toLowerCase()
const normalizeBattletag = (battletag) => battletag.trim().toLowerCase()

function isValidUsername(username) {
  return USERNAME_RE.test(String(username ?? '').trim())
}

const findUser = db.prepare(`
  SELECT
    username_key, username, password_hash, battletag, battletag_key, blizzard_id,
    rank_label, rank_icon, rank_role, most_heroes, avatar, created_at, rank_fetched_at
  FROM users
  WHERE username_key = ?
`)
const findUserByBattletag = db.prepare(
  'SELECT username FROM users WHERE battletag_key = ?',
)
const findOtherUserByBattletag = db.prepare(
  'SELECT username FROM users WHERE battletag_key = ? AND username_key != ?',
)
const insertUser = db.prepare(`
  INSERT INTO users (
    username_key, username, password_hash, battletag, battletag_key, blizzard_id,
    rank_label, rank_icon, rank_role, most_heroes, avatar, created_at, rank_fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateRankDetails = db.prepare(`
  UPDATE users
  SET rank_label = ?,
      rank_icon = ?,
      rank_role = ?,
      most_heroes = ?,
      avatar = COALESCE(?, avatar),
      rank_fetched_at = ?
  WHERE username_key = ?
`)

const updateBattletagLink = db.prepare(`
  UPDATE users
  SET battletag = ?,
      battletag_key = ?,
      blizzard_id = ?,
      rank_label = ?,
      rank_icon = ?,
      rank_role = ?,
      most_heroes = ?,
      avatar = COALESCE(?, avatar),
      rank_fetched_at = ?
  WHERE username_key = ?
`)

const insertSession = db.prepare(`
  INSERT INTO sessions (token, username_key, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`)
const findSession = db.prepare('SELECT * FROM sessions WHERE token = ?')
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?')

const insertLink = db.prepare(`
  INSERT INTO oauth_links (state, status, created_at, expires_at)
  VALUES (?, 'pending', ?, ?)
`)
const findLink = db.prepare('SELECT * FROM oauth_links WHERE state = ?')
const completeLink = db.prepare(`
  UPDATE oauth_links
  SET status = 'linked', battletag = ?, battletag_key = ?, blizzard_id = ?, profile = ?
  WHERE state = ?
`)
const failLink = db.prepare(`
  UPDATE oauth_links SET status = 'error', error = ? WHERE state = ?
`)
const consumeLink = db.prepare('UPDATE oauth_links SET consumed = 1 WHERE state = ?')
const deleteExpiredLinks = db.prepare('DELETE FROM oauth_links WHERE expires_at < ?')

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
    username: row.username,
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

function createSession(usernameKey) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  insertSession.run(token, usernameKey, now, now + SESSION_TTL_MS)
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
  const user = findUser.get(session.username_key)
  return user ? { user, token } : null
}

async function ensureDailyRank(user) {
  if (
    isFetchedToday(user.rank_fetched_at) &&
    user.rank_role &&
    user.most_heroes
  ) {
    return user
  }

  const { summary, rank } = await buildRankProfile(user.battletag)
  updateRankDetails.run(
    rank.rankLabel,
    rank.rankIcon,
    rank.rankRole,
    JSON.stringify(rank.mostHeroes),
    summary.avatar ?? null,
    Date.now(),
    user.username_key,
  )
  return findUser.get(user.username_key)
}

/* ------------------------------------------------------------------ *
 * Username availability
 * ------------------------------------------------------------------ */
app.post('/api/auth/check-username', (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res
      .status(400)
      .json({ error: 'INVALID_USERNAME', available: false })
  }
  const taken = Boolean(findUser.get(normalizeUsername(username)))
  return res.json({ available: !taken, username })
})

/* ------------------------------------------------------------------ *
 * Blizzard OAuth link (register verification)
 * ------------------------------------------------------------------ */
app.get('/api/auth/blizzard/start', (req, res) => {
  if (!isBlizzardConfigured()) {
    return res.status(503).json({ error: 'OAUTH_NOT_CONFIGURED' })
  }
  deleteExpiredLinks.run(Date.now())
  const state = randomBytes(24).toString('hex')
  const now = Date.now()
  insertLink.run(state, now, now + LINK_TTL_MS)
  // `force=1` routes through Battle.net's logout page first so the user
  // gets the credential prompt again instead of silently reusing whichever
  // account is already signed in on this browser (see blizzard.js).
  const force = req.query.force === '1' || req.query.force === 'true'
  const authorizeUrl = force ? getSwitchAccountAuthorizeUrl(state) : getAuthorizeUrl(state)
  return res.json({ state, authorizeUrl })
})

function renderPopupPage(title, message) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,'Noto Sans KR',sans-serif;background:#0a0f1e;color:#e6eaf2;text-align:center}
  .box{padding:32px 28px;max-width:360px}
  h1{font-size:20px;margin:0 0 10px}
  p{color:#93a1b8;font-size:14px;margin:0 0 20px;line-height:1.6}
  button{background:#f99e1a;border:none;border-radius:8px;color:#1a1206;font-weight:700;
    padding:12px 20px;font-size:15px;cursor:pointer}
</style></head>
<body><div class="box">
  <h1>${title}</h1>
  <p>${message}</p>
  <button onclick="window.close()">창 닫기</button>
</div>
<script>setTimeout(function(){window.close()},1500)</script>
</body></html>`
}

app.get('/api/auth/blizzard/callback', async (req, res) => {
  const state = String(req.query.state ?? '')
  const code = String(req.query.code ?? '')
  const link = findLink.get(state)

  res.set('Content-Type', 'text/html; charset=utf-8')

  if (!link || link.expires_at < Date.now()) {
    return res
      .status(400)
      .send(renderPopupPage('연동 실패', '요청이 만료되었어요. 다시 시도해 주세요.'))
  }
  if (req.query.error) {
    failLink.run(String(req.query.error), state)
    return res.send(renderPopupPage('연동 취소됨', 'Blizzard 로그인이 취소되었어요.'))
  }
  if (!code) {
    failLink.run('MISSING_CODE', state)
    return res.status(400).send(renderPopupPage('연동 실패', '인증 코드가 없습니다.'))
  }

  try {
    const token = await exchangeCodeForToken(code)
    const { battletag, blizzardId } = await fetchBlizzardUser(token.access_token)

    let profile = {
      rankLabel: 'Unranked',
      rankIcon: null,
      rankRole: null,
      roleLabel: null,
      mostHeroes: [],
      avatar: null,
      title: null,
    }
    try {
      const { summary, rank } = await buildRankProfile(battletag)
      profile = {
        rankLabel: rank.rankLabel,
        rankIcon: rank.rankIcon,
        rankRole: rank.rankRole,
        roleLabel: rank.roleLabel,
        mostHeroes: rank.mostHeroes,
        avatar: summary.avatar ?? null,
        title: summary.title ?? null,
      }
    } catch (err) {
      // Profile may be private / not found — still allow the link, rank stays Unranked.
      if (!(err instanceof PlayerNotFoundError)) {
        console.warn('Rank lookup during link failed:', err.message ?? err)
      }
    }

    completeLink.run(
      battletag,
      normalizeBattletag(battletag),
      blizzardId,
      JSON.stringify(profile),
      state,
    )
    return res.send(
      renderPopupPage('연동 완료!', `${battletag} 계정이 연동되었어요. 이 창은 자동으로 닫힙니다.`),
    )
  } catch (err) {
    console.error('Blizzard OAuth failed:', err)
    failLink.run(err instanceof BlizzardOAuthError ? err.message : 'OAUTH_ERROR', state)
    return res
      .status(502)
      .send(renderPopupPage('연동 실패', 'Blizzard 인증 중 문제가 발생했어요. 다시 시도해 주세요.'))
  }
})

app.get('/api/auth/blizzard/poll', (req, res) => {
  const state = String(req.query.state ?? '')
  const link = findLink.get(state)
  if (!link) return res.status(404).json({ status: 'unknown' })
  if (link.expires_at < Date.now()) return res.json({ status: 'expired' })
  if (link.status === 'error') {
    return res.json({ status: 'error', message: link.error ?? undefined })
  }
  if (link.status === 'linked' && !link.consumed) {
    let profile = {}
    try {
      profile = JSON.parse(link.profile ?? '{}')
    } catch {
      profile = {}
    }
    return res.json({ status: 'linked', battletag: link.battletag, ...profile })
  }
  return res.json({ status: 'pending' })
})

/**
 * Apply a completed Blizzard link to the *currently logged-in* user.
 * Lets an existing account correct/change which BattleTag it's tied to,
 * without going through registration again.
 */
app.post('/api/auth/blizzard/apply', async (req, res) => {
  const auth = authenticate(req)
  if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

  const state = String(req.body?.state ?? '')
  const link = findLink.get(state)
  if (!link || link.status !== 'linked' || link.consumed) {
    return res.status(400).json({ error: 'LINK_REQUIRED' })
  }
  if (link.expires_at < Date.now()) {
    return res.status(400).json({ error: 'LINK_EXPIRED' })
  }
  const conflict = findOtherUserByBattletag.get(link.battletag_key, auth.user.username_key)
  if (conflict) {
    return res.status(409).json({ error: 'BATTLETAG_TAKEN' })
  }

  let profile
  try {
    profile = JSON.parse(link.profile ?? '{}')
  } catch {
    profile = {}
  }

  updateBattletagLink.run(
    link.battletag,
    link.battletag_key,
    link.blizzard_id ?? null,
    profile.rankLabel ?? 'Unranked',
    profile.rankIcon ?? null,
    profile.rankRole ?? null,
    JSON.stringify(profile.mostHeroes ?? []),
    profile.avatar ?? null,
    Date.now(),
    auth.user.username_key,
  )
  consumeLink.run(state)

  const row = findUser.get(auth.user.username_key)
  return res.json({ user: toPublicUser(row) })
})

/* ------------------------------------------------------------------ *
 * Register / Login
 * ------------------------------------------------------------------ */
app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  const state = String(req.body?.state ?? '')

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME' })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'WEAK_PASSWORD' })
  }

  const usernameKey = normalizeUsername(username)
  if (findUser.get(usernameKey)) {
    return res.status(409).json({ error: 'USERNAME_TAKEN' })
  }

  const link = findLink.get(state)
  if (!link || link.status !== 'linked' || link.consumed) {
    return res.status(400).json({ error: 'LINK_REQUIRED' })
  }
  if (link.expires_at < Date.now()) {
    return res.status(400).json({ error: 'LINK_EXPIRED' })
  }
  if (findUserByBattletag.get(link.battletag_key)) {
    return res.status(409).json({ error: 'BATTLETAG_TAKEN' })
  }

  let profile
  try {
    profile = JSON.parse(link.profile ?? '{}')
  } catch {
    profile = {}
  }

  const now = Date.now()
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  insertUser.run(
    usernameKey,
    username,
    password_hash,
    link.battletag,
    link.battletag_key,
    link.blizzard_id ?? null,
    profile.rankLabel ?? 'Unranked',
    profile.rankIcon ?? null,
    profile.rankRole ?? null,
    JSON.stringify(profile.mostHeroes ?? []),
    profile.avatar ?? null,
    now,
    now,
  )
  consumeLink.run(state)

  const row = findUser.get(usernameKey)
  const token = createSession(usernameKey)
  return res.status(201).json({ token, user: toPublicUser(row) })
})

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  let user = findUser.get(normalizeUsername(username))
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

  const token = createSession(user.username_key)
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

/* ------------------------------------------------------------------ *
 * Board posts (tip / feedback / poll) + comments + votes
 * ------------------------------------------------------------------ */
registerPostRoutes(app, { authenticate })

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true })
})

// Serve the React SPA when a production build is present.
if (PUBLIC_DIR) {
  console.log('Serving frontend from', PUBLIC_DIR)
  app.use(express.static(PUBLIC_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(join(PUBLIC_DIR, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'opmunchul-board-api',
      hint: 'Frontend build not found. Deploy from repo root so Vite dist is included.',
    })
  })
}

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

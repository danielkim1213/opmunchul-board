/**
 * Express app (no listener). Consumed by:
 * - api/index.js  — Vercel serverless function (default export, no listen)
 * - server/index.js — local dev server (app.listen)
 */
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
import { isAdmin } from './admins.js'
import { isBanActive, parseBanDuration, banErrorBody } from './bans.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const LINK_TTL_MS = 1000 * 60 * 10
const BCRYPT_ROUNDS = 10
const MIN_PASSWORD_LENGTH = 8
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || true
// Built Vite assets — only relevant for local/self-hosted serving. On Vercel
// the SPA is served from the CDN, and non-/api routes never reach this app.
const PUBLIC_DIR =
  process.env.PUBLIC_DIR ||
  [join(__dirname, 'public'), join(__dirname, '..', 'dist')].find((p) =>
    existsSync(join(p, 'index.html')),
  )

const app = express()
// Deployed behind a reverse proxy (Vercel) — needed so req.ip reflects the
// real client for per-IP rate limiting instead of the proxy's address.
app.set('trust proxy', 1)
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: false }))
app.use(express.json())

/** Express 4 doesn't forward rejected promises from async handlers to the
 * error middleware — without this wrapper a thrown error leaves the request
 * hanging forever instead of returning a 500. */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/* ------------------------------------------------------------------ *
 * Simple fixed-window rate limiter for credential endpoints
 * (bcrypt endpoints are also CPU-expensive, so this doubles as DoS relief).
 * Note: in-memory, so on serverless it is per-instance — still catches
 * bursts hitting a warm instance, which is the realistic abuse pattern.
 * ------------------------------------------------------------------ */
const rateBuckets = new Map()
function rateLimit(bucket, limit, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`
    const now = Date.now()
    let entry = rateBuckets.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      rateBuckets.set(key, entry)
    }
    entry.count += 1
    if (entry.count > limit) {
      return res.status(429).json({ error: 'RATE_LIMITED' })
    }
    return next()
  }
}
// Keep the bucket map from growing unbounded.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateBuckets) {
    if (entry.resetAt <= now) rateBuckets.delete(key)
  }
}, 60_000).unref()

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
    role, rank_label, rank_icon, rank_role, most_heroes, avatar, created_at, rank_fetched_at
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
    role, rank_label, rank_icon, rank_role, most_heroes, avatar, created_at, rank_fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const promoteUserRole = db.prepare(`
  UPDATE users SET role = 'admin' WHERE username_key = ?
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
const touchRankFetchedAt = db.prepare(`
  UPDATE users SET rank_fetched_at = ? WHERE username_key = ?
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
const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

const findBan = db.prepare('SELECT * FROM banned_battletags WHERE battletag_key = ?')
const upsertBan = db.prepare(`
  INSERT INTO banned_battletags (
    battletag_key, battletag, duration, expires_at, banned_by_username_key, created_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(battletag_key) DO UPDATE SET
    battletag = excluded.battletag,
    duration = excluded.duration,
    expires_at = excluded.expires_at,
    banned_by_username_key = excluded.banned_by_username_key,
    created_at = excluded.created_at
`)
const deleteBan = db.prepare('DELETE FROM banned_battletags WHERE battletag_key = ?')

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
    isAdmin: isAdmin(row),
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

function toModerationUser(row, ban) {
  const banned = isBanActive(ban)
  return {
    username: row.username,
    battletag: row.battletag,
    isAdmin: isAdmin(row),
    isBanned: banned,
    banExpiresAt: banned ? (ban.expires_at ?? null) : null,
    banDuration: banned ? (ban.duration ?? null) : null,
  }
}

async function loadBan(battletagKey) {
  return findBan.get(battletagKey)
}

async function createSession(usernameKey) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  // Opportunistic cleanup — expired sessions are otherwise only removed
  // when their own token is presented, so dead rows would pile up forever.
  await deleteExpiredSessions.run(now)
  await insertSession.run(token, usernameKey, now, now + SESSION_TTL_MS)
  return token
}

async function authenticate(req) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const session = await findSession.get(token)
  if (!session) return null
  if (session.expires_at < Date.now()) {
    await deleteSession.run(token)
    return null
  }
  const user = await findUser.get(session.username_key)
  if (!user) return null
  const ban = await loadBan(user.battletag_key)
  return { user, token, ban: isBanActive(ban) ? ban : null }
}

async function ensureDailyRank(user) {
  // One OverFast round-trip per UTC day, even if the last attempt 404'd or
  // left the profile unranked. Otherwise every page refresh re-hits the API.
  if (isFetchedToday(user.rank_fetched_at)) {
    return user
  }

  try {
    const { summary, rank } = await buildRankProfile(user.battletag)
    await updateRankDetails.run(
      rank.rankLabel,
      rank.rankIcon,
      rank.rankRole,
      JSON.stringify(rank.mostHeroes),
      summary.avatar ?? null,
      Date.now(),
      user.username_key,
    )
    return findUser.get(user.username_key)
  } catch (err) {
    await touchRankFetchedAt.run(Date.now(), user.username_key)
    throw err
  }
}

/* ------------------------------------------------------------------ *
 * Username availability
 * ------------------------------------------------------------------ */
app.post('/api/auth/check-username', rateLimit('check-username', 30, 60_000), asyncRoute(async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res
      .status(400)
      .json({ error: 'INVALID_USERNAME', available: false })
  }
  const taken = Boolean(await findUser.get(normalizeUsername(username)))
  return res.json({ available: !taken, username })
}))

/* ------------------------------------------------------------------ *
 * Blizzard OAuth link (register verification)
 * ------------------------------------------------------------------ */
app.get('/api/auth/blizzard/start', asyncRoute(async (req, res) => {
  if (!isBlizzardConfigured()) {
    return res.status(503).json({ error: 'OAUTH_NOT_CONFIGURED' })
  }
  await deleteExpiredLinks.run(Date.now())
  const state = randomBytes(24).toString('hex')
  const now = Date.now()
  await insertLink.run(state, now, now + LINK_TTL_MS)
  // `force=1` routes through Battle.net's logout page first so the user
  // gets the credential prompt again instead of silently reusing whichever
  // account is already signed in on this browser (see blizzard.js).
  const force = req.query.force === '1' || req.query.force === 'true'
  const authorizeUrl = force ? getSwitchAccountAuthorizeUrl(state) : getAuthorizeUrl(state)
  return res.json({ state, authorizeUrl })
}))

/** Escapes text interpolated into the OAuth popup HTML (e.g. the BattleTag,
 * which comes from an external API and must not be trusted as markup). */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPopupPage(rawTitle, rawMessage) {
  const title = escapeHtml(rawTitle)
  const message = escapeHtml(rawMessage)
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

app.get('/api/auth/blizzard/callback', asyncRoute(async (req, res) => {
  const state = String(req.query.state ?? '')
  const code = String(req.query.code ?? '')
  const link = await findLink.get(state)

  res.set('Content-Type', 'text/html; charset=utf-8')

  if (!link || link.expires_at < Date.now()) {
    return res
      .status(400)
      .send(renderPopupPage('연동 실패', '요청이 만료되었어요. 다시 시도해 주세요.'))
  }
  if (req.query.error) {
    await failLink.run(String(req.query.error), state)
    return res.send(renderPopupPage('연동 취소됨', 'Blizzard 로그인이 취소되었어요.'))
  }
  if (!code) {
    await failLink.run('MISSING_CODE', state)
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

    await completeLink.run(
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
    await failLink.run(err instanceof BlizzardOAuthError ? err.message : 'OAUTH_ERROR', state)
    return res
      .status(502)
      .send(renderPopupPage('연동 실패', 'Blizzard 인증 중 문제가 발생했어요. 다시 시도해 주세요.'))
  }
}))

app.get('/api/auth/blizzard/poll', asyncRoute(async (req, res) => {
  const state = String(req.query.state ?? '')
  const link = await findLink.get(state)
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
}))

/**
 * Apply a completed Blizzard link to the *currently logged-in* user.
 * Lets an existing account correct/change which BattleTag it's tied to,
 * without going through registration again.
 */
app.post('/api/auth/blizzard/apply', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

  const state = String(req.body?.state ?? '')
  const link = await findLink.get(state)
  if (!link || link.status !== 'linked' || link.consumed) {
    return res.status(400).json({ error: 'LINK_REQUIRED' })
  }
  if (link.expires_at < Date.now()) {
    return res.status(400).json({ error: 'LINK_EXPIRED' })
  }
  const conflict = await findOtherUserByBattletag.get(link.battletag_key, auth.user.username_key)
  if (conflict) {
    return res.status(409).json({ error: 'BATTLETAG_TAKEN' })
  }
  const banned = banErrorBody(await loadBan(link.battletag_key))
  if (banned) return res.status(403).json(banned)

  let profile
  try {
    profile = JSON.parse(link.profile ?? '{}')
  } catch {
    profile = {}
  }

  await updateBattletagLink.run(
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
  await consumeLink.run(state)

  const row = await findUser.get(auth.user.username_key)
  return res.json({ user: toPublicUser(row) })
}))

/* ------------------------------------------------------------------ *
 * Register / Login
 * ------------------------------------------------------------------ */
app.post('/api/auth/register', rateLimit('register', 10, 60_000), asyncRoute(async (req, res) => {
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
  if (await findUser.get(usernameKey)) {
    return res.status(409).json({ error: 'USERNAME_TAKEN' })
  }

  const link = await findLink.get(state)
  if (!link || link.status !== 'linked' || link.consumed) {
    return res.status(400).json({ error: 'LINK_REQUIRED' })
  }
  if (link.expires_at < Date.now()) {
    return res.status(400).json({ error: 'LINK_EXPIRED' })
  }
  if (await findUserByBattletag.get(link.battletag_key)) {
    return res.status(409).json({ error: 'BATTLETAG_TAKEN' })
  }
  const banned = banErrorBody(await loadBan(link.battletag_key))
  if (banned) return res.status(403).json(banned)

  let profile
  try {
    profile = JSON.parse(link.profile ?? '{}')
  } catch {
    profile = {}
  }

  const now = Date.now()
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  try {
    await insertUser.run(
      usernameKey,
      username,
      password_hash,
      link.battletag,
      link.battletag_key,
      link.blizzard_id ?? null,
      'user',
      profile.rankLabel ?? 'Unranked',
      profile.rankIcon ?? null,
      profile.rankRole ?? null,
      JSON.stringify(profile.mostHeroes ?? []),
      profile.avatar ?? null,
      now,
      now,
    )
  } catch (err) {
    // The pre-insert checks above race with concurrent registrations; the
    // UNIQUE constraints are the real gate, so map them to a clean 409.
    const message = String(err?.message ?? '')
    if (message.includes('UNIQUE')) {
      return res
        .status(409)
        .json({ error: message.includes('battletag_key') ? 'BATTLETAG_TAKEN' : 'USERNAME_TAKEN' })
    }
    throw err
  }
  await consumeLink.run(state)

  const row = await findUser.get(usernameKey)
  const token = await createSession(usernameKey)
  return res.status(201).json({ token, user: toPublicUser(row) })
}))

// A fixed hash to compare against when the username doesn't exist, so the
// response takes the same time either way (prevents timing-based
// username enumeration).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS)

app.post('/api/auth/login', rateLimit('login', 10, 60_000), asyncRoute(async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  let user = await findUser.get(normalizeUsername(username))
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH)
  if (!user || !ok) {
    // Deliberately identical for "no such user" and "wrong password" —
    // distinct codes let attackers enumerate registered usernames.
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' })
  }

  try {
    user = await ensureDailyRank(user)
  } catch (err) {
    console.warn('Daily rank refresh skipped:', err.message ?? err)
  }

  const token = await createSession(user.username_key)
  return res.json({ token, user: toPublicUser(user) })
}))

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

  let user = auth.user
  try {
    user = await ensureDailyRank(user)
  } catch (err) {
    console.warn('Daily rank refresh skipped:', err.message ?? err)
  }
  return res.json({ user: toPublicUser(user) })
}))

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (auth) await deleteSession.run(auth.token)
  return res.json({ ok: true })
}))

/* ------------------------------------------------------------------ *
 * Admin: look up / promote / ban (BattleTag-keyed, timed or permanent)
 * ------------------------------------------------------------------ */
function requireAdmin(auth, res) {
  if (!auth) {
    res.status(401).json({ error: 'UNAUTHENTICATED' })
    return false
  }
  if (!isAdmin(auth.user)) {
    res.status(403).json({ error: 'ADMIN_ONLY' })
    return false
  }
  return true
}

app.get('/api/admin/user', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!requireAdmin(auth, res)) return

  const username = String(req.query.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME' })
  }

  const target = await findUser.get(normalizeUsername(username))
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' })

  const ban = await loadBan(target.battletag_key)
  return res.json({ user: toModerationUser(target, ban) })
}))

app.post('/api/admin/promote', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!requireAdmin(auth, res)) return

  const username = String(req.body?.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME' })
  }

  const targetKey = normalizeUsername(username)
  const target = await findUser.get(targetKey)
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' })
  if (target.username_key === auth.user.username_key) {
    return res.status(400).json({ error: 'CANNOT_MODERATE_SELF' })
  }

  if (!isAdmin(target)) {
    await promoteUserRole.run(targetKey)
  }

  const row = await findUser.get(targetKey)
  const ban = await loadBan(row.battletag_key)
  return res.json({ user: toModerationUser(row, ban) })
}))

app.post('/api/admin/ban', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!requireAdmin(auth, res)) return

  const username = String(req.body?.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME' })
  }
  const parsed = parseBanDuration(req.body?.duration)
  if (!parsed) {
    return res.status(400).json({ error: 'INVALID_BAN_DURATION' })
  }

  const target = await findUser.get(normalizeUsername(username))
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' })
  if (target.username_key === auth.user.username_key) {
    return res.status(400).json({ error: 'CANNOT_MODERATE_SELF' })
  }
  if (isAdmin(target)) {
    return res.status(403).json({ error: 'CANNOT_BAN_ADMIN' })
  }

  await upsertBan.run(
    target.battletag_key,
    target.battletag,
    parsed.key,
    parsed.expiresAt,
    auth.user.username_key,
    Date.now(),
  )

  const ban = await loadBan(target.battletag_key)
  return res.json({ user: toModerationUser(target, ban) })
}))

app.post('/api/admin/unban', asyncRoute(async (req, res) => {
  const auth = await authenticate(req)
  if (!requireAdmin(auth, res)) return

  const username = String(req.body?.username ?? '').trim()
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME' })
  }

  const target = await findUser.get(normalizeUsername(username))
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' })
  if (target.username_key === auth.user.username_key) {
    return res.status(400).json({ error: 'CANNOT_MODERATE_SELF' })
  }

  await deleteBan.run(target.battletag_key)
  return res.json({ user: toModerationUser(target, null) })
}))

/* ------------------------------------------------------------------ *
 * Board posts (tip / feedback / poll) + comments + votes
 * ------------------------------------------------------------------ */
registerPostRoutes(app, { authenticate })

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true })
})

// Serve the React SPA when a production build is present (local/self-hosted
// only — Vercel serves the static build from its CDN instead).
if (PUBLIC_DIR) {
  console.log('Serving frontend from', PUBLIC_DIR)
  app.use(express.static(PUBLIC_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(join(PUBLIC_DIR, 'index.html'))
  })
}

// Final error handler — returns JSON instead of Express's default HTML page
// (covers body-parser failures and anything thrown/rejected in routes).
// The 4-arg signature is required for Express to treat it as an error handler.
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'INVALID_BODY' })
  }
  console.error('Unhandled route error:', err)
  if (res.headersSent) return
  return res.status(500).json({ error: 'INTERNAL_ERROR' })
})

export default app

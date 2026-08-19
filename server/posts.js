// Board posts: 'tip' (plain discussion), 'feedback' (VOD review w/ timestamped
// comments), 'poll' (single-choice vote). All three share the same table with
// nullable type-specific columns; comments/votes are gated by allowed_tiers.
import { randomUUID } from 'node:crypto'
import db from './db.js'
import { isAdmin } from './admins.js'
import { isTierAllowed, isValidTierKey, parseAllowedTiers, TIER_ORDER } from './tiers.js'

const TITLE_MAX = 100
const TIP_BODY_MAX = 2000
const FEEDBACK_NOTE_MAX = 500
const COMMENT_MAX = 500
const POLL_OPTION_MAX = 40
const POLL_MIN_OPTIONS = 2
const POLL_MAX_OPTIONS = 5
const LIST_DEFAULT_LIMIT = 20
const LIST_MAX_LIMIT = 50

const POST_TYPES = ['tip', 'feedback', 'poll']

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/

/** Same promise-forwarding wrapper as app.js — Express 4 doesn't route
 * rejected promises from async handlers to the error middleware. */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function extractYoutubeId(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return null
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1)
      return YOUTUBE_ID_RE.test(id) ? id : null
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v')
      if (v && YOUTUBE_ID_RE.test(v)) return v
      const match = url.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/)
      if (match) return match[1]
    }
  } catch {
    return null
  }
  return null
}

// Raw SQL kept separate where it's also needed inside db.batch() transactions.
const INSERT_POST_SQL = `
  INSERT INTO posts (
    id, type, title, body, author_username_key, allowed_tiers,
    replay_code, youtube_id, hero, team_side, is_notice, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
const INSERT_OPTION_SQL = `
  INSERT INTO post_poll_options (id, post_id, label, order_index) VALUES (?, ?, ?, ?)
`

const insertPost = db.prepare(INSERT_POST_SQL)
const updatePostRow = db.prepare(`
  UPDATE posts
  SET title = ?, body = ?, allowed_tiers = ?, replay_code = ?, youtube_id = ?, hero = ?, team_side = ?, is_notice = ?, updated_at = ?
  WHERE id = ?
`)
const findPostRow = db.prepare('SELECT * FROM posts WHERE id = ?')
// Author's battletag is intentionally not selected here — posts/comments
// are public, and this is a pseudonymous board, so only `username` (the
// account handle the user picked) is ever shown to other members.
// Page first (LIMIT/OFFSET), then aggregate only those rows — avoids N+1
// and keeps correlated COUNTs bounded to one page (see idx_posts_*).
const listPostsPaged = db.prepare(`
  WITH paged_posts AS (
    SELECT p.*
    FROM posts p
    WHERE (? IS NULL OR p.type = ?)
    ORDER BY p.is_notice DESC, p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  )
  SELECT
    p.*,
    u.username, u.role, u.rank_label, u.rank_icon, u.rank_role, u.most_heroes,
    CASE
      WHEN p.type IN ('tip', 'feedback') THEN (
        SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id
      )
      ELSE 0
    END AS comment_count,
    CASE
      WHEN p.type = 'poll' THEN (
        SELECT COUNT(*) FROM post_poll_options o WHERE o.post_id = p.id
      )
      ELSE 0
    END AS option_count,
    CASE
      WHEN p.type = 'poll' THEN (
        SELECT COUNT(*) FROM post_poll_votes v WHERE v.post_id = p.id
      )
      ELSE 0
    END AS vote_count
  FROM paged_posts p
  JOIN users u ON u.username_key = p.author_username_key
  ORDER BY p.is_notice DESC, p.created_at DESC, p.id DESC
`)
const countPosts = db.prepare(`
  SELECT COUNT(*) AS n FROM posts WHERE (? IS NULL OR type = ?)
`)
const findPostWithAuthor = db.prepare(`
  SELECT p.*, u.username, u.role, u.rank_label, u.rank_icon, u.rank_role, u.most_heroes
  FROM posts p
  JOIN users u ON u.username_key = p.author_username_key
  WHERE p.id = ?
`)

const countComments = db.prepare('SELECT COUNT(*) AS n FROM post_comments WHERE post_id = ?')

// One aggregated query per poll instead of a COUNT per option (N+1).
const listOptionsWithVotes = db.prepare(`
  SELECT o.id, o.label, COUNT(v.username_key) AS votes
  FROM post_poll_options o
  LEFT JOIN post_poll_votes v ON v.option_id = o.id
  WHERE o.post_id = ?
  GROUP BY o.id
  ORDER BY o.order_index ASC
`)
const findOption = db.prepare('SELECT * FROM post_poll_options WHERE id = ?')
const findMyVote = db.prepare(
  'SELECT option_id FROM post_poll_votes WHERE post_id = ? AND username_key = ?',
)
const upsertVote = db.prepare(`
  INSERT INTO post_poll_votes (post_id, option_id, username_key, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(post_id, username_key) DO UPDATE SET
    option_id = excluded.option_id,
    created_at = excluded.created_at
`)
const deleteVote = db.prepare(
  'DELETE FROM post_poll_votes WHERE post_id = ? AND username_key = ?',
)

const insertComment = db.prepare(`
  INSERT INTO post_comments (id, post_id, parent_id, username_key, timestamp_seconds, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const updateCommentRow = db.prepare('UPDATE post_comments SET content = ?, updated_at = ? WHERE id = ?')
const findComment = db.prepare('SELECT * FROM post_comments WHERE id = ?')
// Upvote count and the viewer's own upvote are folded into the listing query
// so rendering a thread costs one query instead of 2 per comment (N+1).
const listComments = db.prepare(`
  SELECT
    c.*, u.username, u.role, u.rank_label, u.rank_icon, u.rank_role, u.most_heroes,
    (SELECT COUNT(*) FROM post_comment_upvotes v WHERE v.comment_id = c.id) AS upvote_count,
    EXISTS(
      SELECT 1 FROM post_comment_upvotes v
      WHERE v.comment_id = c.id AND v.username_key = ?
    ) AS upvoted_by_me
  FROM post_comments c
  JOIN users u ON u.username_key = c.username_key
  WHERE c.post_id = ?
  ORDER BY c.created_at ASC
`)
const countUpvotes = db.prepare('SELECT COUNT(*) AS n FROM post_comment_upvotes WHERE comment_id = ?')
const hasUpvoted = db.prepare(
  'SELECT 1 FROM post_comment_upvotes WHERE comment_id = ? AND username_key = ?',
)
const addUpvote = db.prepare(
  'INSERT OR IGNORE INTO post_comment_upvotes (comment_id, username_key) VALUES (?, ?)',
)
const removeUpvote = db.prepare(
  'DELETE FROM post_comment_upvotes WHERE comment_id = ? AND username_key = ?',
)

/* ------------------------------------------------------------------ *
 * Explicit cascading deletes.
 * Turso/libSQL leaves PRAGMA foreign_keys OFF (per-connection, not settable
 * reliably over the HTTP driver), so the schema's ON DELETE CASCADE clauses
 * never fire in production. Each delete below removes children explicitly,
 * atomically, in one transaction.
 * ------------------------------------------------------------------ */

function deletePostCascade(postId) {
  return db.batch([
    {
      sql: `DELETE FROM post_comment_upvotes
            WHERE comment_id IN (SELECT id FROM post_comments WHERE post_id = ?)`,
      args: [postId],
    },
    { sql: 'DELETE FROM post_comments WHERE post_id = ?', args: [postId] },
    { sql: 'DELETE FROM post_poll_votes WHERE post_id = ?', args: [postId] },
    { sql: 'DELETE FROM post_poll_options WHERE post_id = ?', args: [postId] },
    { sql: 'DELETE FROM posts WHERE id = ?', args: [postId] },
  ])
}

// Recursive CTE collects the comment plus all (arbitrarily nested) replies.
const COMMENT_TREE_CTE = `
  WITH RECURSIVE tree(id) AS (
    SELECT ?
    UNION ALL
    SELECT c.id FROM post_comments c JOIN tree ON c.parent_id = tree.id
  )
`

function deleteCommentCascade(commentId) {
  return db.batch([
    {
      sql: `${COMMENT_TREE_CTE}
            DELETE FROM post_comment_upvotes WHERE comment_id IN (SELECT id FROM tree)`,
      args: [commentId],
    },
    {
      sql: `${COMMENT_TREE_CTE}
            DELETE FROM post_comments WHERE id IN (SELECT id FROM tree)`,
      args: [commentId],
    },
  ])
}

function roleLabelOf(rankRole) {
  return rankRole === 'tank'
    ? '탱커'
    : rankRole === 'damage'
      ? '딜러'
      : rankRole === 'support'
        ? '서포터'
        : null
}

function parseMostHeroes(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toPublicAuthor(row) {
  return {
    username: row.username,
    isAdmin: isAdmin(row),
    rankLabel: row.rank_label,
    rankIcon: row.rank_icon,
    roleLabel: roleLabelOf(row.rank_role),
    mostHeroes: parseMostHeroes(row.most_heroes),
  }
}

async function pollSummary(postId, viewerKey) {
  const options = (await listOptionsWithVotes.all(postId)).map((o) => ({
    id: o.id,
    label: o.label,
    votes: o.votes,
  }))
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0)
  const myVote = viewerKey ? await findMyVote.get(postId, viewerKey) : null
  return { options, totalVotes, myOptionId: myVote?.option_id ?? null }
}

/** Shared summary fields for both list rows and single-post detail. */
function toPublicPostBase(row, viewerRankLabel, viewerKey, viewerIsAdmin = false) {
  const allowedTiers = parseAllowedTiers(row.allowed_tiers)
  const isMine = viewerKey ? row.author_username_key === viewerKey : false
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    author: toPublicAuthor(row),
    allowedTiers,
    viewerEligible: isTierAllowed(viewerRankLabel, allowedTiers),
    isNotice: Boolean(row.is_notice),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    isMine,
    /** Admins may delete any post (moderation); editing stays author-only. */
    canDelete: isMine || viewerIsAdmin,
  }
}

function toPublicPostSummary(row, viewerRankLabel, viewerKey, viewerIsAdmin = false) {
  const base = toPublicPostBase(row, viewerRankLabel, viewerKey, viewerIsAdmin)
  // Aggregates come from listPostsPaged — no per-row queries / myOptionId
  // (list UI only shows optionCount + voteCount).
  if (row.type === 'poll') {
    return { ...base, optionCount: row.option_count ?? 0, voteCount: row.vote_count ?? 0 }
  }
  return {
    ...base,
    commentCount: row.comment_count ?? 0,
    ...(row.type === 'feedback'
      ? { youtubeId: row.youtube_id, hero: row.hero, teamSide: row.team_side, replayCode: row.replay_code }
      : {}),
  }
}

async function toPublicPostDetail(row, viewerRankLabel, viewerKey, viewerIsAdmin = false) {
  const base = toPublicPostBase(row, viewerRankLabel, viewerKey, viewerIsAdmin)
  if (row.type === 'tip') {
    return { ...base, body: row.body, commentCount: (await countComments.get(row.id)).n }
  }
  if (row.type === 'feedback') {
    return {
      ...base,
      body: row.body,
      replayCode: row.replay_code,
      youtubeId: row.youtube_id,
      hero: row.hero,
      teamSide: row.team_side,
      commentCount: (await countComments.get(row.id)).n,
    }
  }
  // poll
  const { options, totalVotes, myOptionId } = await pollSummary(row.id, viewerKey)
  return { ...base, options, totalVotes, myOptionId }
}

/** Rows must carry upvote_count / upvoted_by_me (listComments does; handlers
 * that build rows manually fill them in before calling this). */
function toPublicComment(row, viewerKey, viewerIsAdmin = false) {
  return {
    id: row.id,
    parentId: row.parent_id,
    timestampSeconds: row.timestamp_seconds,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    author: toPublicAuthor(row),
    upvotes: row.upvote_count ?? 0,
    upvotedByMe: Boolean(row.upvoted_by_me),
    isMine: viewerKey ? row.username_key === viewerKey : false,
    canDelete: (viewerKey ? row.username_key === viewerKey : false) || viewerIsAdmin,
  }
}

function sanitizeAllowedTiers(raw) {
  if (!Array.isArray(raw)) return []
  // Accept legacy "ultimate" from older clients, store as "champion".
  const unique = [
    ...new Set(
      raw.map((key) => (key === 'ultimate' ? 'champion' : key)).filter(isValidTierKey),
    ),
  ]
  return TIER_ORDER.filter((t) => unique.includes(t))
}

/**
 * @param {import('express').Express} app
 * @param {{ authenticate: (req: import('express').Request) => Promise<{ user: any, token: string } | null> }} deps
 */
export function registerPostRoutes(app, { authenticate }) {
  app.get('/api/posts', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    const typeFilter = POST_TYPES.includes(req.query.type) ? req.query.type : null

    let limit = Number.parseInt(String(req.query.limit ?? LIST_DEFAULT_LIMIT), 10)
    if (!Number.isFinite(limit) || limit < 1) limit = LIST_DEFAULT_LIMIT
    if (limit > LIST_MAX_LIMIT) limit = LIST_MAX_LIMIT

    let page = Number.parseInt(String(req.query.page ?? '1'), 10)
    if (!Number.isFinite(page) || page < 1) page = 1

    const total = (await countPosts.get(typeFilter, typeFilter)).n
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
    if (totalPages > 0 && page > totalPages) page = totalPages
    const offset = (page - 1) * limit

    const rows = await listPostsPaged.all(typeFilter, typeFilter, limit, offset)
    const viewerRankLabel = auth?.user.rank_label ?? null
    const viewerKey = auth?.user.username_key ?? null
    const viewerIsAdmin = isAdmin(auth?.user)
    return res.json({
      posts: rows.map((r) => toPublicPostSummary(r, viewerRankLabel, viewerKey, viewerIsAdmin)),
      page,
      limit,
      total,
      totalPages,
    })
  }))

  app.get('/api/posts/:id', asyncRoute(async (req, res) => {
    const row = await findPostWithAuthor.get(req.params.id)
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' })

    const auth = await authenticate(req)
    const post = await toPublicPostDetail(
      row,
      auth?.user.rank_label ?? null,
      auth?.user.username_key ?? null,
      isAdmin(auth?.user),
    )
    return res.json({ post })
  }))

  app.post('/api/posts', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const type = String(req.body?.type ?? '')
    if (!POST_TYPES.includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' })

    const title = String(req.body?.title ?? '').trim()
    if (!title) return res.status(400).json({ error: 'EMPTY_TITLE' })
    if (title.length > TITLE_MAX) return res.status(400).json({ error: 'TITLE_TOO_LONG' })

    const allowedTiers = type === 'tip' ? [] : sanitizeAllowedTiers(req.body?.allowedTiers)

    // Notice posts are pinned to the top of the list — admin only.
    const isNotice = Boolean(req.body?.isNotice)
    if (isNotice && !isAdmin(auth.user)) {
      return res.status(403).json({ error: 'ADMIN_ONLY' })
    }
    const noticeFlag = isNotice ? 1 : 0

    const id = randomUUID()
    const createdAt = Date.now()

    if (type === 'tip') {
      const body = String(req.body?.body ?? '').trim()
      if (!body) return res.status(400).json({ error: 'EMPTY_BODY' })
      if (body.length > TIP_BODY_MAX) return res.status(400).json({ error: 'BODY_TOO_LONG' })

      await insertPost.run(id, type, title, body, auth.user.username_key, null, null, null, null, null, noticeFlag, createdAt)
    } else if (type === 'feedback') {
      const body = String(req.body?.body ?? '').trim()
      // Replay code is a nice-to-have, not required — plenty of feedback
      // requests are asked from an already-expired replay.
      const replayCode = String(req.body?.replayCode ?? '').trim() || null
      const hero = String(req.body?.hero ?? '').trim()
      const teamSide = req.body?.teamSide === 'blue' ? 'blue' : 'red'
      const youtubeId = extractYoutubeId(req.body?.youtubeUrl ?? req.body?.youtubeId)

      if (!body) return res.status(400).json({ error: 'EMPTY_BODY' })
      if (body.length > FEEDBACK_NOTE_MAX) return res.status(400).json({ error: 'BODY_TOO_LONG' })
      if (!hero) return res.status(400).json({ error: 'EMPTY_HERO' })
      if (!youtubeId) return res.status(400).json({ error: 'INVALID_YOUTUBE_URL' })

      await insertPost.run(
        id,
        type,
        title,
        body,
        auth.user.username_key,
        JSON.stringify(allowedTiers),
        replayCode,
        youtubeId,
        hero,
        teamSide,
        noticeFlag,
        createdAt,
      )
    } else {
      // poll
      const rawOptions = Array.isArray(req.body?.options) ? req.body.options : []
      const options = rawOptions.map((o) => String(o ?? '').trim()).filter(Boolean)
      if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
        return res.status(400).json({ error: 'INVALID_OPTION_COUNT' })
      }
      if (options.some((o) => o.length > POLL_OPTION_MAX)) {
        return res.status(400).json({ error: 'OPTION_TOO_LONG' })
      }

      // Post + options must land together — a failure halfway through would
      // otherwise leave a poll with no (or missing) options.
      await db.batch([
        {
          sql: INSERT_POST_SQL,
          args: [
            id,
            type,
            title,
            null,
            auth.user.username_key,
            JSON.stringify(allowedTiers),
            null,
            null,
            null,
            null,
            noticeFlag,
            createdAt,
          ],
        },
        ...options.map((label, index) => ({
          sql: INSERT_OPTION_SQL,
          args: [randomUUID(), id, label, index],
        })),
      ])
    }

    const row = await findPostWithAuthor.get(id)
    return res.status(201).json({
      post: await toPublicPostDetail(row, auth.user.rank_label, auth.user.username_key, isAdmin(auth.user)),
    })
  }))

  app.patch('/api/posts/:id', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const row = await findPostRow.get(req.params.id)
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' })
    if (row.author_username_key !== auth.user.username_key) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : row.title
    if (!title) return res.status(400).json({ error: 'EMPTY_TITLE' })
    if (title.length > TITLE_MAX) return res.status(400).json({ error: 'TITLE_TOO_LONG' })

    const allowedTiers =
      row.type === 'tip'
        ? []
        : req.body?.allowedTiers !== undefined
          ? sanitizeAllowedTiers(req.body.allowedTiers)
          : parseAllowedTiers(row.allowed_tiers)

    let body = row.body
    let replayCode = row.replay_code
    let youtubeId = row.youtube_id
    let hero = row.hero
    let teamSide = row.team_side

    if (row.type === 'tip' || row.type === 'feedback') {
      const bodyMax = row.type === 'tip' ? TIP_BODY_MAX : FEEDBACK_NOTE_MAX
      body = req.body?.body !== undefined ? String(req.body.body).trim() : row.body
      if (!body) return res.status(400).json({ error: 'EMPTY_BODY' })
      if (body.length > bodyMax) return res.status(400).json({ error: 'BODY_TOO_LONG' })
    }

    if (row.type === 'feedback') {
      // Replay code stays optional on edit too.
      replayCode =
        req.body?.replayCode !== undefined ? String(req.body.replayCode).trim() || null : row.replay_code
      hero = req.body?.hero !== undefined ? String(req.body.hero).trim() : row.hero
      if (!hero) return res.status(400).json({ error: 'EMPTY_HERO' })
      teamSide = req.body?.teamSide === 'blue' ? 'blue' : req.body?.teamSide === 'red' ? 'red' : row.team_side
      if (req.body?.youtubeUrl !== undefined) {
        const parsed = extractYoutubeId(req.body.youtubeUrl)
        if (!parsed) return res.status(400).json({ error: 'INVALID_YOUTUBE_URL' })
        youtubeId = parsed
      }
    }
    // poll: options are intentionally not editable once created (keeps
    // existing votes meaningful) — only title/allowedTiers change above.

    let noticeFlag = row.is_notice ? 1 : 0
    if (req.body?.isNotice !== undefined) {
      const wantNotice = Boolean(req.body.isNotice)
      if (wantNotice !== Boolean(row.is_notice) && !isAdmin(auth.user)) {
        return res.status(403).json({ error: 'ADMIN_ONLY' })
      }
      noticeFlag = wantNotice ? 1 : 0
    }

    await updatePostRow.run(
      title,
      body,
      JSON.stringify(allowedTiers),
      replayCode,
      youtubeId,
      hero,
      teamSide,
      noticeFlag,
      Date.now(),
      row.id,
    )

    const updated = await findPostWithAuthor.get(row.id)
    return res.json({
      post: await toPublicPostDetail(updated, auth.user.rank_label, auth.user.username_key, isAdmin(auth.user)),
    })
  }))

  app.delete('/api/posts/:id', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const row = await findPostRow.get(req.params.id)
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' })
    // Admins may delete any post (moderation power).
    if (row.author_username_key !== auth.user.username_key && !isAdmin(auth.user)) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    await deletePostCascade(row.id)
    return res.json({ ok: true })
  }))

  app.get('/api/posts/:id/comments', asyncRoute(async (req, res) => {
    const post = await findPostRow.get(req.params.id)
    if (!post) return res.status(404).json({ error: 'NOT_FOUND' })
    if (post.type === 'poll') return res.status(400).json({ error: 'COMMENTS_NOT_SUPPORTED' })

    const auth = await authenticate(req)
    const viewerKey = auth?.user.username_key ?? null
    const viewerIsAdmin = isAdmin(auth?.user)
    const rows = await listComments.all(viewerKey, post.id)
    const flat = rows.map((r) => ({ ...toPublicComment(r, viewerKey, viewerIsAdmin), replies: [] }))

    // Builds the reply tree at arbitrary depth in one pass (rows are in
    // created_at order, and a parent is always created before its replies).
    const byId = new Map(flat.map((c) => [c.id, c]))
    const top = []
    for (const c of flat) {
      if (c.parentId && byId.has(c.parentId)) {
        byId.get(c.parentId).replies.push(c)
      } else {
        top.push(c)
      }
    }
    return res.json({ comments: top })
  }))

  app.post('/api/posts/:id/comments', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const post = await findPostRow.get(req.params.id)
    if (!post) return res.status(404).json({ error: 'NOT_FOUND' })
    if (post.type === 'poll') return res.status(400).json({ error: 'COMMENTS_NOT_SUPPORTED' })

    const allowedTiers = parseAllowedTiers(post.allowed_tiers)
    if (!isTierAllowed(auth.user.rank_label, allowedTiers)) {
      return res.status(403).json({ error: 'TIER_NOT_ALLOWED' })
    }

    const content = String(req.body?.content ?? '').trim()
    const parentId = req.body?.parentId ? String(req.body.parentId) : null

    // Omitted/null timestamp = "global" feedback not tied to a moment. Tip
    // posts never carry a timestamp regardless of what's sent.
    let timestampSeconds = null
    if (post.type === 'feedback') {
      const rawTimestamp = req.body?.timestampSeconds
      const isGlobal = rawTimestamp === null || rawTimestamp === undefined || rawTimestamp === ''
      if (!isGlobal) {
        // Only numbers / numeric strings — Number() would otherwise coerce
        // booleans and arrays into "valid" timestamps.
        if (typeof rawTimestamp !== 'number' && typeof rawTimestamp !== 'string') {
          return res.status(400).json({ error: 'INVALID_TIMESTAMP' })
        }
        timestampSeconds = Math.round(Number(rawTimestamp))
        if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
          return res.status(400).json({ error: 'INVALID_TIMESTAMP' })
        }
      }
    }

    if (!content) return res.status(400).json({ error: 'EMPTY_CONTENT' })
    if (content.length > COMMENT_MAX) return res.status(400).json({ error: 'CONTENT_TOO_LONG' })

    // Replies can nest at any depth — the only requirement is that the
    // parent exists and belongs to the same post.
    if (parentId) {
      const parent = await findComment.get(parentId)
      if (!parent || parent.post_id !== post.id) {
        return res.status(400).json({ error: 'INVALID_PARENT' })
      }
    }

    const id = randomUUID()
    const createdAt = Date.now()
    await insertComment.run(id, post.id, parentId, auth.user.username_key, timestampSeconds, content, createdAt)

    const withAuthor = {
      id,
      username_key: auth.user.username_key,
      parent_id: parentId,
      timestamp_seconds: timestampSeconds,
      content,
      created_at: createdAt,
      updated_at: null,
      upvote_count: 0,
      upvoted_by_me: 0,
      username: auth.user.username,
      role: auth.user.role,
      rank_label: auth.user.rank_label,
      rank_icon: auth.user.rank_icon,
      rank_role: auth.user.rank_role,
      most_heroes: auth.user.most_heroes,
    }
    return res.status(201).json({
      comment: {
        ...toPublicComment(withAuthor, auth.user.username_key, isAdmin(auth.user)),
        replies: [],
      },
    })
  }))

  app.patch('/api/posts/comments/:id', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const comment = await findComment.get(req.params.id)
    if (!comment) return res.status(404).json({ error: 'NOT_FOUND' })
    if (comment.username_key !== auth.user.username_key) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const content = String(req.body?.content ?? '').trim()
    if (!content) return res.status(400).json({ error: 'EMPTY_CONTENT' })
    if (content.length > COMMENT_MAX) return res.status(400).json({ error: 'CONTENT_TOO_LONG' })

    await updateCommentRow.run(content, Date.now(), comment.id)

    const row = await findComment.get(comment.id)
    const withAuthor = {
      ...row,
      upvote_count: (await countUpvotes.get(comment.id)).n,
      upvoted_by_me: Boolean(await hasUpvoted.get(comment.id, auth.user.username_key)),
      username: auth.user.username,
      role: auth.user.role,
      rank_label: auth.user.rank_label,
      rank_icon: auth.user.rank_icon,
      rank_role: auth.user.rank_role,
      most_heroes: auth.user.most_heroes,
    }
    return res.json({
      comment: toPublicComment(withAuthor, auth.user.username_key, isAdmin(auth.user)),
    })
  }))

  app.delete('/api/posts/comments/:id', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const comment = await findComment.get(req.params.id)
    if (!comment) return res.status(404).json({ error: 'NOT_FOUND' })
    // Admins may delete any comment (moderation power).
    if (comment.username_key !== auth.user.username_key && !isAdmin(auth.user)) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    await deleteCommentCascade(comment.id)
    return res.json({ ok: true })
  }))

  app.post('/api/posts/comments/:id/upvote', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const comment = await findComment.get(req.params.id)
    if (!comment) return res.status(404).json({ error: 'NOT_FOUND' })
    const post = await findPostRow.get(comment.post_id)
    if (!post) return res.status(404).json({ error: 'NOT_FOUND' })

    const allowedTiers = parseAllowedTiers(post.allowed_tiers)
    if (!isTierAllowed(auth.user.rank_label, allowedTiers)) {
      return res.status(403).json({ error: 'TIER_NOT_ALLOWED' })
    }

    const already = Boolean(await hasUpvoted.get(comment.id, auth.user.username_key))
    if (already) {
      await removeUpvote.run(comment.id, auth.user.username_key)
    } else {
      await addUpvote.run(comment.id, auth.user.username_key)
    }
    return res.json({
      upvotes: (await countUpvotes.get(comment.id)).n,
      upvotedByMe: !already,
    })
  }))

  app.post('/api/posts/:id/vote', asyncRoute(async (req, res) => {
    const auth = await authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const post = await findPostRow.get(req.params.id)
    if (!post) return res.status(404).json({ error: 'NOT_FOUND' })
    if (post.type !== 'poll') return res.status(400).json({ error: 'NOT_A_POLL' })

    const allowedTiers = parseAllowedTiers(post.allowed_tiers)
    if (!isTierAllowed(auth.user.rank_label, allowedTiers)) {
      return res.status(403).json({ error: 'TIER_NOT_ALLOWED' })
    }

    const optionId = String(req.body?.optionId ?? '')
    const option = await findOption.get(optionId)
    if (!option || option.post_id !== post.id) {
      return res.status(400).json({ error: 'INVALID_OPTION' })
    }

    // Voting the option you already picked cancels the vote (toggle).
    const existing = await findMyVote.get(post.id, auth.user.username_key)
    if (existing?.option_id === optionId) {
      await deleteVote.run(post.id, auth.user.username_key)
    } else {
      await upsertVote.run(post.id, optionId, auth.user.username_key, Date.now())
    }

    const { options, totalVotes, myOptionId } = await pollSummary(post.id, auth.user.username_key)
    return res.json({ options, totalVotes, myOptionId })
  }))
}

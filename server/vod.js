// VOD review + timestamped comment feed. There's currently a single demo VOD
// (no submission flow yet), but the schema/routes already support multiple.
import { randomUUID } from 'node:crypto'
import db, { DEMO_VOD_ID } from './db.js'

const MAX_COMMENT_LENGTH = 500

const findVod = db.prepare('SELECT * FROM vods WHERE id = ?')
const insertComment = db.prepare(`
  INSERT INTO vod_comments (id, vod_id, parent_id, username_key, timestamp_seconds, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const findComment = db.prepare('SELECT * FROM vod_comments WHERE id = ?')
const listComments = db.prepare(`
  SELECT c.*, u.username, u.battletag, u.rank_label, u.rank_icon, u.rank_role
  FROM vod_comments c
  JOIN users u ON u.username_key = c.username_key
  WHERE c.vod_id = ?
  ORDER BY c.created_at ASC
`)
const countUpvotes = db.prepare('SELECT COUNT(*) AS n FROM vod_comment_upvotes WHERE comment_id = ?')
const hasUpvoted = db.prepare(
  'SELECT 1 FROM vod_comment_upvotes WHERE comment_id = ? AND username_key = ?',
)
const addUpvote = db.prepare(
  'INSERT OR IGNORE INTO vod_comment_upvotes (comment_id, username_key) VALUES (?, ?)',
)
const removeUpvote = db.prepare(
  'DELETE FROM vod_comment_upvotes WHERE comment_id = ? AND username_key = ?',
)

function roleLabelOf(rankRole) {
  return rankRole === 'tank'
    ? '탱커'
    : rankRole === 'damage'
      ? '딜러'
      : rankRole === 'support'
        ? '서포터'
        : null
}

function toPublicVod(row) {
  return {
    id: row.id,
    replayCode: row.replay_code,
    youtubeId: row.youtube_id,
    hero: row.hero,
    teamSide: row.team_side,
    note: row.note,
    submitter: {
      battletag: row.submitter_battletag,
      rankLabel: row.submitter_rank_label,
      rankIcon: row.submitter_rank_icon,
      roleLabel: row.submitter_role_label,
    },
    createdAt: row.created_at,
  }
}

function toPublicComment(row, viewerKey) {
  return {
    id: row.id,
    parentId: row.parent_id,
    timestampSeconds: row.timestamp_seconds,
    content: row.content,
    createdAt: row.created_at,
    author: {
      username: row.username,
      battletag: row.battletag,
      rankLabel: row.rank_label,
      rankIcon: row.rank_icon,
      roleLabel: roleLabelOf(row.rank_role),
    },
    upvotes: countUpvotes.get(row.id).n,
    upvotedByMe: viewerKey ? Boolean(hasUpvoted.get(row.id, viewerKey)) : false,
  }
}

/**
 * @param {import('express').Express} app
 * @param {{ authenticate: (req: import('express').Request) => { user: any, token: string } | null }} deps
 */
export function registerVodRoutes(app, { authenticate }) {
  app.get('/api/vod', (req, res) => {
    const vod = findVod.get(DEMO_VOD_ID)
    if (!vod) return res.status(404).json({ error: 'NOT_FOUND' })
    return res.json({ vod: toPublicVod(vod) })
  })

  app.get('/api/vod/comments', (req, res) => {
    const vod = findVod.get(DEMO_VOD_ID)
    if (!vod) return res.status(404).json({ error: 'NOT_FOUND' })

    const auth = authenticate(req)
    const viewerKey = auth?.user.username_key ?? null
    const rows = listComments.all(DEMO_VOD_ID)
    const flat = rows.map((r) => ({ ...toPublicComment(r, viewerKey), replies: [] }))

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
  })

  app.post('/api/vod/comments', (req, res) => {
    const auth = authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const vod = findVod.get(DEMO_VOD_ID)
    if (!vod) return res.status(404).json({ error: 'NOT_FOUND' })

    const content = String(req.body?.content ?? '').trim()
    const timestampSeconds = Math.round(Number(req.body?.timestampSeconds))
    const parentId = req.body?.parentId ? String(req.body.parentId) : null

    if (!content) return res.status(400).json({ error: 'EMPTY_CONTENT' })
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: 'CONTENT_TOO_LONG' })
    }
    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      return res.status(400).json({ error: 'INVALID_TIMESTAMP' })
    }

    if (parentId) {
      const parent = findComment.get(parentId)
      if (!parent || parent.vod_id !== DEMO_VOD_ID || parent.parent_id) {
        return res.status(400).json({ error: 'INVALID_PARENT' })
      }
    }

    const id = randomUUID()
    const createdAt = Date.now()
    insertComment.run(
      id,
      DEMO_VOD_ID,
      parentId,
      auth.user.username_key,
      timestampSeconds,
      content,
      createdAt,
    )

    const withAuthor = {
      id,
      parent_id: parentId,
      timestamp_seconds: timestampSeconds,
      content,
      created_at: createdAt,
      username: auth.user.username,
      battletag: auth.user.battletag,
      rank_label: auth.user.rank_label,
      rank_icon: auth.user.rank_icon,
      rank_role: auth.user.rank_role,
    }
    return res.status(201).json({
      comment: { ...toPublicComment(withAuthor, auth.user.username_key), replies: [] },
    })
  })

  app.post('/api/vod/comments/:id/upvote', (req, res) => {
    const auth = authenticate(req)
    if (!auth) return res.status(401).json({ error: 'UNAUTHENTICATED' })

    const comment = findComment.get(req.params.id)
    if (!comment || comment.vod_id !== DEMO_VOD_ID) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }

    const already = Boolean(hasUpvoted.get(comment.id, auth.user.username_key))
    if (already) {
      removeUpvote.run(comment.id, auth.user.username_key)
    } else {
      addUpvote.run(comment.id, auth.user.username_key)
    }
    return res.json({
      upvotes: countUpvotes.get(comment.id).n,
      upvotedByMe: !already,
    })
  })
}

/* End-to-end smoke test against the local dev server (http://localhost:3001).
 * Creates a throwaway user + session directly in the DB, exercises the write
 * endpoints (poll batch insert, votes, comments, cascading deletes), then
 * cleans up. Run: node scripts/smoke-test.mjs */
import { createClient } from '@libsql/client'
import { randomBytes } from 'node:crypto'

const BASE = 'http://127.0.0.1:3001'
const c = createClient({ url: 'file:server/data.sqlite' })

const key = 'smoketest'
const token = randomBytes(32).toString('hex')
const now = Date.now()

await c.execute({
  sql: `INSERT OR REPLACE INTO users (username_key, username, password_hash, battletag, battletag_key, blizzard_id, role, rank_label, created_at, rank_fetched_at)
        VALUES (?, ?, 'x', 'Smoke#1234', 'smoke#1234', null, 'user', 'Gold III', ?, ?)`,
  args: [key, 'SmokeTest', now, now],
})
await c.execute({
  sql: 'INSERT INTO sessions (token, username_key, created_at, expires_at) VALUES (?, ?, ?, ?)',
  args: [token, key, now, now + 3600_000],
})

const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

let failures = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ' — ' + JSON.stringify(detail)}`)
  if (!cond) failures += 1
}

// 1. auth/me
const me = await api('GET', '/api/auth/me')
check('auth/me', me.status === 200 && me.json.user?.username === 'SmokeTest', me)

// 2. poll create (transactional batch: post + options)
const poll = await api('POST', '/api/posts', {
  type: 'poll', title: '스모크 투표', options: ['A안', 'B안', 'C안'],
})
check('poll create', poll.status === 201 && poll.json.post?.options?.length === 3, poll)
const pollId = poll.json?.post?.id
const optionId = poll.json?.post?.options?.[0]?.id

// 3. vote + toggle-cancel
const vote1 = await api('POST', `/api/posts/${pollId}/vote`, { optionId })
check('vote', vote1.status === 200 && vote1.json.myOptionId === optionId && vote1.json.totalVotes === 1, vote1)
const vote2 = await api('POST', `/api/posts/${pollId}/vote`, { optionId })
check('vote toggle-cancel', vote2.status === 200 && vote2.json.myOptionId === null && vote2.json.totalVotes === 0, vote2)

// 4. tip create + comment + reply + upvote
const tip = await api('POST', '/api/posts', { type: 'tip', title: '스모크 팁', body: '본문' })
check('tip create', tip.status === 201, tip)
const tipId = tip.json?.post?.id
const cm = await api('POST', `/api/posts/${tipId}/comments`, { content: '댓글' })
check('comment create', cm.status === 201, cm)
const reply = await api('POST', `/api/posts/${tipId}/comments`, { content: '답글', parentId: cm.json?.comment?.id })
check('reply create', reply.status === 201, reply)
const up = await api('POST', `/api/posts/comments/${reply.json?.comment?.id}/upvote`)
check('upvote', up.status === 200 && up.json.upvotes === 1 && up.json.upvotedByMe === true, up)
const edit = await api('PATCH', `/api/posts/comments/${reply.json?.comment?.id}`, { content: '답글(수정)' })
check('comment edit keeps upvotes', edit.status === 200 && edit.json.comment?.upvotes === 1, edit)

// 5. comment cascade delete (parent → reply + reply's upvote)
const delCm = await api('DELETE', `/api/posts/comments/${cm.json?.comment?.id}`)
check('comment delete', delCm.status === 200, delCm)
const leftoverComments = (await c.execute({ sql: 'SELECT COUNT(*) AS n FROM post_comments WHERE post_id = ?', args: [tipId] })).rows[0].n
const leftoverUpvotes = (await c.execute('SELECT COUNT(*) AS n FROM post_comment_upvotes')).rows[0].n
check('comment cascade wiped replies+upvotes', leftoverComments === 0 && leftoverUpvotes === 0, { leftoverComments, leftoverUpvotes })

// 6. post cascade delete (poll → options; tip)
const cm2 = await api('POST', `/api/posts/${tipId}/comments`, { content: '삭제될 댓글' })
check('comment for post-cascade', cm2.status === 201, cm2)
const delTip = await api('DELETE', `/api/posts/${tipId}`)
check('tip delete', delTip.status === 200, delTip)
const delPoll = await api('DELETE', `/api/posts/${pollId}`)
check('poll delete', delPoll.status === 200, delPoll)
const counts = {}
for (const t of ['posts', 'post_comments', 'post_poll_options', 'post_poll_votes']) {
  counts[t] = (await c.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n
}
check('post cascade left no orphans', Object.values(counts).every((n) => n === 0), counts)

// 7. list pagination shape
const list = await api('GET', '/api/posts?limit=5')
check('posts list', list.status === 200 && list.json.total === 0 && Array.isArray(list.json.posts), list)

// 8. blizzard start without config → 503
const bz = await api('GET', '/api/auth/blizzard/start')
check('blizzard unconfigured 503', bz.status === 503 && bz.json.error === 'OAUTH_NOT_CONFIGURED', bz)

// cleanup
await c.execute({ sql: 'DELETE FROM sessions WHERE username_key = ?', args: [key] })
await c.execute({ sql: 'DELETE FROM users WHERE username_key = ?', args: [key] })

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)

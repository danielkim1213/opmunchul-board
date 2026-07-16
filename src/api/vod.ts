// VOD review API client — mirrors the conventions in api/auth.ts.
import { ApiError, getToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function apiUrl(path: string): string {
  const p = path.startsWith('/api') ? path : `/api${path}`
  return `${API_BASE}${p}`
}

export type TeamSide = 'attack' | 'defense'

export interface VodSubmitter {
  battletag: string
  rankLabel: string
  rankIcon: string | null
  roleLabel: string | null
}

export interface VodInfo {
  id: string
  replayCode: string
  youtubeId: string
  hero: string
  teamSide: TeamSide
  note: string
  submitter: VodSubmitter
  createdAt: number
}

export interface VodCommentAuthor {
  username: string
  battletag: string
  rankLabel: string
  rankIcon: string | null
  roleLabel: string | null
}

export interface VodComment {
  id: string
  parentId: string | null
  timestampSeconds: number
  content: string
  createdAt: number
  author: VodCommentAuthor
  upvotes: number
  upvotedByMe: boolean
  replies: VodComment[]
}

async function handle<T>(res: Response): Promise<T> {
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string } | null
    throw new ApiError(res.status, err?.error ?? 'UNKNOWN', err?.message)
  }
  return data as T
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchVod(): Promise<VodInfo> {
  const res = await fetch(apiUrl('/vod'))
  const { vod } = await handle<{ vod: VodInfo }>(res)
  return vod
}

export async function fetchVodComments(): Promise<VodComment[]> {
  const res = await fetch(apiUrl('/vod/comments'), { headers: authHeaders() })
  const { comments } = await handle<{ comments: VodComment[] }>(res)
  return comments
}

export async function addVodComment(input: {
  timestampSeconds: number
  content: string
  parentId?: string | null
}): Promise<VodComment> {
  const res = await fetch(apiUrl('/vod/comments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  const { comment } = await handle<{ comment: VodComment }>(res)
  return comment
}

export async function toggleVodCommentUpvote(
  commentId: string,
): Promise<{ upvotes: number; upvotedByMe: boolean }> {
  const res = await fetch(apiUrl(`/vod/comments/${commentId}/upvote`), {
    method: 'POST',
    headers: authHeaders(),
  })
  return handle(res)
}

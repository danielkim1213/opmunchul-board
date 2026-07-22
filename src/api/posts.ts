// Board posts API client — replaces api/vod.ts now that VOD review is one of
// three post types (tip / feedback / poll) living in a real board.
import { ApiError, getToken } from './auth'
import type { MostHero } from './auth'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function apiUrl(path: string): string {
  const p = path.startsWith('/api') ? path : `/api${path}`
  return `${API_BASE}${p}`
}

export type PostType = 'tip' | 'feedback' | 'poll'
export type TeamSide = 'red' | 'blue'

// Mirrors server/tiers.js TIER_ORDER.
export type TierKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'champion'

export const TIER_ORDER: TierKey[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'champion',
]

export const TIER_LABEL_KO: Record<TierKey, string> = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '마스터',
  grandmaster: '그랜드마스터',
  champion: '챔피언',
}

// `battletag` is intentionally not exposed here — this is a pseudonymous
// board, so only the account's chosen `username` is ever shown to others.
export interface PostAuthor {
  username: string
  /** Admin accounts get distinct username styling. */
  isAdmin: boolean
  rankLabel: string
  rankIcon: string | null
  roleLabel: string | null
  mostHeroes: MostHero[]
}

interface PostBase {
  id: string
  title: string
  author: PostAuthor
  allowedTiers: TierKey[]
  /** Whether the current viewer's tier satisfies allowedTiers (participation, not visibility). */
  viewerEligible: boolean
  /** Notice posts (admin-only) are pinned to the top of the list. */
  isNotice: boolean
  createdAt: number
  updatedAt: number | null
  /** Whether the current viewer is the author — gates the edit UI. */
  isMine: boolean
  /** Author or admin — gates the delete UI. */
  canDelete: boolean
}

export interface TipPostSummary extends PostBase {
  type: 'tip'
  commentCount: number
}
export interface FeedbackPostSummary extends PostBase {
  type: 'feedback'
  commentCount: number
  replayCode: string | null
  youtubeId: string
  hero: string
  teamSide: TeamSide
}
export interface PollPostSummary extends PostBase {
  type: 'poll'
  optionCount: number
  voteCount: number
}
export type PostSummary = TipPostSummary | FeedbackPostSummary | PollPostSummary

export interface TipPostDetail extends PostBase {
  type: 'tip'
  body: string
  commentCount: number
}
export interface FeedbackPostDetail extends PostBase {
  type: 'feedback'
  body: string
  replayCode: string | null
  youtubeId: string
  hero: string
  teamSide: TeamSide
  commentCount: number
}
export interface PollOption {
  id: string
  label: string
  votes: number
}
export interface PollPostDetail extends PostBase {
  type: 'poll'
  options: PollOption[]
  totalVotes: number
  myOptionId: string | null
}
export type PostDetail = TipPostDetail | FeedbackPostDetail | PollPostDetail

export interface PostCommentAuthor {
  username: string
  /** Admin accounts get distinct username styling. */
  isAdmin: boolean
  rankLabel: string
  rankIcon: string | null
  roleLabel: string | null
  mostHeroes: MostHero[]
}

export interface PostComment {
  id: string
  parentId: string | null
  /** null = "global" feedback that isn't tied to a specific moment (feedback posts only). */
  timestampSeconds: number | null
  content: string
  createdAt: number
  updatedAt: number | null
  author: PostCommentAuthor
  upvotes: number
  upvotedByMe: boolean
  /** Whether the current viewer wrote this comment — gates the edit UI. */
  isMine: boolean
  /** Author or admin — gates the delete UI. */
  canDelete: boolean
  replies: PostComment[]
}

export type CreatePostInput =
  | { type: 'tip'; title: string; body: string; allowedTiers?: TierKey[]; isNotice?: boolean }
  | {
      type: 'feedback'
      title: string
      body: string
      replayCode?: string
      hero: string
      teamSide: TeamSide
      youtubeUrl: string
      allowedTiers?: TierKey[]
      isNotice?: boolean
    }
  | { type: 'poll'; title: string; options: string[]; allowedTiers?: TierKey[]; isNotice?: boolean }

/** Partial update — only fields relevant to the post's type are applied server-side. */
export interface UpdatePostInput {
  title?: string
  body?: string
  replayCode?: string | null
  hero?: string
  teamSide?: TeamSide
  youtubeUrl?: string
  allowedTiers?: TierKey[]
  isNotice?: boolean
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

export async function fetchPosts(type?: PostType): Promise<PostSummary[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : ''
  const res = await fetch(apiUrl(`/posts${query}`), { headers: authHeaders() })
  const { posts } = await handle<{ posts: PostSummary[] }>(res)
  return posts
}

export async function fetchPost(id: string): Promise<PostDetail> {
  const res = await fetch(apiUrl(`/posts/${id}`), { headers: authHeaders() })
  const { post } = await handle<{ post: PostDetail }>(res)
  return post
}

export async function createPost(input: CreatePostInput): Promise<PostDetail> {
  const res = await fetch(apiUrl('/posts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  const { post } = await handle<{ post: PostDetail }>(res)
  return post
}

export async function updatePost(id: string, input: UpdatePostInput): Promise<PostDetail> {
  const res = await fetch(apiUrl(`/posts/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  const { post } = await handle<{ post: PostDetail }>(res)
  return post
}

export async function deletePost(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/posts/${id}`), { method: 'DELETE', headers: authHeaders() })
  await handle(res)
}

export async function fetchPostComments(postId: string): Promise<PostComment[]> {
  const res = await fetch(apiUrl(`/posts/${postId}/comments`), { headers: authHeaders() })
  const { comments } = await handle<{ comments: PostComment[] }>(res)
  return comments
}

export async function addPostComment(
  postId: string,
  input: {
    timestampSeconds?: number | null
    content: string
    parentId?: string | null
  },
): Promise<PostComment> {
  const res = await fetch(apiUrl(`/posts/${postId}/comments`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  const { comment } = await handle<{ comment: PostComment }>(res)
  return comment
}

export async function updatePostComment(commentId: string, content: string): Promise<PostComment> {
  const res = await fetch(apiUrl(`/posts/comments/${commentId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content }),
  })
  const { comment } = await handle<{ comment: PostComment }>(res)
  return comment
}

export async function deletePostComment(commentId: string): Promise<void> {
  const res = await fetch(apiUrl(`/posts/comments/${commentId}`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  await handle(res)
}

export async function togglePostCommentUpvote(
  commentId: string,
): Promise<{ upvotes: number; upvotedByMe: boolean }> {
  const res = await fetch(apiUrl(`/posts/comments/${commentId}/upvote`), {
    method: 'POST',
    headers: authHeaders(),
  })
  return handle(res)
}

export async function votePoll(
  postId: string,
  optionId: string,
): Promise<{ options: PollOption[]; totalVotes: number; myOptionId: string | null }> {
  const res = await fetch(apiUrl(`/posts/${postId}/vote`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ optionId }),
  })
  return handle(res)
}

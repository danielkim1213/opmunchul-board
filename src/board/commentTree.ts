// Small helpers for updating the nested comment state (top-level + one level
// of replies) without refetching the whole feed on every interaction.
import type { PostComment } from '../api/posts'

export function findComment(comments: PostComment[], id: string): PostComment | null {
  for (const c of comments) {
    if (c.id === id) return c
    const reply = c.replies.find((r) => r.id === id)
    if (reply) return reply
  }
  return null
}

export function toggleUpvoteInTree(comments: PostComment[], id: string): PostComment[] {
  return comments.map((c) => {
    if (c.id === id) {
      return c.upvotedByMe
        ? { ...c, upvotedByMe: false, upvotes: Math.max(0, c.upvotes - 1) }
        : { ...c, upvotedByMe: true, upvotes: c.upvotes + 1 }
    }
    if (c.replies.some((r) => r.id === id)) {
      return { ...c, replies: toggleUpvoteInTree(c.replies, id) }
    }
    return c
  })
}

export function applyUpvoteResult(
  comments: PostComment[],
  id: string,
  result: { upvotes: number; upvotedByMe: boolean },
): PostComment[] {
  return comments.map((c) => {
    if (c.id === id) return { ...c, ...result }
    if (c.replies.some((r) => r.id === id)) {
      return { ...c, replies: applyUpvoteResult(c.replies, id, result) }
    }
    return c
  })
}

export function addReply(
  comments: PostComment[],
  parentId: string,
  reply: PostComment,
): PostComment[] {
  return comments.map((c) => (c.id === parentId ? { ...c, replies: [...c.replies, reply] } : c))
}

export function updateCommentInTree(
  comments: PostComment[],
  id: string,
  patch: Partial<PostComment>,
): PostComment[] {
  return comments.map((c) => {
    if (c.id === id) return { ...c, ...patch }
    if (c.replies.some((r) => r.id === id)) {
      return { ...c, replies: updateCommentInTree(c.replies, id, patch) }
    }
    return c
  })
}

/** Removing a top-level comment also drops its replies (server cascades the same way). */
export function removeCommentFromTree(comments: PostComment[], id: string): PostComment[] {
  return comments
    .filter((c) => c.id !== id)
    .map((c) => (c.replies.some((r) => r.id === id) ? { ...c, replies: c.replies.filter((r) => r.id !== id) } : c))
}

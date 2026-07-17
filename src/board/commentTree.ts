// Helpers for updating the nested comment state (arbitrary reply depth)
// without refetching the whole feed on every interaction.
import type { PostComment } from '../api/posts'

/** Depth-first search for a comment anywhere in the tree. */
export function findComment(comments: PostComment[], id: string): PostComment | null {
  for (const c of comments) {
    if (c.id === id) return c
    const nested = findComment(c.replies, id)
    if (nested) return nested
  }
  return null
}

/** Total number of comments including every nested reply. */
export function countCommentTree(comments: PostComment[]): number {
  return comments.reduce((sum, c) => sum + 1 + countCommentTree(c.replies), 0)
}

/**
 * Returns a new tree where the comment with `id` is replaced by
 * `update(comment)`. Untouched branches keep their original references so
 * React can skip re-rendering them.
 */
function updateInTree(
  comments: PostComment[],
  id: string,
  update: (comment: PostComment) => PostComment,
): PostComment[] {
  let changed = false
  const next = comments.map((c) => {
    if (c.id === id) {
      changed = true
      return update(c)
    }
    const replies = updateInTree(c.replies, id, update)
    if (replies !== c.replies) {
      changed = true
      return { ...c, replies }
    }
    return c
  })
  return changed ? next : comments
}

export function toggleUpvoteInTree(comments: PostComment[], id: string): PostComment[] {
  return updateInTree(comments, id, (c) =>
    c.upvotedByMe
      ? { ...c, upvotedByMe: false, upvotes: Math.max(0, c.upvotes - 1) }
      : { ...c, upvotedByMe: true, upvotes: c.upvotes + 1 },
  )
}

export function applyUpvoteResult(
  comments: PostComment[],
  id: string,
  result: { upvotes: number; upvotedByMe: boolean },
): PostComment[] {
  return updateInTree(comments, id, (c) => ({ ...c, ...result }))
}

export function addReply(
  comments: PostComment[],
  parentId: string,
  reply: PostComment,
): PostComment[] {
  return updateInTree(comments, parentId, (c) => ({ ...c, replies: [...c.replies, reply] }))
}

export function updateCommentInTree(
  comments: PostComment[],
  id: string,
  patch: Partial<PostComment>,
): PostComment[] {
  return updateInTree(comments, id, (c) => ({ ...c, ...patch }))
}

/** Removing a comment also drops its replies (server cascades the same way). */
export function removeCommentFromTree(comments: PostComment[], id: string): PostComment[] {
  let changed = false
  const next: PostComment[] = []
  for (const c of comments) {
    if (c.id === id) {
      changed = true
      continue
    }
    const replies = removeCommentFromTree(c.replies, id)
    if (replies !== c.replies) {
      changed = true
      next.push({ ...c, replies })
    } else {
      next.push(c)
    }
  }
  return changed ? next : comments
}

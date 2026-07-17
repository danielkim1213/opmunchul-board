import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import {
  addPostComment,
  deletePost,
  deletePostComment,
  fetchPostComments,
  togglePostCommentUpvote,
  updatePostComment,
  votePoll,
} from '../api/posts'
import type { PollOption, PollPostDetail as PollPost, PostComment } from '../api/posts'
import RankBadge from '../components/RankBadge'
import CommentCard from './CommentCard'
import {
  addReply,
  applyUpvoteResult,
  countCommentTree,
  findComment,
  removeCommentFromTree,
  toggleUpvoteInTree,
  updateCommentInTree,
} from './commentTree'

const COMMENT_MAX = 500

interface PollPostDetailProps {
  post: PollPost
  onBack: () => void
  onEdit: () => void
  onDeleted: () => void
}

export default function PollPostDetail({ post, onBack, onEdit, onDeleted }: PollPostDetailProps) {
  const [options, setOptions] = useState<PollOption[]>(post.options)
  const [totalVotes, setTotalVotes] = useState(post.totalVotes)
  const [myOptionId, setMyOptionId] = useState<string | null>(post.myOptionId)
  const [voting, setVoting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [comments, setComments] = useState<PostComment[]>([])
  const [loadingComments, setLoadingComments] = useState(true)
  const [commentsError, setCommentsError] = useState<string | null>(null)

  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const canInteract = post.viewerEligible

  useEffect(() => {
    let cancelled = false
    setLoadingComments(true)
    setCommentsError(null)
    fetchPostComments(post.id)
      .then((data) => {
        if (!cancelled) setComments(data)
      })
      .catch(() => {
        if (!cancelled) setCommentsError('댓글을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false)
      })
    return () => {
      cancelled = true
    }
  }, [post.id])

  async function handleDeletePost() {
    if (!window.confirm('투표를 삭제하시겠어요? 댓글도 모두 함께 삭제되며 되돌릴 수 없습니다.')) return
    setDeleting(true)
    try {
      await deletePost(post.id)
      onDeleted()
    } catch {
      window.alert('삭제에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleVote(optionId: string) {
    if (!canInteract || voting || optionId === myOptionId) return
    setVoting(true)
    setError(null)
    try {
      const result = await votePoll(post.id, optionId)
      setOptions(result.options)
      setTotalVotes(result.totalVotes)
      setMyOptionId(result.myOptionId)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'UNAUTHENTICATED'
          ? '로그인이 필요합니다.'
          : err instanceof ApiError && err.code === 'TIER_NOT_ALLOWED'
            ? '자격 티어가 아닙니다.'
            : '투표에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setVoting(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canInteract) return
    setFormError(null)

    const trimmed = content.trim()
    if (!trimmed) {
      setFormError('댓글 내용을 입력해 주세요.')
      return
    }
    if (trimmed.length > COMMENT_MAX) {
      setFormError(`댓글은 ${COMMENT_MAX}자 이내로 작성해 주세요.`)
      return
    }

    setSubmitting(true)
    try {
      const comment = await addPostComment(post.id, { content: trimmed })
      setComments((prev) => [...prev, comment])
      setContent('')
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'UNAUTHENTICATED'
          ? '로그인이 필요합니다.'
          : err instanceof ApiError && err.code === 'TIER_NOT_ALLOWED'
            ? '자격 티어가 아닙니다.'
            : '댓글 등록에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpvote(commentId: string) {
    if (!canInteract) return
    setComments((prev) => toggleUpvoteInTree(prev, commentId))
    try {
      const result = await togglePostCommentUpvote(commentId)
      setComments((prev) => applyUpvoteResult(prev, commentId, result))
    } catch {
      setComments((prev) => toggleUpvoteInTree(prev, commentId))
    }
  }

  async function handleCommentEdit(commentId: string, newContent: string) {
    const updated = await updatePostComment(commentId, newContent)
    setComments((prev) =>
      updateCommentInTree(prev, commentId, { content: updated.content, updatedAt: updated.updatedAt }),
    )
  }

  async function handleCommentDelete(commentId: string) {
    await deletePostComment(commentId)
    setComments((prev) => removeCommentFromTree(prev, commentId))
  }

  async function handleReplySubmit(parentId: string) {
    if (!canInteract) return
    const trimmed = replyContent.trim()
    if (!trimmed) return
    if (!findComment(comments, parentId)) return
    setReplySubmitting(true)
    try {
      const comment = await addPostComment(post.id, { content: trimmed, parentId })
      setComments((prev) => addReply(prev, parentId, comment))
      setReplyContent('')
      setReplyTarget(null)
    } catch {
      // Best-effort — the reply box stays open so the user can retry.
    } finally {
      setReplySubmitting(false)
    }
  }

  return (
    <div className="post-detail">
      <button type="button" className="post-detail__back" onClick={onBack}>
        ← 목록으로
      </button>

      <div className="post-detail__header">
        <div className="post-detail__header-top">
          <span className="post-detail__type-badge post-detail__type-badge--poll">🗳 투표</span>
          {post.isMine && (
            <div className="post-detail__actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={onEdit}>
                ✏️ 수정
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={handleDeletePost}
                disabled={deleting}
              >
                🗑 삭제
              </button>
            </div>
          )}
        </div>
        <h1 className="post-detail__title">{post.title}</h1>
        <div className="post-detail__author">
          <span className="post-detail__tag">{post.author.username}</span>
          <RankBadge
            rankLabel={post.author.rankLabel}
            rankIcon={post.author.rankIcon}
            roleLabel={post.author.roleLabel}
            mostHeroes={post.author.mostHeroes}
          />
        </div>
      </div>

      {!canInteract && (
        <div className="tier-lock-note">
          🔒 이 투표는 지정된 티어만 투표·댓글에 참여할 수 있습니다. 결과와 댓글은 볼 수 있어요.
        </div>
      )}

      <div className="poll">
        <ul className="poll__options">
          {options.map((option) => {
            const pct = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0
            const isMine = option.id === myOptionId
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`poll__option${isMine ? ' poll__option--mine' : ''}`}
                  onClick={() => handleVote(option.id)}
                  disabled={!canInteract || voting}
                >
                  <span className="poll__option-bar" style={{ width: `${pct}%` }} />
                  <span className="poll__option-label">
                    {isMine && <span className="poll__option-check">✓</span>}
                    {option.label}
                  </span>
                  <span className="poll__option-stats">
                    {pct}% ({option.votes})
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="poll__total">총 {totalVotes}명 참여</p>
        {error && <div className="feedback-form__error">{error}</div>}
      </div>

      <div className="comment-feed">
        <div className="comment-feed__header">
          <h3>댓글 ({countCommentTree(comments)})</h3>
        </div>

        {canInteract && (
          <form onSubmit={handleSubmit} className="feedback-form__fields">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, COMMENT_MAX))}
              maxLength={COMMENT_MAX}
              placeholder="댓글을 남겨보세요."
              rows={3}
            />
            <div className="feedback-form__footer">
              <span className="feedback-form__count">
                {content.length}/{COMMENT_MAX}
              </span>
              <button type="submit" className="btn btn--primary btn--small" disabled={submitting}>
                {submitting ? '등록 중...' : '댓글 등록'}
              </button>
            </div>
            {formError && <div className="feedback-form__error">{formError}</div>}
          </form>
        )}

        {commentsError && <p className="comment-feed__empty">{commentsError}</p>}
        {!loadingComments && !commentsError && comments.length === 0 && (
          <p className="comment-feed__empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>
        )}

        <ul className="comment-feed__list">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              variant="plain"
              canInteract={canInteract}
              onUpvote={handleUpvote}
              onEdit={handleCommentEdit}
              onDelete={handleCommentDelete}
              replyTargetId={replyTarget}
              replyContent={replyContent}
              onReplyToggle={(id) => {
                setReplyTarget(id)
                setReplyContent('')
              }}
              onReplyChange={setReplyContent}
              onReplySubmit={handleReplySubmit}
              replySubmitting={replySubmitting}
              registerRef={() => {}}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

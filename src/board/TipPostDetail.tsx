import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import { addPostComment, fetchPostComments, togglePostCommentUpvote } from '../api/posts'
import type { PostComment, TipPostDetail as TipPost } from '../api/posts'
import RankBadge from '../components/RankBadge'
import CommentCard from './CommentCard'
import { addReply, applyUpvoteResult, findComment, toggleUpvoteInTree } from './commentTree'

const COMMENT_MAX = 500

interface TipPostDetailProps {
  post: TipPost
  onBack: () => void
}

export default function TipPostDetail({ post, onBack }: TipPostDetailProps) {
  const [comments, setComments] = useState<PostComment[]>([])
  const [loadingComments, setLoadingComments] = useState(true)

  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingComments(true)
    fetchPostComments(post.id)
      .then((data) => {
        if (!cancelled) setComments(data)
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false)
      })
    return () => {
      cancelled = true
    }
  }, [post.id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
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
          : '댓글 등록에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpvote(commentId: string) {
    setComments((prev) => toggleUpvoteInTree(prev, commentId))
    try {
      const result = await togglePostCommentUpvote(commentId)
      setComments((prev) => applyUpvoteResult(prev, commentId, result))
    } catch {
      setComments((prev) => toggleUpvoteInTree(prev, commentId))
    }
  }

  async function handleReplySubmit(parentId: string) {
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
        <span className="post-detail__type-badge post-detail__type-badge--tip">💡 팁</span>
        <h1 className="post-detail__title">{post.title}</h1>
        <div className="post-detail__author">
          <span className="post-detail__tag">{post.author.battletag}</span>
          <RankBadge
            rankLabel={post.author.rankLabel}
            rankIcon={post.author.rankIcon}
            roleLabel={post.author.roleLabel}
            mostHeroes={post.author.mostHeroes}
          />
        </div>
      </div>

      <p className="post-detail__body">{post.body}</p>

      <div className="comment-feed">
        <div className="comment-feed__header">
          <h3>댓글 ({comments.length})</h3>
        </div>

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

        {!loadingComments && comments.length === 0 && (
          <p className="comment-feed__empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>
        )}

        <ul className="comment-feed__list">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              variant="plain"
              isActive={false}
              onUpvote={handleUpvote}
              replyOpen={replyTarget === c.id}
              replyContent={replyTarget === c.id ? replyContent : ''}
              onReplyToggle={(id) => {
                setReplyTarget(id)
                setReplyContent('')
              }}
              onReplyChange={setReplyContent}
              onReplySubmit={() => handleReplySubmit(c.id)}
              replySubmitting={replySubmitting}
              registerRef={() => {}}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

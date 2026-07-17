import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import {
  addPostComment,
  deletePost,
  deletePostComment,
  fetchPostComments,
  togglePostCommentUpvote,
  updatePostComment,
} from '../api/posts'
import type { FeedbackPostDetail as FeedbackPost, PostComment } from '../api/posts'
import YouTubePlayer from '../components/YouTubePlayer'
import type { YouTubePlayerHandle } from '../components/YouTubePlayer'
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
import { formatTimestamp, parseTimestamp } from './time'

const HIGHLIGHT_WINDOW_SECONDS = 5
const COMMENT_MAX = 500

type SortMode = 'timestamp' | 'likes'

const TEAM_SIDE_LABEL: Record<FeedbackPost['teamSide'], string> = {
  red: '레드팀',
  blue: '블루팀',
}

function hasTimestamp(c: PostComment): c is PostComment & { timestampSeconds: number } {
  return c.timestampSeconds !== null
}

interface FeedbackPostDetailProps {
  post: FeedbackPost
  onBack: () => void
  onEdit: () => void
  onDeleted: () => void
}

export default function FeedbackPostDetail({ post, onBack, onEdit, onDeleted }: FeedbackPostDetailProps) {
  const [comments, setComments] = useState<PostComment[]>([])
  const [loadingComments, setLoadingComments] = useState(true)
  const [commentsError, setCommentsError] = useState<string | null>(null)

  const [currentTime, setCurrentTime] = useState(0)

  const [timestampInput, setTimestampInput] = useState('0:00')
  const [timestampTouched, setTimestampTouched] = useState(false)
  const [isGlobalFeedback, setIsGlobalFeedback] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingPost, setDeletingPost] = useState(false)

  const [sortMode, setSortMode] = useState<SortMode>('timestamp')
  const [syncMode, setSyncMode] = useState(false)

  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const contentRef = useRef<HTMLTextAreaElement>(null)
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const lastScrolledId = useRef<string | null>(null)
  const commentRefs = useRef(new Map<string, HTMLLIElement>())

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
        if (!cancelled) setCommentsError('피드백을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false)
      })
    return () => {
      cancelled = true
    }
  }, [post.id])

  // Keep the timestamp field glued to live playback until the user edits it.
  useEffect(() => {
    if (!timestampTouched) {
      setTimestampInput(formatTimestamp(currentTime))
    }
  }, [currentTime, timestampTouched])

  function handleUseCurrentTime() {
    setTimestampInput(formatTimestamp(currentTime))
    setTimestampTouched(false)
    setIsGlobalFeedback(false)
    contentRef.current?.focus()
  }

  function handleSeek(seconds: number) {
    playerRef.current?.seekTo(seconds)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    let seconds: number | null = null
    if (!isGlobalFeedback) {
      seconds = parseTimestamp(timestampInput)
      if (seconds === null) {
        setFormError('타임스탬프 형식이 올바르지 않습니다. 예: 1:23')
        return
      }
    }

    const trimmed = content.trim()
    if (!trimmed) {
      setFormError('피드백 내용을 입력해 주세요.')
      return
    }
    if (trimmed.length > COMMENT_MAX) {
      setFormError(`피드백은 ${COMMENT_MAX}자 이내로 작성해 주세요.`)
      return
    }

    setSubmitting(true)
    try {
      const comment = await addPostComment(post.id, { timestampSeconds: seconds, content: trimmed })
      setComments((prev) => [...prev, comment])
      setContent('')
      setTimestampTouched(false)
      setIsGlobalFeedback(false)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'UNAUTHENTICATED'
          ? '로그인이 필요합니다.'
          : err instanceof ApiError && err.code === 'TIER_NOT_ALLOWED'
            ? '자격 티어가 아닙니다.'
            : '피드백 등록에 실패했습니다. 다시 시도해 주세요.',
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

  async function handleDeletePost() {
    if (!window.confirm('게시글을 삭제하시겠어요? 피드백도 모두 함께 삭제되며 되돌릴 수 없습니다.')) return
    setDeletingPost(true)
    try {
      await deletePost(post.id)
      onDeleted()
    } catch {
      window.alert('삭제에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setDeletingPost(false)
    }
  }

  async function handleReplySubmit(parentId: string) {
    const trimmed = replyContent.trim()
    if (!trimmed) return
    const parent = findComment(comments, parentId)
    if (!parent) return
    setReplySubmitting(true)
    try {
      // A reply always shares its parent's timestamp (or lack thereof) — a
      // reply to "global" feedback is itself global, not snapped to "now".
      const comment = await addPostComment(post.id, {
        timestampSeconds: parent.timestampSeconds,
        content: trimmed,
        parentId,
      })
      setComments((prev) => addReply(prev, parentId, comment))
      setReplyContent('')
      setReplyTarget(null)
    } catch {
      // Best-effort — the reply box stays open so the user can retry.
    } finally {
      setReplySubmitting(false)
    }
  }

  const globalComments = useMemo(() => comments.filter((c) => c.timestampSeconds === null), [comments])
  const timelineComments = useMemo(() => comments.filter(hasTimestamp), [comments])

  const sortedGlobalComments = useMemo(() => {
    const copy = [...globalComments]
    copy.sort((a, b) => (sortMode === 'likes' ? b.upvotes - a.upvotes : a.createdAt - b.createdAt))
    return copy
  }, [globalComments, sortMode])

  const sortedTimelineComments = useMemo(() => {
    const copy = [...timelineComments]
    if (sortMode === 'likes') {
      copy.sort((a, b) => b.upvotes - a.upvotes || a.timestampSeconds - b.timestampSeconds)
    } else {
      copy.sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    }
    return copy
  }, [timelineComments, sortMode])

  // In sync mode, only timestamped comments near the current playback
  // position are shown — global feedback always stays visible regardless,
  // since it isn't tied to any particular moment.
  const visibleTimelineComments = useMemo(() => {
    if (!syncMode) return sortedTimelineComments
    return sortedTimelineComments.filter(
      (c) => Math.abs(c.timestampSeconds - currentTime) <= HIGHLIGHT_WINDOW_SECONDS,
    )
  }, [sortedTimelineComments, syncMode, currentTime])

  const activeCommentId = useMemo(() => {
    let best: PostComment | null = null
    let bestDelta = Infinity
    for (const c of timelineComments) {
      const delta = Math.abs(c.timestampSeconds - currentTime)
      if (delta <= HIGHLIGHT_WINDOW_SECONDS && delta < bestDelta) {
        best = c
        bestDelta = delta
      }
    }
    return best?.id ?? null
  }, [timelineComments, currentTime])

  useEffect(() => {
    if (!syncMode || !activeCommentId || activeCommentId === lastScrolledId.current) return
    const el = commentRefs.current.get(activeCommentId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      lastScrolledId.current = activeCommentId
    }
  }, [activeCommentId, syncMode])

  function registerCommentRef(id: string, el: HTMLLIElement | null) {
    if (el) commentRefs.current.set(id, el)
    else commentRefs.current.delete(id)
  }

  return (
    <div className="post-detail post-detail--feedback">
      <button type="button" className="post-detail__back" onClick={onBack}>
        ← 목록으로
      </button>

      <div className="vod-review">
        <div className="vod-review__main">
          <YouTubePlayer ref={playerRef} videoId={post.youtubeId} onTimeUpdate={setCurrentTime} />

          <div className="vod-meta">
            <div className="post-detail__header-top">
              <span className="post-detail__type-badge post-detail__type-badge--feedback">
                🎬 피드백
              </span>
              {post.isMine && (
                <div className="post-detail__actions">
                  <button type="button" className="btn btn--ghost btn--small" onClick={onEdit}>
                    ✏️ 수정
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={handleDeletePost}
                    disabled={deletingPost}
                  >
                    🗑 삭제
                  </button>
                </div>
              )}
            </div>
            <h1 className="post-detail__title">{post.title}</h1>
            <div className="vod-meta__grid">
              {post.replayCode && (
                <div className="vod-meta__field">
                  <span className="vod-meta__label">리플레이 코드</span>
                  <code className="vod-meta__code">{post.replayCode}</code>
                </div>
              )}
              <div className="vod-meta__field">
                <span className="vod-meta__label">역할 / 영웅</span>
                <span className="vod-meta__value">
                  {post.hero} <span className="vod-meta__side">({TEAM_SIDE_LABEL[post.teamSide]})</span>
                </span>
              </div>
              <div className="vod-meta__field vod-meta__field--submitter">
                <span className="vod-meta__label">작성자</span>
                <span className="vod-meta__value vod-meta__submitter">
                  {post.author.username}
                  <RankBadge
                    rankLabel={post.author.rankLabel}
                    rankIcon={post.author.rankIcon}
                    roleLabel={post.author.roleLabel}
                    mostHeroes={post.author.mostHeroes}
                  />
                </span>
              </div>
            </div>
            <div className="vod-meta__note">
              <span className="vod-meta__label">
                요청 노트{post.updatedAt && <span className="post-detail__edited">(수정됨)</span>}
              </span>
              <p>{post.body}</p>
            </div>
          </div>
        </div>

        <div className="vod-review__side">
          {!canInteract && (
            <div className="tier-lock-note">🔒 이 피드백 게시글은 지정된 티어만 참여할 수 있습니다.</div>
          )}

          {canInteract && (
            <div className="feedback-form">
              <button type="button" className="feedback-form__now-btn" onClick={handleUseCurrentTime}>
                📍 [{formatTimestamp(currentTime)}] 시점에 댓글 추가
              </button>

              <form onSubmit={handleSubmit} className="feedback-form__fields">
                <div className="feedback-form__row">
                  <label className="feedback-form__label" htmlFor="feedback-ts-input">
                    타임스탬프
                  </label>
                  <input
                    id="feedback-ts-input"
                    className="feedback-form__timestamp"
                    value={timestampInput}
                    disabled={isGlobalFeedback}
                    onChange={(e) => {
                      setTimestampInput(e.target.value)
                      setTimestampTouched(true)
                    }}
                    placeholder="1:23"
                  />
                  {timestampTouched && !isGlobalFeedback && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={handleUseCurrentTime}
                    >
                      현재 시간으로
                    </button>
                  )}
                </div>

                <label className="feedback-form__global-toggle">
                  <input
                    type="checkbox"
                    checked={isGlobalFeedback}
                    onChange={(e) => setIsGlobalFeedback(e.target.checked)}
                  />
                  특정 시간대 없이 전체적인 피드백 남기기
                </label>

                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value.slice(0, COMMENT_MAX))}
                  maxLength={COMMENT_MAX}
                  placeholder={
                    isGlobalFeedback
                      ? '영상 전체에 대한 종합적인 피드백을 남겨보세요.'
                      : '이 시점에 대한 피드백을 남겨보세요.'
                  }
                  rows={3}
                />

                <div className="feedback-form__footer">
                  <span className="feedback-form__count">
                    {content.length}/{COMMENT_MAX}
                  </span>
                  <button type="submit" className="btn btn--primary btn--small" disabled={submitting}>
                    {submitting ? '등록 중...' : '피드백 등록'}
                  </button>
                </div>

                {formError && <div className="feedback-form__error">{formError}</div>}
              </form>
            </div>
          )}

          <div className="comment-feed">
            <div className="comment-feed__header">
              <h3>피드백 ({countCommentTree(comments)})</h3>
              <div className="comment-feed__controls">
                <button
                  type="button"
                  className={`chip${sortMode === 'timestamp' ? ' chip--active' : ''}`}
                  onClick={() => setSortMode('timestamp')}
                >
                  시간순
                </button>
                <button
                  type="button"
                  className={`chip${sortMode === 'likes' ? ' chip--active' : ''}`}
                  onClick={() => setSortMode('likes')}
                >
                  추천순
                </button>
                <button
                  type="button"
                  className={`chip${syncMode ? ' chip--active' : ''}`}
                  onClick={() => setSyncMode((v) => !v)}
                  title="현재 재생 위치와 가까운(±5초) 피드백만 보여줍니다"
                >
                  🔄 싱크 모드
                </button>
              </div>
            </div>

            {commentsError && <p className="comment-feed__empty">{commentsError}</p>}
            {!loadingComments && !commentsError && comments.length === 0 && (
              <p className="comment-feed__empty">아직 피드백이 없습니다. 첫 피드백을 남겨보세요!</p>
            )}

            {sortedGlobalComments.length > 0 && (
              <div className="comment-feed__section">
                <p className="comment-feed__section-title">
                  🗒 전체 피드백 ({sortedGlobalComments.length})
                </p>
                <ul className="comment-feed__list">
                  {sortedGlobalComments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      variant="feedback"
                      currentTime={currentTime}
                      onSeek={handleSeek}
                      onUpvote={handleUpvote}
                      onEdit={handleCommentEdit}
                      onDelete={handleCommentDelete}
                      canInteract={canInteract}
                      replyTargetId={replyTarget}
                      replyContent={replyContent}
                      onReplyToggle={(id) => {
                        setReplyTarget(id)
                        setReplyContent('')
                      }}
                      onReplyChange={setReplyContent}
                      onReplySubmit={handleReplySubmit}
                      replySubmitting={replySubmitting}
                      registerRef={registerCommentRef}
                    />
                  ))}
                </ul>
              </div>
            )}

            {timelineComments.length > 0 && (
              <div className="comment-feed__section">
                <p className="comment-feed__section-title">
                  ⏱ 타임라인 피드백 ({visibleTimelineComments.length}/{timelineComments.length})
                </p>

                {syncMode && visibleTimelineComments.length === 0 && (
                  <p className="comment-feed__sync-note">
                    현재 재생 위치(±5초) 근처에 피드백이 없습니다.
                  </p>
                )}

                <ul className="comment-feed__list">
                  {visibleTimelineComments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      variant="feedback"
                      currentTime={currentTime}
                      onSeek={handleSeek}
                      onUpvote={handleUpvote}
                      onEdit={handleCommentEdit}
                      onDelete={handleCommentDelete}
                      canInteract={canInteract}
                      replyTargetId={replyTarget}
                      replyContent={replyContent}
                      onReplyToggle={(id) => {
                        setReplyTarget(id)
                        setReplyContent('')
                      }}
                      onReplyChange={setReplyContent}
                      onReplySubmit={handleReplySubmit}
                      replySubmitting={replySubmitting}
                      registerRef={registerCommentRef}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import {
  addVodComment,
  fetchVod,
  fetchVodComments,
  toggleVodCommentUpvote,
} from '../api/vod'
import type { VodComment, VodInfo } from '../api/vod'
import YouTubePlayer from '../components/YouTubePlayer'
import type { YouTubePlayerHandle } from '../components/YouTubePlayer'
import CommentCard from './CommentCard'
import VodMeta from './VodMeta'
import { addReply, applyUpvoteResult, findComment, toggleUpvoteInTree } from './commentTree'
import { extractYoutubeId, formatTimestamp, parseTimestamp } from './time'
import './VodReview.css'

const HIGHLIGHT_WINDOW_SECONDS = 5
const COMMENT_MAX = 500

type SortMode = 'timestamp' | 'likes'

export default function VodReview() {
  const [vod, setVod] = useState<VodInfo | null>(null)
  const [comments, setComments] = useState<VodComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [currentTime, setCurrentTime] = useState(0)

  const [timestampInput, setTimestampInput] = useState('0:00')
  const [timestampTouched, setTimestampTouched] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [sortMode, setSortMode] = useState<SortMode>('timestamp')
  const [syncMode, setSyncMode] = useState(false)
  const [videoIdOverride, setVideoIdOverride] = useState<string | null>(null)
  const [videoInput, setVideoInput] = useState('')
  const [videoInputError, setVideoInputError] = useState(false)

  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const contentRef = useRef<HTMLTextAreaElement>(null)
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const lastScrolledId = useRef<string | null>(null)
  const commentRefs = useRef(new Map<string, HTMLLIElement>())

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchVod(), fetchVodComments()])
      .then(([vodData, commentsData]) => {
        if (cancelled) return
        setVod(vodData)
        setComments(commentsData)
      })
      .catch(() => {
        if (!cancelled) setLoadError('VOD 정보를 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the timestamp field glued to live playback until the user edits it.
  useEffect(() => {
    if (!timestampTouched) {
      setTimestampInput(formatTimestamp(currentTime))
    }
  }, [currentTime, timestampTouched])

  function handleUseCurrentTime() {
    setTimestampInput(formatTimestamp(currentTime))
    setTimestampTouched(false)
    contentRef.current?.focus()
  }

  function handleSeek(seconds: number) {
    playerRef.current?.seekTo(seconds)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    const seconds = parseTimestamp(timestampInput)
    if (seconds === null) {
      setFormError('타임스탬프 형식이 올바르지 않습니다. 예: 1:23')
      return
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
      const comment = await addVodComment({ timestampSeconds: seconds, content: trimmed })
      setComments((prev) => [...prev, comment])
      setContent('')
      setTimestampTouched(false)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'UNAUTHENTICATED'
          ? '로그인이 필요합니다.'
          : '피드백 등록에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpvote(commentId: string) {
    setComments((prev) => toggleUpvoteInTree(prev, commentId))
    try {
      const result = await toggleVodCommentUpvote(commentId)
      setComments((prev) => applyUpvoteResult(prev, commentId, result))
    } catch {
      setComments((prev) => toggleUpvoteInTree(prev, commentId))
    }
  }

  async function handleReplySubmit(parentId: string) {
    const trimmed = replyContent.trim()
    if (!trimmed) return
    setReplySubmitting(true)
    try {
      const parent = findComment(comments, parentId)
      const comment = await addVodComment({
        timestampSeconds: parent?.timestampSeconds ?? Math.round(currentTime),
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

  function handleSwapVideo(e: FormEvent) {
    e.preventDefault()
    const parsed = extractYoutubeId(videoInput)
    if (!parsed) {
      setVideoInputError(true)
      return
    }
    setVideoIdOverride(parsed)
    setVideoInput('')
    setVideoInputError(false)
  }

  const sortedComments = useMemo(() => {
    const copy = [...comments]
    if (sortMode === 'likes') {
      copy.sort((a, b) => b.upvotes - a.upvotes || a.timestampSeconds - b.timestampSeconds)
    } else {
      copy.sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    }
    return copy
  }, [comments, sortMode])

  const activeCommentId = useMemo(() => {
    let best: VodComment | null = null
    let bestDelta = Infinity
    for (const c of comments) {
      const delta = Math.abs(c.timestampSeconds - currentTime)
      if (delta <= HIGHLIGHT_WINDOW_SECONDS && delta < bestDelta) {
        best = c
        bestDelta = delta
      }
    }
    return best?.id ?? null
  }, [comments, currentTime])

  useEffect(() => {
    if (!syncMode || !activeCommentId || activeCommentId === lastScrolledId.current) return
    const el = commentRefs.current.get(activeCommentId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      lastScrolledId.current = activeCommentId
    }
  }, [activeCommentId, syncMode])

  function isCommentActive(c: VodComment) {
    return Math.abs(c.timestampSeconds - currentTime) <= HIGHLIGHT_WINDOW_SECONDS
  }

  if (loading) {
    return <div className="vod-review vod-review--status">VOD 정보를 불러오는 중...</div>
  }
  if (loadError || !vod) {
    return (
      <div className="vod-review vod-review--status vod-review--error">
        {loadError ?? '문제가 발생했습니다.'}
      </div>
    )
  }

  const activeVideoId = videoIdOverride ?? vod.youtubeId

  return (
    <div className="vod-review">
      <div className="vod-review__main">
        <YouTubePlayer
          ref={playerRef}
          videoId={activeVideoId}
          onTimeUpdate={setCurrentTime}
        />

        <form className="vod-swap" onSubmit={handleSwapVideo}>
          <input
            className={videoInputError ? 'vod-swap__input vod-swap__input--error' : 'vod-swap__input'}
            value={videoInput}
            onChange={(e) => {
              setVideoInput(e.target.value)
              setVideoInputError(false)
            }}
            placeholder="테스트용: 다른 YouTube 링크나 영상 ID 붙여넣기"
          />
          <button type="submit" className="btn btn--ghost btn--small">
            영상 교체
          </button>
        </form>

        <VodMeta vod={vod} />
      </div>

      <div className="vod-review__side">
        <div className="feedback-form">
          <button type="button" className="feedback-form__now-btn" onClick={handleUseCurrentTime}>
            📍 [{formatTimestamp(currentTime)}] 시점에 댓글 추가
          </button>

          <form onSubmit={handleSubmit} className="feedback-form__fields">
            <div className="feedback-form__row">
              <label className="feedback-form__label" htmlFor="vod-ts-input">
                타임스탬프
              </label>
              <input
                id="vod-ts-input"
                className="feedback-form__timestamp"
                value={timestampInput}
                onChange={(e) => {
                  setTimestampInput(e.target.value)
                  setTimestampTouched(true)
                }}
                placeholder="1:23"
              />
              {timestampTouched && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={handleUseCurrentTime}
                >
                  현재 시간으로
                </button>
              )}
            </div>

            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, COMMENT_MAX))}
              maxLength={COMMENT_MAX}
              placeholder="이 시점에 대한 피드백을 남겨보세요."
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

        <div className="comment-feed">
          <div className="comment-feed__header">
            <h3>피드백 ({comments.length})</h3>
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
                title="영상 재생 위치에 맞춰 자동으로 스크롤합니다"
              >
                🔄 싱크 모드
              </button>
            </div>
          </div>

          {sortedComments.length === 0 && (
            <p className="comment-feed__empty">아직 피드백이 없습니다. 첫 피드백을 남겨보세요!</p>
          )}

          <ul className="comment-feed__list">
            {sortedComments.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                isActive={isCommentActive(c)}
                currentTime={currentTime}
                onSeek={handleSeek}
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
                registerRef={(el) => {
                  if (el) commentRefs.current.set(c.id, el)
                  else commentRefs.current.delete(c.id)
                }}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

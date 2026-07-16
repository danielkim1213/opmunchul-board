import type { PostComment } from '../api/posts'
import RankBadge from '../components/RankBadge'
import { formatTimestamp } from './time'

const HIGHLIGHT_WINDOW_SECONDS = 5

interface CommentCardProps {
  comment: PostComment
  /** 'plain' (tip posts) hides the timestamp/global badge entirely. */
  variant: 'plain' | 'feedback'
  isActive: boolean
  currentTime?: number
  isReply?: boolean
  onSeek?: (seconds: number) => void
  onUpvote: (id: string) => void
  replyOpen: boolean
  replyContent: string
  onReplyToggle: (id: string | null) => void
  onReplyChange: (value: string) => void
  onReplySubmit: () => void
  replySubmitting: boolean
  registerRef: (el: HTMLLIElement | null) => void
  /** False when the viewer doesn't meet the post's tier requirement — locks upvote/reply. */
  canInteract?: boolean
}

export default function CommentCard({
  comment,
  variant,
  isActive,
  currentTime = 0,
  isReply = false,
  onSeek,
  onUpvote,
  replyOpen,
  replyContent,
  onReplyToggle,
  onReplyChange,
  onReplySubmit,
  replySubmitting,
  registerRef,
  canInteract = true,
}: CommentCardProps) {
  const isGlobal = comment.timestampSeconds === null

  return (
    <li
      ref={registerRef}
      className={`comment-card${isActive ? ' comment-card--active' : ''}${
        isReply ? ' comment-card--reply' : ''
      }`}
    >
      <div className="comment-card__header">
        <span className="comment-card__tag">{comment.author.battletag}</span>
        <RankBadge
          rankLabel={comment.author.rankLabel}
          rankIcon={comment.author.rankIcon}
          roleLabel={comment.author.roleLabel}
          mostHeroes={comment.author.mostHeroes}
        />
        {variant === 'feedback' &&
          (isGlobal ? (
            <span className="global-badge">🗒 전체 피드백</span>
          ) : (
            <button
              type="button"
              className="timestamp-badge"
              onClick={() => onSeek?.(comment.timestampSeconds as number)}
              title="이 시점으로 영상 이동"
            >
              [{formatTimestamp(comment.timestampSeconds as number)}]
            </button>
          ))}
      </div>

      <p className="comment-card__content">{comment.content}</p>

      <div className="comment-card__actions">
        <button
          type="button"
          className={`action-btn${comment.upvotedByMe ? ' action-btn--active' : ''}`}
          onClick={() => onUpvote(comment.id)}
          disabled={!canInteract}
          title={canInteract ? undefined : '자격 티어가 아닙니다'}
        >
          👍 따봉{comment.upvotes > 0 ? ` ${comment.upvotes}` : ''}
        </button>
        {!isReply && (
          <button
            type="button"
            className="action-btn"
            onClick={() => onReplyToggle(replyOpen ? null : comment.id)}
            disabled={!canInteract}
            title={canInteract ? undefined : '자격 티어가 아닙니다'}
          >
            💬 답글{comment.replies.length > 0 ? ` ${comment.replies.length}` : ''}
          </button>
        )}
      </div>

      {replyOpen && !isReply && canInteract && (
        <div className="reply-form">
          <textarea
            value={replyContent}
            onChange={(e) => onReplyChange(e.target.value.slice(0, 500))}
            placeholder="답글을 입력하세요."
            rows={2}
            autoFocus
          />
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={replySubmitting || !replyContent.trim()}
            onClick={onReplySubmit}
          >
            {replySubmitting ? '등록 중...' : '답글 등록'}
          </button>
        </div>
      )}

      {comment.replies.length > 0 && (
        <ul className="comment-card__replies">
          {comment.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              variant={variant}
              isActive={
                reply.timestampSeconds !== null &&
                Math.abs(reply.timestampSeconds - currentTime) <= HIGHLIGHT_WINDOW_SECONDS
              }
              currentTime={currentTime}
              isReply
              onSeek={onSeek}
              onUpvote={onUpvote}
              replyOpen={false}
              replyContent=""
              onReplyToggle={() => {}}
              onReplyChange={() => {}}
              onReplySubmit={() => {}}
              replySubmitting={false}
              registerRef={() => {}}
              canInteract={canInteract}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

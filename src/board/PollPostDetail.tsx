import { useState } from 'react'
import { ApiError } from '../api/auth'
import { deletePost, votePoll } from '../api/posts'
import type { PollOption, PollPostDetail as PollPost } from '../api/posts'
import RankBadge from '../components/RankBadge'

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

  const canInteract = post.viewerEligible

  async function handleDeletePost() {
    if (!window.confirm('투표를 삭제하시겠어요? 되돌릴 수 없습니다.')) return
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
        <div className="tier-lock-note">🔒 이 투표는 지정된 티어만 참여할 수 있습니다. 결과는 볼 수 있어요.</div>
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
    </div>
  )
}

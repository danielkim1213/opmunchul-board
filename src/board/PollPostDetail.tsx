import { useRef, useState } from 'react'
import { boardErrorMessage } from '../api/auth'
import { deletePost, votePoll, TIER_LABEL_KO } from '../api/posts'
import type { PollOption, PollPostDetail as PollPost } from '../api/posts'
import RankBadge from '../components/RankBadge'
import UsernameButton from './UsernameButton'
import TierIcon from '../components/TierIcon'

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
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Ref (not state) so an in-flight vote never remounts/hides the header actions.
  const votingRef = useRef(false)

  const canInteract = post.viewerEligible
  const canEdit = post.isMine
  const canDelete = post.canDelete

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

  // Clicking the option you already voted for cancels the vote (toggle).
  async function handleVote(optionId: string) {
    if (!canInteract || votingRef.current) return
    votingRef.current = true
    setError(null)
    try {
      const result = await votePoll(post.id, optionId)
      setOptions(result.options)
      setTotalVotes(result.totalVotes)
      setMyOptionId(result.myOptionId)
    } catch (err) {
      setError(boardErrorMessage(err, '투표에 실패했습니다. 다시 시도해 주세요.'))
    } finally {
      votingRef.current = false
    }
  }

  return (
    <div className="post-detail">
      <button type="button" className="post-detail__back" onClick={onBack}>
        ← 목록으로
      </button>

      <div className="post-detail__header">
        <div className="post-detail__header-top">
          <div className="post-detail__badges">
            {post.isNotice && <span className="notice-badge">📌 공지</span>}
            <span className="post-detail__type-badge post-detail__type-badge--poll">🗳 투표</span>
          </div>
          {(canEdit || canDelete) && (
            <div className="post-detail__actions">
              {canEdit && (
                <button type="button" className="btn btn--ghost btn--small" onClick={onEdit}>
                  ✏️ 수정
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={handleDeletePost}
                  disabled={deleting}
                >
                  🗑 삭제
                </button>
              )}
            </div>
          )}
        </div>
        <h1 className={`post-detail__title${post.isNotice ? ' post-detail__title--notice' : ''}`}>
          {post.title}
        </h1>
        <div className="post-detail__author">
          <UsernameButton
            username={post.author.username}
            isAdmin={post.author.isAdmin}
            isBanned={post.author.isBanned}
            className="post-detail__tag"
          />
          <RankBadge
            rankLabel={post.author.rankLabel}
            rankIcon={post.author.rankIcon}
            roleLabel={post.author.roleLabel}
            mostHeroes={post.author.mostHeroes}
          />
        </div>
      </div>

      <div className="poll__tiers">
        <span className="poll__tiers-label">참여 가능 티어</span>
        {post.allowedTiers.length === 0 ? (
          <span className="tier-chip tier-chip--all">전체</span>
        ) : (
          post.allowedTiers.map((tier) => (
            <span key={tier} className="tier-chip tier-chip--icon" title={TIER_LABEL_KO[tier]}>
              <TierIcon tier={tier} className="tier-chip__img" />
            </span>
          ))
        )}
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
                  disabled={!canInteract}
                  title={isMine ? '다시 누르면 투표가 취소됩니다' : undefined}
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
        <p className="poll__total">
          총 {totalVotes}명 참여
          {myOptionId && <span className="poll__cancel-hint"> · 선택한 항목을 다시 누르면 취소됩니다</span>}
        </p>
        {error && <div className="feedback-form__error">{error}</div>}
      </div>
    </div>
  )
}

import type { PostSummary, PostType } from '../api/posts'
import { TIER_LABEL_KO } from '../api/posts'
import RankBadge from '../components/RankBadge'

type Filter = PostType | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'tip', label: '💡 팁' },
  { key: 'feedback', label: '🎬 피드백' },
  { key: 'poll', label: '🗳 투표' },
]

const TYPE_BADGE: Record<PostType, { emoji: string; label: string }> = {
  tip: { emoji: '💡', label: '팁' },
  feedback: { emoji: '🎬', label: '피드백' },
  poll: { emoji: '🗳', label: '투표' },
}

interface BoardListProps {
  posts: PostSummary[]
  loading: boolean
  error: string | null
  filter: Filter
  onFilterChange: (filter: Filter) => void
  onSelect: (postId: string) => void
  onCreate: () => void
}

export default function BoardList({
  posts,
  loading,
  error,
  filter,
  onFilterChange,
  onSelect,
  onCreate,
}: BoardListProps) {
  return (
    <div className="board-list">
      <div className="board-list__header">
        <div className="board-list__filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip${filter === f.key ? ' chip--active' : ''}`}
              onClick={() => onFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--primary btn--small" onClick={onCreate}>
          글쓰기
        </button>
      </div>

      {loading && <p className="board-list__status">불러오는 중...</p>}
      {error && <p className="board-list__status board-list__status--error">{error}</p>}
      {!loading && !error && posts.length === 0 && (
        <p className="board-list__status">아직 게시글이 없습니다. 첫 글을 남겨보세요!</p>
      )}

      <ul className="board-list__cards">
        {posts.map((post) => {
          const badge = TYPE_BADGE[post.type]
          return (
            <li key={post.id}>
              <button type="button" className="post-card" onClick={() => onSelect(post.id)}>
                {post.type === 'feedback' && (
                  <img
                    className="post-card__thumb"
                    src={`https://img.youtube.com/vi/${post.youtubeId}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="post-card__body">
                  <div className="post-card__top">
                    <span className={`post-card__type post-card__type--${post.type}`}>
                      {badge.emoji} {badge.label}
                    </span>
                    {post.allowedTiers.length > 0 && (
                      <span
                        className="post-card__lock"
                        title={post.allowedTiers.map((t) => TIER_LABEL_KO[t]).join(', ')}
                      >
                        🔒 {post.allowedTiers.length}개 티어 제한
                        {!post.viewerEligible && ' · 참여 불가'}
                      </span>
                    )}
                  </div>
                  <div className="post-card__title">{post.title}</div>
                  <div className="post-card__meta">
                    <span className="post-card__author">
                      {post.author.username}
                      <RankBadge
                        rankLabel={post.author.rankLabel}
                        rankIcon={post.author.rankIcon}
                        roleLabel={post.author.roleLabel}
                        mostHeroes={post.author.mostHeroes}
                        bracketed={false}
                      />
                    </span>
                    {post.type === 'poll' ? (
                      <span className="post-card__stat">
                        🗳 {post.optionCount}개 선택지 · {post.voteCount}표
                      </span>
                    ) : (
                      <span className="post-card__stat">💬 {post.commentCount}</span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

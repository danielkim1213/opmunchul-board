import type { PostSummary, PostType } from '../api/posts'
import { TIER_LABEL_KO } from '../api/posts'
import RankBadge from '../components/RankBadge'
import UsernameButton from './UsernameButton'

type Filter = PostType | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'tip', label: '팁' },
  { key: 'feedback', label: '피드백' },
  { key: 'poll', label: '투표' },
]

const TYPE_LABEL: Record<PostType, string> = {
  tip: '팁',
  feedback: '피드백',
  poll: '투표',
}

interface BoardListProps {
  posts: PostSummary[]
  loading: boolean
  error: string | null
  filter: Filter
  page: number
  totalPages: number
  total: number
  onFilterChange: (filter: Filter) => void
  onPageChange: (page: number) => void
  onSelect: (postId: string) => void
  onCreate: () => void
}

export default function BoardList({
  posts,
  loading,
  error,
  filter,
  page,
  totalPages,
  total,
  onFilterChange,
  onPageChange,
  onSelect,
  onCreate,
}: BoardListProps) {
  const showPager = totalPages > 1

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
          const typeLabel = TYPE_LABEL[post.type]
          return (
            <li key={post.id}>
              <div
                className={`post-card${post.isNotice ? ' post-card--notice' : ''}`}
                role="link"
                tabIndex={0}
                onClick={() => onSelect(post.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(post.id)
                  }
                }}
              >
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
                    {post.isNotice && <span className="notice-badge">공지</span>}
                    <span className={`post-card__type post-card__type--${post.type}`}>
                      {typeLabel}
                    </span>
                    {post.allowedTiers.length > 0 && (
                      <span
                        className="post-card__lock"
                        title={post.allowedTiers.map((t) => TIER_LABEL_KO[t]).join(', ')}
                      >
                        {post.allowedTiers.length}개 티어 제한
                        {!post.viewerEligible && ' · 참여 불가'}
                      </span>
                    )}
                  </div>
                  <div className="post-card__title">{post.title}</div>
                  <div className="post-card__meta">
                    <span className="post-card__author">
                      <UsernameButton
                        username={post.author.username}
                        isAdmin={post.author.isAdmin}
                        isBanned={post.author.isBanned}
                      />
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
                        {post.optionCount}개 선택지 · {post.voteCount}표
                      </span>
                    ) : (
                      <span className="post-card__stat">댓글 {post.commentCount}</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {showPager && (
        <nav className="board-list__pager" aria-label="게시글 페이지">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            이전
          </button>
          <span className="board-list__pager-info">
            {page} / {totalPages}
            <span className="board-list__pager-total"> · 전체 {total}개</span>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            다음
          </button>
        </nav>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import AuthFlow from './auth/AuthFlow'
import { fetchMe, logout } from './api/auth'
import type { AuthUser } from './api/auth'
import './App.css'

const SAMPLE_POSTS = [
  { id: 1, tag: '겐트위한', title: '겐지 원챔인데 마스터까지 가능함?', comments: 42 },
  { id: 2, tag: '힐러의분노', title: '아나 수면총 각 공유합니다 (일리오스)', comments: 17 },
  { id: 3, tag: '방벽뒤에숨어', title: '이번 시즌 탱커 티어 정리.txt', comments: 88 },
  { id: 4, tag: '옵문철국밥', title: '경쟁전에서 한조 픽하는 사람 심리가 뭐냐', comments: 156 },
]

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setRestoring(false))
  }, [])

  async function handleLogout() {
    await logout()
    setUser(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__logo">
          <span className="topbar__mark" aria-hidden />
          옵문철 <em>게시판</em>
        </div>
        {user && (
          <div className="topbar__user">
            {user.avatar && <img src={user.avatar} alt="" />}
            <span className="topbar__tag">{user.battletag}</span>
            <span className="topbar__rank">{user.rankLabel}</span>
            <button className="btn btn--ghost btn--small" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        )}
      </header>

      {restoring ? (
        <main className="board">
          <div className="board__note">세션을 확인하는 중...</div>
        </main>
      ) : !user ? (
        <main className="landing">
          <section className="hero">
            <p className="hero__kicker">FOR OVERWATCH 2 PLAYERS</p>
            <h1 className="hero__title">
              티어 인증으로 시작하는
              <br />
              진짜 옵치 커뮤니티
            </h1>
            <p className="hero__desc">
              배틀태그 하나로 로그인부터 랭크 인증 배지까지. 비공개 프로필은
              사절, 실력은 공개적으로 증명하세요.
            </p>
            <ul className="hero__points">
              <li>배틀태그 기반 원클릭 가입</li>
              <li>Blizzard 전적 기반 티어 배지 자동 부여</li>
              <li>티어 인증 유저만 참여하는 게시판</li>
            </ul>
          </section>
          <section className="auth-panel">
            <AuthFlow onAuthenticated={setUser} />
          </section>
        </main>
      ) : (
        <main className="board">
          <div className="board__welcome">
            <h1>
              환영합니다, <span>{user.battletag}</span> 님
            </h1>
            <p>
              인증 티어 <strong className="rank-pill">[{user.rankLabel}]</strong>{' '}
              배지가 부여되었습니다.
            </p>
          </div>

          <div className="board__list">
            <div className="board__header">
              <h2>인기 글</h2>
              <button className="btn btn--primary btn--small">글쓰기</button>
            </div>
            {SAMPLE_POSTS.map((post) => (
              <article key={post.id} className="post">
                <div className="post__title">{post.title}</div>
                <div className="post__meta">
                  <span className="post__tag">{post.tag}</span>
                  <span className="post__comments">💬 {post.comments}</span>
                </div>
              </article>
            ))}
            <p className="board__note">
              게시판 기능은 다음 단계에서 구현될 예정입니다.
            </p>
          </div>
        </main>
      )}

      <footer className="footer">
        옵문철 게시판 · 비공식 팬 사이트 · 전적 데이터 제공:{' '}
        <a href="https://overfast-api.tekrop.fr/" target="_blank" rel="noreferrer">
          OverFast API
        </a>
      </footer>
    </div>
  )
}

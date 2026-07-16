import { useEffect, useState } from 'react'
import AuthFlow from './auth/AuthFlow'
import { ApiError, applyBlizzardLink, fetchMe, linkBlizzard, logout } from './api/auth'
import type { AuthUser } from './api/auth'
import RankBadge from './components/RankBadge'
import Board from './board/Board'
import './App.css'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [changingAccount, setChangingAccount] = useState(false)

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

  async function handleChangeBlizzard() {
    setChangingAccount(true)
    try {
      // force: true bounces through Battle.net logout first, so the
      // credential screen shows up again instead of silently reusing
      // whichever account is already signed in on this browser.
      const link = await linkBlizzard({ force: true })
      const updated = await applyBlizzardLink(link.state)
      setUser(updated)
      window.alert(`배틀태그가 ${updated.battletag} 로 변경되었습니다.`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LINK_CANCELLED') {
        // User closed the popup — nothing to report.
      } else if (err instanceof ApiError && err.code === 'BATTLETAG_TAKEN') {
        window.alert('이미 다른 계정에 연동된 배틀태그입니다.')
      } else if (err instanceof ApiError && err.code === 'POPUP_BLOCKED') {
        window.alert('팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.')
      } else {
        window.alert('배틀태그 변경에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      setChangingAccount(false)
    }
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
            <span className="topbar__tag">{user.username}</span>
            <span className="topbar__bt">{user.battletag}</span>
            <RankBadge
              rankLabel={user.rankLabel}
              rankIcon={user.rankIcon}
              roleLabel={user.roleLabel}
              mostHeroes={user.mostHeroes}
              bracketed={false}
            />
            <button
              className="btn btn--ghost btn--small"
              onClick={handleChangeBlizzard}
              disabled={changingAccount}
            >
              {changingAccount ? '변경 중...' : '배틀태그 변경'}
            </button>
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
              Blizzard 계정 인증으로
              <br />
              시작하는 진짜 옵치 커뮤니티
            </h1>
            <p className="hero__desc">
              원하는 아이디로 가입하고, Blizzard 계정 연동으로 배틀태그를
              안전하게 인증하세요. 도용 없는 진짜 전적만 배지로 보여줍니다.
            </p>
            <ul className="hero__points">
              <li>원하는 아이디로 가입 + 중복확인</li>
              <li>Blizzard OAuth 연동으로 배틀태그 인증</li>
              <li>Blizzard 전적 기반 티어 배지 자동 부여</li>
            </ul>
          </section>
          <section className="auth-panel">
            <AuthFlow onAuthenticated={setUser} />
          </section>
        </main>
      ) : (
        <main className="board">
          <Board />
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

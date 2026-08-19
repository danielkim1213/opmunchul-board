import { useEffect, useRef, useState } from 'react'
import AuthFlow from './auth/AuthFlow'
import { ApiError, applyBlizzardLink, bannedUserMessage, fetchMe, linkBlizzard, logout } from './api/auth'
import type { AuthUser } from './api/auth'
import RankBadge from './components/RankBadge'
import Board from './board/Board'
import { AdminSessionProvider } from './board/AdminSession'
import './App.css'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [changingAccount, setChangingAccount] = useState(false)
  const changeAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setRestoring(false))
    return () => {
      changeAbortRef.current?.abort()
    }
  }, [])

  async function handleLogout() {
    await logout()
    setUser(null)
  }

  async function handleChangeBlizzard() {
    if (changingAccount) {
      changeAbortRef.current?.abort()
      return
    }
    const ac = new AbortController()
    changeAbortRef.current = ac
    setChangingAccount(true)
    try {
      // force: true bounces through Battle.net logout first, so the
      // credential screen shows up again instead of silently reusing
      // whichever account is already signed in on this browser.
      const link = await linkBlizzard({ force: true, signal: ac.signal })
      const updated = await applyBlizzardLink(link.state)
      setUser(updated)
      window.alert(`배틀태그가 ${updated.battletag} 로 변경되었습니다.`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LINK_CANCELLED') {
        // User cancelled from the UI — nothing to report.
      } else if (err instanceof ApiError && err.code === 'BATTLETAG_TAKEN') {
        window.alert('이미 다른 계정에 연동된 배틀태그입니다.')
      } else if (err instanceof ApiError && err.code === 'BANNED') {
        window.alert(bannedUserMessage(err, 'link'))
      } else if (err instanceof ApiError && err.code === 'POPUP_BLOCKED') {
        window.alert('팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.')
      } else {
        window.alert('배틀태그 변경에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      if (changeAbortRef.current === ac) changeAbortRef.current = null
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
            <span className={`topbar__tag${user.isAdmin ? ' username--admin' : ''}`}>
              {user.username}
            </span>
            <span className="topbar__bt">{user.battletag}</span>
            <RankBadge
              rankLabel={user.rankLabel}
              rankIcon={user.rankIcon}
              roleLabel={user.roleLabel}
              mostHeroes={user.mostHeroes}
              bracketed={false}
            />
            <button className="btn btn--ghost btn--small" onClick={handleChangeBlizzard}>
              {changingAccount ? '변경 취소' : '배틀태그 변경'}
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
            <p className="hero__kicker">오버워치 2 플레이 리뷰 커뮤니티</p>
            <h1 className="hero__title">
              내 플레이를 올리고,
              <br />
              같이 답을 찾아보세요.
            </h1>
            <p className="hero__desc">
              팁을 나누고, 투표로 의견을 묻고, 영상의 필요한 순간에
              직접 피드백을 남길 수 있습니다.
            </p>
            <ul className="hero__points">
              <li>Blizzard 계정으로 플레이어 인증</li>
              <li>원하는 닉네임으로 자유롭게 활동</li>
              <li>인증된 티어를 참고한 구체적인 피드백</li>
            </ul>
          </section>
          <section className="auth-panel">
            <AuthFlow onAuthenticated={setUser} />
          </section>
        </main>
      ) : (
        <main className="board">
          <AdminSessionProvider viewerUsername={user.username} viewerIsAdmin={Boolean(user.isAdmin)}>
            <Board isAdmin={Boolean(user.isAdmin)} />
          </AdminSessionProvider>
        </main>
      )}

      <footer className="footer">
        옵문철 · 오버워치 2 비공식 커뮤니티 · 전적 데이터:{' '}
        <a href="https://overfast-api.tekrop.fr/" target="_blank" rel="noreferrer">
          OverFast API
        </a>
      </footer>
    </div>
  )
}

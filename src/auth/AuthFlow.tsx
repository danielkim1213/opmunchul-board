import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  bannedUserMessage,
  isValidPassword,
  isValidUsername,
  checkUsername,
  linkBlizzard,
  login as apiLogin,
  register as apiRegister,
  MIN_PASSWORD_LENGTH,
} from '../api/auth'
import type { AuthUser, BlizzardLink } from '../api/auth'
import RankBadge from '../components/RankBadge'

type Mode = 'login' | 'signup'
type NameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

interface AuthFlowProps {
  onAuthenticated: (user: AuthUser) => void
}

export default function AuthFlow({ onAuthenticated }: AuthFlowProps) {
  const [mode, setMode] = useState<Mode>('login')

  // Shared credential fields
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Signup-only state
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  const [checking, setChecking] = useState(false)
  const [link, setLink] = useState<BlizzardLink | null>(null)
  const [linking, setLinking] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const linkAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      linkAbortRef.current?.abort()
    }
  }, [])

  function switchMode(next: Mode) {
    linkAbortRef.current?.abort()
    setMode(next)
    setPassword('')
    setConfirmPassword('')
    setFormError(null)
    setNameStatus('idle')
    setLink(null)
  }

  function handleUsernameChange(value: string) {
    setUsername(value)
    setNameStatus('idle')
    setFormError(null)
  }

  async function handleCheckUsername() {
    if (!isValidUsername(username)) {
      setNameStatus('invalid')
      return
    }
    setChecking(true)
    setFormError(null)
    try {
      const { available } = await checkUsername(username)
      setNameStatus(available ? 'available' : 'taken')
    } catch (err) {
      setNameStatus(err instanceof ApiError && err.code === 'INVALID_USERNAME' ? 'invalid' : 'idle')
      if (!(err instanceof ApiError)) {
        setFormError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
      }
    } finally {
      setChecking(false)
    }
  }

  async function handleLink(force = false) {
    linkAbortRef.current?.abort()
    const ac = new AbortController()
    linkAbortRef.current = ac
    const previous = link
    setLinking(true)
    setFormError(null)
    if (force) setLink(null)
    try {
      const result = await linkBlizzard({ force, signal: ac.signal })
      setLink(result)
    } catch (err) {
      if (force && previous) setLink(previous)
      if (err instanceof ApiError && err.code === 'LINK_CANCELLED') {
        return
      }
      if (err instanceof ApiError) {
        setFormError(
          err.code === 'OAUTH_NOT_CONFIGURED'
            ? 'Blizzard 연동이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.'
            : err.code === 'POPUP_BLOCKED'
              ? '팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.'
              : err.code === 'LINK_TIMEOUT' || err.code === 'LINK_EXPIRED'
                ? '연동 시간이 만료되었습니다. 다시 시도해 주세요.'
                : 'Blizzard 연동에 실패했습니다. 다시 시도해 주세요.',
        )
      } else {
        setFormError('Blizzard 연동에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      if (linkAbortRef.current === ac) linkAbortRef.current = null
      setLinking(false)
    }
  }

  function handleCancelLink() {
    linkAbortRef.current?.abort()
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const user = await apiLogin(username, password)
      onAuthenticated(user)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? '아이디 또는 비밀번호가 올바르지 않습니다.'
          : err instanceof ApiError && err.code === 'RATE_LIMITED'
            ? '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
            : '로그인에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (nameStatus !== 'available') {
      setFormError('아이디 중복확인을 먼저 진행해 주세요.')
      return
    }
    if (!isValidPassword(password)) {
      window.alert(`비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
      setFormError(`비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
      return
    }
    if (password !== confirmPassword) {
      setFormError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (!link) {
      setFormError('Blizzard 계정 연동을 먼저 완료해 주세요.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const user = await apiRegister(username, password, link.state)
      onAuthenticated(user)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'USERNAME_TAKEN'
          ? '이미 사용 중인 아이디입니다.'
          : err instanceof ApiError && err.code === 'BATTLETAG_TAKEN'
            ? '이미 다른 계정에 연동된 배틀태그입니다.'
            : err instanceof ApiError && err.code === 'BANNED'
              ? bannedUserMessage(err, 'register')
              : err instanceof ApiError &&
                  (err.code === 'LINK_EXPIRED' || err.code === 'LINK_REQUIRED')
                ? 'Blizzard 연동이 만료되었습니다. 다시 연동해 주세요.'
                : err instanceof ApiError && err.code === 'WEAK_PASSWORD'
                  ? `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`
                  : '가입에 실패했습니다. 다시 시도해 주세요.',
      )
      if (err instanceof ApiError && (err.code === 'LINK_EXPIRED' || err.code === 'LINK_REQUIRED')) {
        setLink(null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const passwordValid = isValidPassword(password)
  const canRegister =
    nameStatus === 'available' &&
    passwordValid &&
    password === confirmPassword &&
    link !== null

  return (
    <div className="auth-card">
      <div className="auth-card__glow" aria-hidden />

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={`auth-tab${mode === 'login' ? ' auth-tab--active' : ''}`}
          onClick={() => switchMode('login')}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth-tab${mode === 'signup' ? ' auth-tab--active' : ''}`}
          onClick={() => switchMode('signup')}
        >
          회원가입
        </button>
      </div>

      {mode === 'login' ? (
        <form className="auth-step" onSubmit={handleLogin}>
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">아이디와 비밀번호로 로그인하세요.</p>

          <label className="field">
            <span className="field__label">아이디</span>
            <input
              className="field__input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디"
              autoComplete="username"
              autoFocus
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {formError && <p className="form-error">{formError}</p>}

          <button
            className="btn btn--primary btn--big"
            type="submit"
            disabled={submitting || username.length === 0 || password.length === 0}
          >
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
      ) : (
        <form className="auth-step" onSubmit={handleRegister}>
          <h2 className="auth-title">Create Account</h2>
          <p className="auth-subtitle">
            원하는 아이디로 가입한 뒤, Blizzard 계정을 연동해 배틀태그와 전적을 인증하세요.
          </p>

          <label className="field">
            <span className="field__label">아이디</span>
            <div className="field__row">
              <input
                className="field__input"
                type="text"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="3~16자 (한글/영문/숫자/_)"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn--ghost btn--check"
                onClick={handleCheckUsername}
                disabled={checking || username.trim().length === 0}
              >
                {checking ? '확인 중...' : '중복확인'}
              </button>
            </div>
            {nameStatus === 'available' && (
              <span className="field__hint field__hint--ok">사용 가능한 아이디입니다.</span>
            )}
            {nameStatus === 'taken' && (
              <span className="field__hint field__hint--err">이미 사용 중인 아이디입니다.</span>
            )}
            {nameStatus === 'invalid' && (
              <span className="field__hint field__hint--err">
                아이디는 3~16자의 한글/영문/숫자/_ 만 사용할 수 있습니다.
              </span>
            )}
          </label>

          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`최소 ${MIN_PASSWORD_LENGTH}자 이상`}
              autoComplete="new-password"
            />
            <span
              className={`field__hint${
                password.length === 0 ? '' : passwordValid ? ' field__hint--ok' : ' field__hint--err'
              }`}
            >
              비밀번호는 최소 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다.
            </span>
          </label>

          <label className="field">
            <span className="field__label">비밀번호 확인</span>
            <input
              className="field__input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 확인"
              autoComplete="new-password"
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <span className="field__hint field__hint--err">비밀번호가 일치하지 않습니다.</span>
            )}
          </label>

          <div className="link-section">
            {link ? (
              <div className="link-done">
                <div className="verify-badge">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="m7.5 12.2 3 3 6-6.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="player-chip">
                  {link.avatar && <img className="player-chip__avatar" src={link.avatar} alt="" />}
                  <div>
                    <div className="player-chip__tag">{link.battletag}</div>
                    <div className="player-chip__meta">
                      <RankBadge
                        rankLabel={link.rankLabel}
                        rankIcon={link.rankIcon}
                        roleLabel={link.roleLabel}
                        mostHeroes={link.mostHeroes}
                        bracketed={false}
                      />
                    </div>
                  </div>
                </div>
                {linking ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={handleCancelLink}
                  >
                    연동 취소
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => handleLink(true)}
                  >
                    다른 계정으로 다시 연동
                  </button>
                )}
              </div>
            ) : linking ? (
              <>
                <button type="button" className="btn btn--blizzard btn--big" disabled>
                  Blizzard 인증 대기 중...
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={handleCancelLink}
                >
                  연동 취소
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--blizzard btn--big"
                onClick={() => handleLink(false)}
              >
                Blizzard 계정 연동
              </button>
            )}
          </div>

          {formError && <p className="form-error">{formError}</p>}

          <button
            className="btn btn--primary btn--big"
            type="submit"
            disabled={submitting || !canRegister}
          >
            {submitting ? '가입 중...' : '가입하고 시작하기'}
          </button>
        </form>
      )}
    </div>
  )
}

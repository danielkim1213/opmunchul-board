import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  checkBattleTag,
  isValidBattleTag,
  login as apiLogin,
  register as apiRegister,
} from '../api/auth'
import type { AuthUser } from '../api/auth'

const SEARCH_MIN_MS = 500

type Step =
  | { name: 'input' }
  | { name: 'searching' }
  // Branch A: account already registered on the server
  | { name: 'login'; battletag: string }
  // Branch B: found on Blizzard (public profile) -> sign up
  | {
      name: 'register'
      battletag: string
      rankLabel: string
      rankIcon: string | null
      avatar: string | null
      title: string | null
    }
  // BattleTag not found (nonexistent or private profile)
  | { name: 'notFound' }
  | { name: 'error'; message: string }

interface AuthFlowProps {
  onAuthenticated: (user: AuthUser) => void
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function AuthFlow({ onAuthenticated }: AuthFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'input' })
  const [battletag, setBattletag] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Guards against out-of-order results when the user retries quickly
  const searchSeq = useRef(0)

  function resetToInput() {
    searchSeq.current += 1
    setStep({ name: 'input' })
    setPassword('')
    setConfirmPassword('')
    setFormError(null)
    setInputError(null)
  }

  async function runSearch(tag: string) {
    const seq = ++searchSeq.current
    setStep({ name: 'searching' })
    setPassword('')
    setConfirmPassword('')
    setFormError(null)

    try {
      // The 0.5s delay is purely cosmetic ("searching..." effect).
      const [result] = await Promise.all([checkBattleTag(tag), delay(SEARCH_MIN_MS)])
      if (seq !== searchSeq.current) return

      if (result.status === 'registered') {
        setStep({ name: 'login', battletag: result.battletag }) // Branch A
      } else {
        setStep({
          name: 'register', // Branch B
          battletag: result.battletag,
          rankLabel: result.rankLabel,
          rankIcon: result.rankIcon,
          avatar: result.avatar,
          title: result.title,
        })
      }
    } catch (err) {
      if (seq !== searchSeq.current) return
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        setStep({ name: 'notFound' })
      } else {
        setStep({
          name: 'error',
          message:
            err instanceof ApiError && err.code === 'UPSTREAM_ERROR'
              ? 'Blizzard 데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
              : '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.',
        })
      }
    }
  }

  function handleNext(e: FormEvent) {
    e.preventDefault()
    const tag = battletag.trim()
    if (!isValidBattleTag(tag)) {
      setInputError('올바른 배틀태그 형식이 아닙니다. 예: Tracer#1234')
      return
    }
    setInputError(null)
    void runSearch(tag)
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    if (step.name !== 'login') return
    setSubmitting(true)
    setFormError(null)
    try {
      const user = await apiLogin(step.battletag, password)
      onAuthenticated(user)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'BAD_PASSWORD'
          ? '비밀번호가 올바르지 않습니다.'
          : '로그인에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (step.name !== 'register') return
    if (password.length < 8) {
      setFormError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('비밀번호가 일치하지 않습니다.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const user = await apiRegister(step.battletag, password)
      onAuthenticated(user)
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'ALREADY_REGISTERED'
          ? '이미 가입된 배틀태그입니다.'
          : err instanceof ApiError && err.code === 'NOT_FOUND'
            ? '계정을 찾을 수 없습니다. 배틀태그를 확인해주세요. 프로필 비공개 시 검색이 되지 않습니다.'
            : '가입에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card__glow" aria-hidden />

      {step.name === 'input' && (
        <form className="auth-step" onSubmit={handleNext}>
          <h2 className="auth-title">Connect Your BattleTag</h2>
          <p className="auth-subtitle">
            배틀태그로 계정을 확인합니다. 등록된 유저는 로그인, 처음이라면
            티어 인증 후 가입이 진행됩니다.
          </p>

          <label className="field">
            <span className="field__label">BattleTag</span>
            <input
              className="field__input"
              type="text"
              value={battletag}
              onChange={(e) => setBattletag(e.target.value)}
              placeholder="Enter your BattleTag (e.g., Tracer#1234)"
              autoFocus
              spellCheck={false}
            />
          </label>

          {inputError && <p className="form-error">{inputError}</p>}

          <button className="btn btn--primary btn--big" type="submit">
            Next
          </button>
        </form>
      )}

      {step.name === 'searching' && (
        <div className="auth-step auth-step--center">
          <div className="spinner" role="status" aria-label="loading" />
          <p className="searching-text">
            Searching BattleTag in Blizzard Database...
          </p>
          <p className="searching-sub">{battletag.trim()}</p>
        </div>
      )}

      {step.name === 'login' && (
        <form className="auth-step" onSubmit={handleLogin}>
          <h2 className="auth-title">Welcome back, {step.battletag}!</h2>
          <p className="auth-subtitle">Enter your password to log in.</p>

          <label className="field slide-in">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
            />
          </label>

          {formError && <p className="form-error">{formError}</p>}

          <button
            className="btn btn--primary btn--big"
            type="submit"
            disabled={submitting || password.length === 0}
          >
            {submitting ? 'Logging in...' : 'Log In'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={resetToInput}>
            Back
          </button>
        </form>
      )}

      {step.name === 'register' && (
        <form className="auth-step" onSubmit={handleRegister}>
          <div className="verify-badge">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden>
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

          <h2 className="auth-title auth-title--green">Profile Verified!</h2>
          <p className="auth-subtitle">
            We fetched your rank:{' '}
            <span className="rank-pill">
              {step.rankIcon && <img src={step.rankIcon} alt="" />}
              [{step.rankLabel}]
            </span>
          </p>

          <div className="player-chip">
            {step.avatar && (
              <img className="player-chip__avatar" src={step.avatar} alt="" />
            )}
            <div>
              <div className="player-chip__tag">{step.battletag}</div>
              <div className="player-chip__meta">
                {step.title ?? 'Overwatch 2 Player'}
              </div>
            </div>
          </div>

          <label className="field slide-in">
            <span className="field__label">Choose Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
              autoFocus
            />
          </label>
          <label className="field slide-in">
            <span className="field__label">Confirm Password</span>
            <input
              className="field__input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 확인"
            />
          </label>

          {formError && <p className="form-error">{formError}</p>}

          <button
            className="btn btn--primary btn--big"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create Account & Start'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={resetToInput}>
            Back
          </button>
        </form>
      )}

      {step.name === 'notFound' && (
        <div className="auth-step auth-step--center">
          <div className="alert-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="44" height="44" fill="none">
              <path
                d="M12 3 2.5 20h19L12 3z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="17.2" r="1" fill="currentColor" />
            </svg>
          </div>

          <p className="auth-subtitle not-found-message">
            계정을 찾을 수 없습니다. 배틀태그를 확인해주세요. 프로필 비공개 시
            검색이 되지 않습니다.
          </p>

          <button className="btn btn--primary btn--big" onClick={resetToInput}>
            다시 시도
          </button>
        </div>
      )}

      {step.name === 'error' && (
        <div className="auth-step auth-step--center">
          <h2 className="auth-title auth-title--amber">Connection Error</h2>
          <p className="auth-subtitle">{step.message}</p>
          <button
            className="btn btn--primary btn--big"
            onClick={() => void runSearch(battletag.trim())}
          >
            Retry
          </button>
          <button className="btn btn--ghost" onClick={resetToInput}>
            Back
          </button>
        </div>
      )}
    </div>
  )
}

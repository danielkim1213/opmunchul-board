import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { ApiError, banUser, demoteFromAdmin, fetchModeratedUser, formatBanRemaining, promoteToAdmin, unbanUser } from '../api/auth'
import type { BanDuration, ModeratedUser } from '../api/auth'
import { useAdminSession } from './AdminSession'

const BAN_OPTIONS: { duration: BanDuration; label: string }[] = [
  { duration: '1h', label: '1시간' },
  { duration: '1d', label: '1일' },
  { duration: 'permanent', label: '영구' },
]

const BAN_DURATION_LABEL: Record<string, string> = {
  '1h': '1시간',
  '1d': '1일',
  '7d': '7일',
  '30d': '30일',
  permanent: '영구',
}

interface UsernameButtonProps {
  username: string
  isAdmin: boolean
  isBanned?: boolean
  className?: string
}

function moderationErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return '처리에 실패했습니다. 다시 시도해 주세요.'
  if (err.code === 'CANNOT_MODERATE_SELF') return '본인 계정은 처리할 수 없습니다.'
  if (err.code === 'CANNOT_MODERATE_FOUNDER') return '이 계정은 하향하거나 차단할 수 없습니다.'
  if (err.code === 'CANNOT_MODERATE_ADMIN') return '관리자 계정은 하향하거나 차단할 수 없습니다.'
  if (err.code === 'CANNOT_BAN_ADMIN') return '관리자 계정은 차단할 수 없습니다.'
  if (err.code === 'NOT_FOUND') return '해당 사용자를 찾을 수 없습니다.'
  return '처리에 실패했습니다. 다시 시도해 주세요.'
}

function banStatusText(user: ModeratedUser): string {
  if (!user.isBanned) return '차단되지 않음'
  if (user.banDuration === 'permanent' || user.banExpiresAt == null) return '영구 차단'
  const label = user.banDuration ? BAN_DURATION_LABEL[user.banDuration] : null
  const remainMs = user.banExpiresAt - Date.now()
  if (remainMs <= 0) return '차단 만료'
  const remainText = formatBanRemaining(remainMs)
  return label ? `${label} 차단 · ${remainText} 남음` : `${remainText} 남음`
}

export default function UsernameButton({
  username,
  isAdmin,
  isBanned = false,
  className,
}: UsernameButtonProps) {
  const session = useAdminSession()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [detail, setDetail] = useState<ModeratedUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const patched = session?.flags[username]
  const shownIsAdmin = patched?.isAdmin ?? isAdmin
  const shownIsBanned = patched?.isBanned ?? isBanned
  const canModerate =
    Boolean(session?.viewerIsAdmin) && session?.viewerUsername.toLowerCase() !== username.toLowerCase()

  const classes = [
    className,
    shownIsAdmin ? 'username--admin' : undefined,
    shownIsBanned ? 'username--banned' : undefined,
    canModerate ? 'username-btn' : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: Event) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function toggleMenu(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!canModerate) return
    if (open) {
      setOpen(false)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
    setOpen(true)
    setLoading(true)
    try {
      const user = await fetchModeratedUser(username)
      setDetail(user)
      session?.patchFlags(username, { isAdmin: user.isAdmin, isBanned: user.isBanned })
    } catch (err) {
      setOpen(false)
      window.alert(moderationErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function apply(user: ModeratedUser) {
    setDetail(user)
    session?.patchFlags(username, { isAdmin: user.isAdmin, isBanned: user.isBanned })
  }

  async function handlePromote(e: MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`${username} 님을 관리자로 승격할까요?`)) return
    setBusy(true)
    try {
      apply(await promoteToAdmin(username))
      setOpen(false)
    } catch (err) {
      window.alert(moderationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDemote(e: MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`${username} 님의 관리자 권한을 해제할까요?`)) return
    setBusy(true)
    try {
      apply(await demoteFromAdmin(username))
      setOpen(false)
    } catch (err) {
      window.alert(moderationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleBan(e: MouseEvent, duration: BanDuration) {
    e.stopPropagation()
    const tag = detail?.battletag ?? username
    const when = duration === 'permanent' ? '영구 차단' : `${BAN_DURATION_LABEL[duration] ?? duration} 동안 차단`
    if (
      !window.confirm(
        detail?.isAdmin
          ? `배틀태그 ${tag} 를 ${when}합니다.\n관리자 권한도 함께 해제되며, 같은 배틀태그로는 글·댓글·투표를 할 수 없습니다.`
          : `배틀태그 ${tag} 를 ${when}합니다.\n같은 배틀태그로는 로그인·재가입할 수 없습니다.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      apply(await banUser(username, duration))
      setOpen(false)
    } catch (err) {
      window.alert(moderationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleUnban(e: MouseEvent) {
    e.stopPropagation()
    const tag = detail?.battletag ?? username
    if (!window.confirm(`배틀태그 ${tag} 차단을 해제할까요?`)) return
    setBusy(true)
    try {
      apply(await unbanUser(username))
      setOpen(false)
    } catch (err) {
      window.alert(moderationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!canModerate) {
    return <span className={classes}>{username}</span>
  }

  return (
    <span ref={wrapRef} className="username-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={classes}
        onClick={toggleMenu}
        title="관리: 승격 / 차단"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {username}
        {shownIsBanned && <span className="username-ban-mark">차단</span>}
      </button>
      {open && pos && (
        <div
          className="user-mod-menu"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {loading || !detail ? (
            <p className="user-mod-menu__status">불러오는 중...</p>
          ) : (
            <>
              <div className="user-mod-menu__head">
                <strong>{detail.username}</strong>
                <span className="user-mod-menu__bt">{detail.battletag}</span>
                <span className="user-mod-menu__status-line">{banStatusText(detail)}</span>
              </div>
              {!detail.isAdmin && (
                <button
                  type="button"
                  className="user-mod-menu__item"
                  disabled={busy}
                  onClick={handlePromote}
                >
                  관리자로 승격
                </button>
              )}
              {detail.isAdmin && session?.viewerIsFounder && !detail.isFounder && (
                <button
                  type="button"
                  className="user-mod-menu__item"
                  disabled={busy}
                  onClick={handleDemote}
                >
                  관리자 하향
                </button>
              )}
              {detail.isAdmin && !(session?.viewerIsFounder && !detail.isFounder) ? (
                <p className="user-mod-menu__hint">
                  {detail.isFounder
                    ? '이 계정은 하향하거나 차단할 수 없습니다.'
                    : '관리자 계정은 하향하거나 차단할 수 없습니다.'}
                </p>
              ) : (
                <div className="user-mod-menu__bans">
                  <span className="user-mod-menu__label">
                    {detail.isBanned ? '차단 기간 변경' : '배틀태그 차단'}
                  </span>
                  <div className="user-mod-menu__ban-row">
                    {BAN_OPTIONS.map((opt) => (
                      <button
                        key={opt.duration}
                        type="button"
                        className={`user-mod-menu__ban${
                          opt.duration === 'permanent' ? ' user-mod-menu__ban--perm' : ''
                        }`}
                        disabled={busy}
                        onClick={(e) => handleBan(e, opt.duration)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {detail.isBanned && (
                    <button
                      type="button"
                      className="user-mod-menu__item"
                      disabled={busy}
                      onClick={handleUnban}
                    >
                      차단 해제
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  )
}

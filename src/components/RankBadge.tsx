import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MostHero } from '../api/auth'

interface RankBadgeProps {
  rankLabel: string
  rankIcon?: string | null
  roleLabel?: string | null
  mostHeroes?: MostHero[]
  /** Emphasize brackets like [Support · Silver IV] */
  bracketed?: boolean
}

function formatPlaytime(seconds: number): string {
  if (!seconds || seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem ? `${hours}시간 ${rem}분` : `${hours}시간`
}

export default function RankBadge({
  rankLabel,
  rankIcon,
  roleLabel,
  mostHeroes = [],
  bracketed = true,
}: RankBadgeProps) {
  const tipId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const label = roleLabel ? `${roleLabel} · ${rankLabel}` : rankLabel
  const text = bracketed ? `[${label}]` : label
  // Always allow hover on a verified rank badge — content may still be loading.
  const hasTooltip = Boolean(rankLabel)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setCoords(null)
      return
    }
    const rect = triggerRef.current.getBoundingClientRect()
    const tipWidth = 260
    const padding = 12
    let left = rect.left + rect.width / 2 - tipWidth / 2
    left = Math.max(padding, Math.min(left, window.innerWidth - tipWidth - padding))
    setCoords({
      top: rect.bottom + 10,
      left,
    })
  }, [open])

  return (
    <span
      className={`rank-badge${hasTooltip ? ' rank-badge--has-tip' : ''}${open ? ' rank-badge--open' : ''}`}
      ref={triggerRef}
      onMouseEnter={() => hasTooltip && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => hasTooltip && setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        className="rank-pill"
        tabIndex={hasTooltip ? 0 : undefined}
        aria-describedby={open ? tipId : undefined}
      >
        {rankIcon && <img src={rankIcon} alt="" />}
        {text}
      </span>

      {hasTooltip &&
        open &&
        coords &&
        createPortal(
          <div
            id={tipId}
            className="rank-tooltip"
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <div className="rank-tooltip__title">
              {roleLabel ? `${roleLabel} 모스트` : '모스트 영웅'}
            </div>
            {mostHeroes.length > 0 ? (
              <ol className="rank-tooltip__list">
                {mostHeroes.map((hero, index) => (
                  <li key={hero.key} className="rank-tooltip__item">
                    <span className="rank-tooltip__place">{index + 1}</span>
                    {hero.portrait && (
                      <img
                        className="rank-tooltip__portrait"
                        src={hero.portrait}
                        alt=""
                      />
                    )}
                    <span className="rank-tooltip__name">{hero.name}</span>
                    <span className="rank-tooltip__meta">
                      {formatPlaytime(hero.timePlayed)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rank-tooltip__empty">
                {roleLabel
                  ? '경쟁전 영웅 기록이 없습니다.'
                  : '모스트 정보를 불러오는 중이거나 아직 없습니다. 새로고침 후 다시 시도해 주세요.'}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

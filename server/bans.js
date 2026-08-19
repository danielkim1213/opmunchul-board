// BattleTag-keyed bans. Nicknames can be recreated, so moderation always
// targets battletag_key. expires_at NULL means a permanent ban.

export const BAN_DURATIONS = ['1h', '1d', 'permanent']

const BAN_DURATION_MS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

/**
 * @param {unknown} duration
 * @returns {{ key: string, expiresAt: number | null } | null}
 */
export function parseBanDuration(duration) {
  if (duration === 'permanent') return { key: 'permanent', expiresAt: null }
  const ms = BAN_DURATION_MS[duration]
  if (!ms) return null
  return { key: String(duration), expiresAt: Date.now() + ms }
}

/**
 * @param {{ expires_at?: number | null } | null | undefined} ban
 * @param {number} [now]
 */
export function isBanActive(ban, now = Date.now()) {
  if (!ban) return false
  return ban.expires_at == null || Number(ban.expires_at) > now
}

/**
 * JSON body for a 403 BANNED response. remainingMs/banExpiresAt are null
 * for a permanent ban.
 * @param {{ expires_at?: number | null } | null | undefined} ban
 * @param {number} [now]
 * @returns {{ error: 'BANNED', remainingMs: number | null, banExpiresAt: number | null } | null}
 */
export function banErrorBody(ban, now = Date.now()) {
  if (!isBanActive(ban, now)) return null
  if (ban.expires_at == null) {
    return { error: 'BANNED', remainingMs: null, banExpiresAt: null }
  }
  const banExpiresAt = Number(ban.expires_at)
  return {
    error: 'BANNED',
    remainingMs: Math.max(0, banExpiresAt - now),
    banExpiresAt,
  }
}

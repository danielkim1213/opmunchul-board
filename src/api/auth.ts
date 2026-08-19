// Auth API client — talks to Express.
// Dev: Vite proxies /api → localhost:3001
// Prod (Vercel): API is same-origin (/api/* rewrites to the serverless
// function), so leave VITE_API_URL unset. Only set it if the API ever
// moves to a different origin.

const TOKEN_KEY = 'opmunchul.token'
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export const MIN_PASSWORD_LENGTH = 8

function apiUrl(path: string): string {
  const p = path.startsWith('/api') ? path : `/api${path}`
  return `${API_BASE}${p}`
}

export interface MostHero {
  key: string
  name: string
  portrait: string | null
  timePlayed: number
  gamesPlayed: number
}

export interface AuthUser {
  username: string
  battletag: string
  /** Admin accounts can pin notices and moderate (delete) any post/comment. */
  isAdmin: boolean
  rankLabel: string
  rankIcon: string | null
  rankRole: string | null
  roleLabel: string | null
  mostHeroes: MostHero[]
  avatar: string | null
  createdAt: number
  rankFetchedAt?: number | null
}

/** Result of a completed Blizzard OAuth link, ready to feed into register(). */
export interface BlizzardLink {
  state: string
  battletag: string
  rankLabel: string
  rankIcon: string | null
  rankRole: string | null
  roleLabel: string | null
  mostHeroes: MostHero[]
  avatar: string | null
  title: string | null
}

export class ApiError extends Error {
  code: string
  httpStatus: number
  remainingMs: number | null
  banExpiresAt: number | null
  constructor(
    httpStatus: number,
    code: string,
    message?: string,
    extras?: { remainingMs?: number | null; banExpiresAt?: number | null },
  ) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.httpStatus = httpStatus
    this.remainingMs = extras?.remainingMs ?? null
    this.banExpiresAt = extras?.banExpiresAt ?? null
  }
}

export function extrasFromErrorBody(data: unknown): {
  remainingMs?: number | null
  banExpiresAt?: number | null
} {
  if (!data || typeof data !== 'object') return {}
  const body = data as { remainingMs?: unknown; banExpiresAt?: unknown }
  return {
    remainingMs:
      body.remainingMs === null || typeof body.remainingMs === 'number' ? body.remainingMs : undefined,
    banExpiresAt:
      body.banExpiresAt === null || typeof body.banExpiresAt === 'number'
        ? body.banExpiresAt
        : undefined,
  }
}

/** Human-readable remaining ban time, e.g. "47분", "1시간 12분". */
export function formatBanRemaining(remainingMs: number): string {
  const ms = Math.max(0, remainingMs)
  const totalSec = Math.ceil(ms / 1000)
  if (totalSec < 60) return `${Math.max(1, totalSec)}초`
  const totalMin = Math.ceil(ms / 60_000)
  if (totalMin < 60) return `${totalMin}분`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours < 24) return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}일 ${remHours}시간` : `${days}일`
}

export function bannedUserMessage(
  err: ApiError,
  action: 'write' | 'register' | 'link' = 'write',
): string {
  const remaining =
    err.remainingMs != null ? err.remainingMs : err.banExpiresAt != null ? err.banExpiresAt - Date.now() : null
  if (remaining == null) {
    if (action === 'write') return '영구 차단되어 글을 쓸 수 없습니다.'
    if (action === 'link') return '영구 차단된 배틀태그입니다. 연동할 수 없습니다.'
    return '영구 차단된 배틀태그입니다. 가입할 수 없습니다.'
  }
  if (remaining <= 0) return '차단이 곧 해제됩니다. 잠시 후 다시 시도해 주세요.'
  const left = formatBanRemaining(remaining)
  if (action === 'write') return `차단되어 글을 쓸 수 없습니다. 남은 시간: ${left}`
  return `차단된 배틀태그입니다. 남은 시간: ${left}`
}

export function boardErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'BANNED') return bannedUserMessage(err, 'write')
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return '로그인이 필요합니다.'
  if (err instanceof ApiError && err.code === 'TIER_NOT_ALLOWED') return '자격 티어가 아닙니다.'
  return fallback
}

const USERNAME_RE = /^[A-Za-z0-9가-힣_]{3,16}$/
export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username.trim())
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function handle<T>(res: Response): Promise<T> {
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string } | null
    throw new ApiError(res.status, err?.error ?? 'UNKNOWN', err?.message, extrasFromErrorBody(data))
  }
  return data as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path))
  return handle<T>(res)
}

async function authedGet<T>(path: string): Promise<T> {
  const token = getToken()
  const res = await fetch(apiUrl(path), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  return handle<T>(res)
}

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

export function checkUsername(username: string): Promise<{ available: boolean; username: string }> {
  return post('/auth/check-username', { username })
}

type PollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'unknown' }
  | { status: 'error'; message?: string }
  | ({ status: 'linked'; battletag: string } & Omit<BlizzardLink, 'state' | 'battletag'>)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Kick off a Blizzard OAuth link in a popup and resolve once the account is
 * linked. Polls the server so it works across origins (dev proxy included).
 *
 * Pass `force: true` to route through Battle.net's logout page first, so a
 * user who linked the wrong account gets the credential prompt again
 * instead of silently reusing whatever Battle.net session is active in
 * their browser.
 *
 * Do not treat `popup.closed` as cancellation. Battle.net serves
 * `Cross-Origin-Opener-Policy: same-origin`, which severs the opener
 * relationship as soon as the popup lands on battle.net — the handle then
 * reports `closed === true` even while the login window is still on screen.
 * Success is detected only via `/auth/blizzard/poll` (and an optional abort
 * signal if the user cancels from our UI).
 */
export async function linkBlizzard(
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<BlizzardLink> {
  const query = options.force ? '?force=1' : ''
  const { state, authorizeUrl } = await get<{ state: string; authorizeUrl: string }>(
    `/auth/blizzard/start${query}`,
  )

  if (options.signal?.aborted) {
    throw new ApiError(0, 'LINK_CANCELLED')
  }

  const popup = window.open(
    authorizeUrl,
    `blizzard-oauth-${state.slice(0, 12)}`,
    'width=520,height=720,menubar=no,toolbar=no',
  )
  if (!popup) {
    throw new ApiError(0, 'POPUP_BLOCKED')
  }
  try {
    popup.focus()
  } catch {
    // COOP may already have severed the handle; the popup can still be visible.
  }

  const closePopup = () => {
    try {
      popup.close()
    } catch {
      // ignore — a COOP-severed handle cannot be closed from the opener
    }
  }

  const onAbort = () => closePopup()
  options.signal?.addEventListener('abort', onAbort)

  const deadline = Date.now() + 1000 * 60 * 10

  try {
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new ApiError(0, 'LINK_CANCELLED')
      }

      let result: PollResult | null = null
      try {
        result = await get<PollResult>(`/auth/blizzard/poll?state=${encodeURIComponent(state)}`)
      } catch {
        result = null
      }

      if (result?.status === 'linked') {
        closePopup()
        return {
          state,
          battletag: result.battletag,
          rankLabel: result.rankLabel,
          rankIcon: result.rankIcon,
          rankRole: result.rankRole,
          roleLabel: result.roleLabel,
          mostHeroes: result.mostHeroes ?? [],
          avatar: result.avatar,
          title: result.title,
        }
      }
      if (result?.status === 'error') {
        closePopup()
        throw new ApiError(502, 'LINK_FAILED', result.message)
      }
      if (result?.status === 'expired' || result?.status === 'unknown') {
        closePopup()
        throw new ApiError(400, 'LINK_EXPIRED')
      }

      await delay(1500)
    }

    closePopup()
    throw new ApiError(408, 'LINK_TIMEOUT')
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function register(
  username: string,
  password: string,
  state: string,
): Promise<AuthUser> {
  const { token, user } = await post<{ token: string; user: AuthUser }>('/auth/register', {
    username,
    password,
    state,
  })
  setToken(token)
  return user
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const { token, user } = await post<{ token: string; user: AuthUser }>('/auth/login', {
    username,
    password,
  })
  setToken(token)
  return user
}

/**
 * Applies a completed Blizzard link (from `linkBlizzard`) to the currently
 * logged-in account, changing which BattleTag it's tied to.
 */
export async function applyBlizzardLink(state: string): Promise<AuthUser> {
  const { user } = await authedPost<{ user: AuthUser }>('/auth/blizzard/apply', { state })
  return user
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch(apiUrl('/api/auth/me'), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    clearToken()
    return null
  }
  const { user } = (await res.json()) as { user: AuthUser }
  return user
}

export async function logout(): Promise<void> {
  const token = getToken()
  if (token) {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
  clearToken()
}

export type BanDuration = '1h' | '1d' | 'permanent'

export interface ModeratedUser {
  username: string
  battletag: string
  isAdmin: boolean
  isBanned: boolean
  banExpiresAt: number | null
  banDuration: string | null
}

export async function fetchModeratedUser(username: string): Promise<ModeratedUser> {
  const { user } = await authedGet<{ user: ModeratedUser }>(
    `/admin/user?username=${encodeURIComponent(username)}`,
  )
  return user
}

/** Promote another account to admin. Caller must already be an admin. */
export async function promoteToAdmin(username: string): Promise<ModeratedUser> {
  const { user } = await authedPost<{ user: ModeratedUser }>('/admin/promote', { username })
  return user
}

/** Ban the BattleTag behind this nickname. Duration is 1h / 1d / permanent. */
export async function banUser(username: string, duration: BanDuration): Promise<ModeratedUser> {
  const { user } = await authedPost<{ user: ModeratedUser }>('/admin/ban', { username, duration })
  return user
}

export async function unbanUser(username: string): Promise<ModeratedUser> {
  const { user } = await authedPost<{ user: ModeratedUser }>('/admin/unban', { username })
  return user
}

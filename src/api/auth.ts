// Auth API client — talks to Express.
// Dev: Vite proxies /api → localhost:3001
// Prod: set VITE_API_URL to the API origin (e.g. https://opmunchul-api.up.railway.app)

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
  constructor(httpStatus: number, code: string, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.httpStatus = httpStatus
  }
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
    throw new ApiError(res.status, err?.error ?? 'UNKNOWN', err?.message)
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
 */
export async function linkBlizzard(options: { force?: boolean } = {}): Promise<BlizzardLink> {
  const query = options.force ? '?force=1' : ''
  const { state, authorizeUrl } = await get<{ state: string; authorizeUrl: string }>(
    `/auth/blizzard/start${query}`,
  )

  const popup = window.open(
    authorizeUrl,
    'blizzard-oauth',
    'width=520,height=720,menubar=no,toolbar=no',
  )
  if (!popup) {
    throw new ApiError(0, 'POPUP_BLOCKED')
  }

  const deadline = Date.now() + 1000 * 60 * 10
  let popupClosedAt: number | null = null

  while (Date.now() < deadline) {
    await delay(1500)

    let result: PollResult
    try {
      result = await get<PollResult>(`/auth/blizzard/poll?state=${encodeURIComponent(state)}`)
    } catch {
      continue
    }

    if (result.status === 'linked') {
      popup.close()
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
    if (result.status === 'error') {
      popup.close()
      throw new ApiError(502, 'LINK_FAILED', result.message)
    }
    if (result.status === 'expired' || result.status === 'unknown') {
      popup.close()
      throw new ApiError(400, 'LINK_EXPIRED')
    }

    // Still pending — if the user closed the popup without finishing, give up.
    if (popup.closed) {
      if (popupClosedAt === null) {
        popupClosedAt = Date.now()
      } else if (Date.now() - popupClosedAt > 2500) {
        throw new ApiError(0, 'LINK_CANCELLED')
      }
    }
  }

  popup.close()
  throw new ApiError(408, 'LINK_TIMEOUT')
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

/** Promote another account to admin. Caller must already be an admin. */
export async function promoteToAdmin(username: string): Promise<AuthUser> {
  const { user } = await authedPost<{ user: AuthUser }>('/admin/promote', { username })
  return user
}

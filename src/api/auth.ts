// Auth API client — talks to the local Express server (proxied at /api).

const TOKEN_KEY = 'opmunchul.token'

export interface AuthUser {
  battletag: string
  rankLabel: string
  rankIcon: string | null
  avatar: string | null
  createdAt: number
}

export type CheckResult =
  | { status: 'registered'; battletag: string }
  | {
      status: 'new'
      battletag: string
      rankLabel: string
      rankIcon: string | null
      avatar: string | null
      title: string | null
    }

/** Thrown when the server responds with a non-2xx status. */
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

export function isValidBattleTag(battletag: string): boolean {
  return /^[^#\s]{2,12}#\d{4,7}$/.test(battletag.trim())
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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

async function handle<T>(res: Response): Promise<T> {
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // no/invalid JSON body
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string } | null
    throw new ApiError(res.status, err?.error ?? 'UNKNOWN', err?.message)
  }
  return data as T
}

export function checkBattleTag(battletag: string): Promise<CheckResult> {
  return post<CheckResult>('/auth/check', { battletag })
}

export async function register(
  battletag: string,
  password: string,
): Promise<AuthUser> {
  const { token, user } = await post<{ token: string; user: AuthUser }>(
    '/auth/register',
    { battletag, password },
  )
  setToken(token)
  return user
}

export async function login(
  battletag: string,
  password: string,
): Promise<AuthUser> {
  const { token, user } = await post<{ token: string; user: AuthUser }>(
    '/auth/login',
    { battletag, password },
  )
  setToken(token)
  return user
}

/** Restore the session from a stored token, or null if none/expired. */
export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch('/api/auth/me', {
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
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
  clearToken()
}

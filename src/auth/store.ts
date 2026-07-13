// Local account store — stands in for a real backend.
// Registered users and the active session live in localStorage.

export interface StoredUser {
  battletag: string
  passwordHash: string
  rankLabel: string
  avatar: string | null
  createdAt: number
}

const USERS_KEY = 'opmunchul.users'
const SESSION_KEY = 'opmunchul.session'

function loadUsers(): Record<string, StoredUser> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveUsers(users: Record<string, StoredUser>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function normalize(battletag: string): string {
  return battletag.trim().toLowerCase()
}

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function findUser(battletag: string): StoredUser | null {
  return loadUsers()[normalize(battletag)] ?? null
}

export async function registerUser(params: {
  battletag: string
  password: string
  rankLabel: string
  avatar: string | null
}): Promise<StoredUser> {
  const users = loadUsers()
  const user: StoredUser = {
    battletag: params.battletag.trim(),
    passwordHash: await hashPassword(params.password),
    rankLabel: params.rankLabel,
    avatar: params.avatar,
    createdAt: Date.now(),
  }
  users[normalize(params.battletag)] = user
  saveUsers(users)
  return user
}

export async function verifyPassword(
  user: StoredUser,
  password: string,
): Promise<boolean> {
  return (await hashPassword(password)) === user.passwordHash
}

export function saveSession(user: StoredUser) {
  localStorage.setItem(SESSION_KEY, normalize(user.battletag))
}

export function loadSession(): StoredUser | null {
  const key = localStorage.getItem(SESSION_KEY)
  if (!key) return null
  return loadUsers()[key] ?? null
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

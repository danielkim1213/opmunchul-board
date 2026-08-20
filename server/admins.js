// Admin accounts get moderation powers (delete any post or comment) and
// can publish pinned notice posts. Role is stored on users.role — never
// inferred from username. The founding account (kyw4091) can also demote
// or ban other admins; nobody can moderate that account.

const FOUNDER_USERNAME_KEY = 'kyw4091'

/** @typedef {'user' | 'admin'} UserRole */

/**
 * @param {{ role?: string | null }} user
 * @returns {boolean}
 */
export function isAdmin(user) {
  return user?.role === 'admin'
}

/**
 * @param {{ username_key?: string | null }} user
 * @returns {boolean}
 */
export function isFounder(user) {
  return user?.username_key === FOUNDER_USERNAME_KEY
}

/** Only the founder may demote or ban another admin. */
export function canModerateAdmins(user) {
  return isFounder(user)
}

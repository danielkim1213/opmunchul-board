// Admin accounts get moderation powers (delete any post or comment) and
// can publish pinned notice posts. Role is stored on users.role — never
// inferred from username.

/** @typedef {'user' | 'admin'} UserRole */

/**
 * @param {{ role?: string | null }} user
 * @returns {boolean}
 */
export function isAdmin(user) {
  return user?.role === 'admin'
}

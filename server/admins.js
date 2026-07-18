// Admin accounts get moderation powers (delete/edit any post or comment) and
// can publish pinned notice posts. Which accounts are admins is driven by the
// ADMIN_USERNAMES env var — a comma-separated list of usernames (case
// insensitive). Defaults to "admin" so an account named "admin" is an admin
// out of the box.
const ADMIN_KEYS = new Set(
  (process.env.ADMIN_USERNAMES ?? 'admin')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean),
)

/** True when the given users.username_key belongs to an admin account. */
export function isAdminKey(usernameKey) {
  return usernameKey != null && ADMIN_KEYS.has(String(usernameKey).toLowerCase())
}

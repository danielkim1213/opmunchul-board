// Blizzard (Battle.net) OAuth 2.0 — Authorization Code flow.
// Docs: https://develop.battle.net/documentation/guides/using-oauth
//
// We only need the user's BattleTag, which the userinfo endpoint returns
// once the token carries the `openid` scope.

const REGION = (process.env.BLIZZARD_REGION || 'kr').toLowerCase()
const CLIENT_ID = process.env.BLIZZARD_CLIENT_ID || ''
const CLIENT_SECRET = process.env.BLIZZARD_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.BLIZZARD_REDIRECT_URI || ''
const SCOPE = 'openid'

// CN uses a different host; everywhere else is `{region}.battle.net`.
const OAUTH_BASE =
  process.env.BLIZZARD_OAUTH_BASE ||
  (REGION === 'cn'
    ? 'https://www.battlenet.com.cn'
    : `https://${REGION}.battle.net`)

export function isBlizzardConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI)
}

export class BlizzardOAuthError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlizzardOAuthError'
  }
}

export function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  })
  return `${OAUTH_BASE}/oauth/authorize?${params.toString()}`
}

/**
 * Blizzard's OAuth authorize endpoint ignores `prompt=login` — if the
 * browser already carries a Battle.net SSO cookie, `/oauth/authorize`
 * silently re-approves the same account with no login prompt. The only
 * documented workaround is to bounce through the logout endpoint first,
 * which clears the SSO cookie and forces the credential screen back up
 * before continuing to `authorize`. Use this when the user explicitly
 * wants to link a *different* Blizzard account.
 */
export function getSwitchAccountAuthorizeUrl(state) {
  const ref = encodeURIComponent(getAuthorizeUrl(state))
  return `${OAUTH_BASE}/login/logout?ref=${ref}`
}

export async function exchangeCodeForToken(code) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  })

  const res = await fetch(`${OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new BlizzardOAuthError(
      `Token exchange failed (HTTP ${res.status}). ${detail}`,
    )
  }
  return res.json()
}

export async function fetchBlizzardUser(accessToken) {
  const res = await fetch(`${OAUTH_BASE}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new BlizzardOAuthError(`Userinfo lookup failed (HTTP ${res.status}).`)
  }
  // { sub, id, battletag }
  const data = await res.json()
  if (!data?.battletag) {
    throw new BlizzardOAuthError('BattleTag was not present in the OAuth response.')
  }
  return {
    blizzardId: String(data.id ?? data.sub ?? ''),
    battletag: String(data.battletag),
  }
}

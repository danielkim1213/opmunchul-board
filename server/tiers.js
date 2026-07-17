// Shared tier vocabulary for board post permission gating (feedback comments,
// poll votes). Mirrors the OverFast division keys used in overfast.js, kept
// separate since this is a general "who can participate" concept rather than
// an OverFast API concern.

export const TIER_ORDER = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'ultimate',
]

export const TIER_LABEL_KO = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '마스터',
  grandmaster: '그랜드마스터',
  ultimate: '챔피언',
}

// users.rank_label looks like "Diamond IV", "Grandmaster I", "Champion", or
// "Unranked". Only the first word carries the tier.
const LABEL_WORD_TO_TIER = {
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
  diamond: 'diamond',
  master: 'master',
  grandmaster: 'grandmaster',
  champion: 'ultimate',
}

/** "Diamond IV" -> "diamond"; "Unranked" (or anything unrecognized) -> null. */
export function deriveTierKey(rankLabel) {
  if (!rankLabel) return null
  const firstWord = String(rankLabel).trim().split(/\s+/)[0]?.toLowerCase()
  return LABEL_WORD_TO_TIER[firstWord] ?? null
}

export function isValidTierKey(key) {
  return TIER_ORDER.includes(key)
}

/**
 * `allowedTiers` is a list of tier keys a post was restricted to. An empty
 * or missing list means "unrestricted" — everyone (any logged-in user) may
 * participate. Otherwise the viewer needs a verified rank in the list;
 * unranked players never satisfy a restricted list.
 */
export function isTierAllowed(rankLabel, allowedTiers) {
  if (!allowedTiers || allowedTiers.length === 0) return true
  const tier = deriveTierKey(rankLabel)
  return tier ? allowedTiers.includes(tier) : false
}

/** Parses the JSON TEXT column into a clean array of valid tier keys. */
export function parseAllowedTiers(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidTierKey) : []
  } catch {
    return []
  }
}

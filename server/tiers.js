// Shared tier vocabulary for board post permission gating (feedback comments,
// poll votes). Keys match Overwatch division names; OverFast still reports the
// top division as "ultimate", which we normalize to "champion" on ingest.

export const TIER_ORDER = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'emerald',
  'diamond',
  'master',
  'grandmaster',
  'champion',
]

export const TIER_LABEL_KO = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  emerald: '에메랄드',
  diamond: '다이아몬드',
  master: '마스터',
  grandmaster: '그랜드마스터',
  champion: '챔피언',
}

/** Map legacy / API aliases onto the canonical TierKey. */
function normalizeTierKey(key) {
  if (key === 'ultimate') return 'champion'
  return key
}

// users.rank_label looks like "Diamond IV", "Grandmaster I", "Champion", or
// "Unranked". Only the first word carries the tier.
const LABEL_WORD_TO_TIER = {
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
  emerald: 'emerald',
  diamond: 'diamond',
  master: 'master',
  grandmaster: 'grandmaster',
  champion: 'champion',
}

/** "Diamond IV" -> "diamond"; "Unranked" (or anything unrecognized) -> null. */
export function deriveTierKey(rankLabel) {
  if (!rankLabel) return null
  const firstWord = String(rankLabel).trim().split(/\s+/)[0]?.toLowerCase()
  return LABEL_WORD_TO_TIER[firstWord] ?? null
}

export function isValidTierKey(key) {
  return TIER_ORDER.includes(normalizeTierKey(key))
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
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeTierKey)
      .filter((key) => TIER_ORDER.includes(key))
  } catch {
    return []
  }
}

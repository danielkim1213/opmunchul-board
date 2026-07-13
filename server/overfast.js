// Server-side OverFast API client (unofficial Overwatch 2 API).
// Docs: https://overfast-api.tekrop.fr/
// Player summary: GET /players/{battletag with # replaced by -}/summary
//
// Private profiles are not exposed by the API and return 404, so a failed
// lookup is treated as "not found" — only public players can register.

const API_BASE = 'https://overfast-api.tekrop.fr'

export class PlayerNotFoundError extends Error {
  constructor(battletag) {
    super(`Player "${battletag}" was not found in the Blizzard database.`)
    this.name = 'PlayerNotFoundError'
  }
}

export function isValidBattleTag(battletag) {
  return /^[^#\s]{2,12}#\d{4,7}$/.test(String(battletag ?? '').trim())
}

/** "Tracer#1234" -> "Tracer-1234" */
function toPlayerId(battletag) {
  return battletag.trim().replace('#', '-')
}

/** Fetch a player summary. Throws PlayerNotFoundError on 404. */
export async function fetchPlayerSummary(battletag) {
  const playerId = encodeURIComponent(toPlayerId(battletag))
  const res = await fetch(`${API_BASE}/players/${playerId}/summary`)

  if (res.status === 404) throw new PlayerNotFoundError(battletag)
  if (!res.ok) {
    throw new Error(`Blizzard database search failed (HTTP ${res.status}).`)
  }
  return res.json()
}

const DIVISION_ORDER = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'ultimate',
]

const DIVISION_LABEL = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  master: 'Master',
  grandmaster: 'Grandmaster',
  ultimate: 'Champion',
}

const TIER_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

/** Pick the player's highest role rank across PC and console. */
export function getBestRank(summary) {
  let best = null
  const platforms = [summary?.competitive?.pc, summary?.competitive?.console]

  for (const platform of platforms) {
    if (!platform) continue
    for (const role of ['tank', 'damage', 'support']) {
      const rank = platform[role]
      if (!rank || !rank.division) continue
      const score = DIVISION_ORDER.indexOf(rank.division) * 10 + (5 - rank.tier)
      const bestScore = best
        ? DIVISION_ORDER.indexOf(best.division) * 10 + (5 - best.tier)
        : -1
      if (score > bestScore) {
        best = {
          role,
          division: rank.division,
          tier: rank.tier,
          label: `${DIVISION_LABEL[rank.division]} ${TIER_ROMAN[rank.tier] ?? rank.tier}`,
          rankIcon: rank.rank_icon ?? null,
        }
      }
    }
  }
  return best
}

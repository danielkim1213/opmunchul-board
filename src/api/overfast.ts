// OverFast API client (unofficial Overwatch 2 API)
// Docs: https://overfast-api.tekrop.fr/
//
// - Player summary: GET /players/{battletag with # replaced by -}/summary
// - Player search:  GET /players?name={name}  -> results expose `is_public`
//
// The current API no longer returns a `privacy` field on the summary.
// For private careers, `competitive` is null; to distinguish "private"
// from "public but unranked" we cross-check the search endpoint.

const API_BASE = import.meta.env.DEV
  ? '/overfast'
  : 'https://overfast-api.tekrop.fr'

export type RankDivision =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'ultimate'

export interface RoleRank {
  division: RankDivision
  tier: number
  role_icon?: string
  rank_icon?: string
  tier_icon?: string
}

type RoleRanks = Partial<Record<'tank' | 'damage' | 'support', RoleRank | null>>

export interface PlayerSummary {
  username: string
  avatar: string | null
  namecard: string | null
  title: string | null
  endorsement: { level: number; frame: string } | null
  competitive: {
    pc: (RoleRanks & { season?: number | null }) | null
    console: (RoleRanks & { season?: number | null }) | null
  } | null
  last_updated_at: number | null
}

interface PlayerSearchEntry {
  player_id: string
  name: string
  avatar: string | null
  namecard: string | null
  title: string | null
  last_updated_at: number | null
  is_public: boolean
}

interface PlayerSearchResult {
  total: number
  results: PlayerSearchEntry[]
}

export interface PlayerLookup {
  summary: PlayerSummary
  isPublic: boolean
}

export class PlayerNotFoundError extends Error {
  constructor(battletag: string) {
    super(`Player "${battletag}" was not found in the Blizzard database.`)
    this.name = 'PlayerNotFoundError'
  }
}

/** "Tracer#1234" -> "Tracer-1234" (OverFast player_id format) */
export function toPlayerId(battletag: string): string {
  return battletag.trim().replace('#', '-')
}

export function isValidBattleTag(battletag: string): boolean {
  return /^[^#\s]{2,12}#\d{4,7}$/.test(battletag.trim())
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (res.status === 404) throw new PlayerNotFoundError(path)
  if (!res.ok) {
    throw new Error(`Blizzard database search failed (HTTP ${res.status}). Please try again.`)
  }
  return (await res.json()) as T
}

async function fetchPlayerSummary(battletag: string): Promise<PlayerSummary> {
  const playerId = encodeURIComponent(toPlayerId(battletag))
  try {
    return await fetchJson<PlayerSummary>(`/players/${playerId}/summary`)
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      throw new PlayerNotFoundError(battletag)
    }
    throw err
  }
}

/**
 * Determine profile visibility via the search endpoint.
 * Search matches by name only, so we pick the entry whose metadata
 * (avatar / namecard / last update time) matches the fetched summary.
 */
async function fetchIsPublic(
  battletag: string,
  summary: PlayerSummary,
): Promise<boolean> {
  const name = battletag.trim().split('#')[0]
  try {
    const search = await fetchJson<PlayerSearchResult>(
      `/players?name=${encodeURIComponent(name)}&limit=100`,
    )
    const candidates = search.results.filter(
      (r) => r.name.toLowerCase() === summary.username.toLowerCase(),
    )
    const match =
      candidates.find(
        (r) =>
          r.last_updated_at === summary.last_updated_at &&
          r.avatar === summary.avatar,
      ) ??
      candidates.find(
        (r) => r.avatar === summary.avatar && r.namecard === summary.namecard,
      ) ??
      (candidates.length === 1 ? candidates[0] : undefined)

    if (match) return match.is_public
  } catch {
    // Search endpoint failure shouldn't block sign-up; fall through.
  }
  // Could not disambiguate — a visible competitive rank implies public.
  return summary.competitive !== null
}

/** Full lookup used by the auth flow: summary + privacy status. */
export async function lookupPlayer(battletag: string): Promise<PlayerLookup> {
  const summary = await fetchPlayerSummary(battletag)

  // A visible competitive section already proves the profile is public.
  if (summary.competitive !== null) {
    return { summary, isPublic: true }
  }
  return { summary, isPublic: await fetchIsPublic(battletag, summary) }
}

const DIVISION_ORDER: RankDivision[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'ultimate',
]

const DIVISION_LABEL: Record<RankDivision, string> = {
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

export interface BestRank {
  role: 'tank' | 'damage' | 'support'
  division: RankDivision
  tier: number
  /** e.g. "Master II" */
  label: string
  rankIcon?: string
}

/** Pick the player's highest role rank across PC and console. */
export function getBestRank(summary: PlayerSummary): BestRank | null {
  let best: BestRank | null = null
  const platforms = [summary.competitive?.pc, summary.competitive?.console]

  for (const platform of platforms) {
    if (!platform) continue
    for (const role of ['tank', 'damage', 'support'] as const) {
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
          rankIcon: rank.rank_icon,
        }
      }
    }
  }
  return best
}

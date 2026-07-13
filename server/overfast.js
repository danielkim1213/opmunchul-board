// Server-side OverFast client. All HTTP goes through overfastEnqueue (≤25/s).
// Docs: https://overfast-api.tekrop.fr/

import { overfastEnqueue } from './rateQueue.js'

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

function toPlayerId(battletag) {
  return battletag.trim().replace('#', '-')
}

async function fetchJsonRaw(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (res.status === 404) throw new PlayerNotFoundError(path)
  if (!res.ok) {
    throw new Error(`Blizzard database search failed (HTTP ${res.status}).`)
  }
  return res.json()
}

/** Rate-limited OverFast GET. */
function fetchJson(path) {
  return overfastEnqueue(() => fetchJsonRaw(path))
}

export async function fetchPlayerSummary(battletag) {
  const playerId = encodeURIComponent(toPlayerId(battletag))
  try {
    return await fetchJson(`/players/${playerId}/summary`)
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      throw new PlayerNotFoundError(battletag)
    }
    throw err
  }
}

export async function fetchCompetitiveStats(battletag, platform = 'pc') {
  const playerId = encodeURIComponent(toPlayerId(battletag))
  try {
    return await fetchJson(
      `/players/${playerId}/stats/summary?gamemode=competitive&platform=${encodeURIComponent(platform)}`,
    )
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      throw new PlayerNotFoundError(battletag)
    }
    throw err
  }
}

let heroCatalogCache = null
let heroCatalogFetchedAt = 0
const HERO_CACHE_TTL_MS = 1000 * 60 * 60 * 24

async function getHeroCatalog() {
  if (heroCatalogCache && Date.now() - heroCatalogFetchedAt < HERO_CACHE_TTL_MS) {
    return heroCatalogCache
  }
  const list = await fetchJson('/heroes?locale=en-us')
  heroCatalogCache = Object.fromEntries(
    list.map((h) => [
      h.key,
      { key: h.key, name: h.name, role: h.role, portrait: h.portrait ?? null },
    ]),
  )
  heroCatalogFetchedAt = Date.now()
  return heroCatalogCache
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

export const ROLE_LABEL = {
  tank: '탱커',
  damage: '딜러',
  support: '서포터',
}

export function getBestRank(summary) {
  let best = null
  for (const platform of ['pc', 'console']) {
    const roles = summary?.competitive?.[platform]
    if (!roles) continue
    for (const role of ['tank', 'damage', 'support']) {
      const rank = roles[role]
      if (!rank || !rank.division) continue
      const score = DIVISION_ORDER.indexOf(rank.division) * 10 + (5 - rank.tier)
      const bestScore = best
        ? DIVISION_ORDER.indexOf(best.division) * 10 + (5 - best.tier)
        : -1
      if (score > bestScore) {
        best = {
          role,
          platform,
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

export async function getTopHeroesForRole(battletag, role, platform = 'pc', limit = 3) {
  const [stats, catalog] = await Promise.all([
    fetchCompetitiveStats(battletag, platform),
    getHeroCatalog(),
  ])

  const heroes = stats?.heroes ?? {}
  return Object.entries(heroes)
    .filter(([key, data]) => {
      const meta = catalog[key]
      return meta?.role === role && (data?.time_played ?? 0) > 0
    })
    .sort((a, b) => (b[1].time_played ?? 0) - (a[1].time_played ?? 0))
    .slice(0, limit)
    .map(([key, data]) => {
      const meta = catalog[key]
      return {
        key,
        name: meta?.name ?? key,
        portrait: meta?.portrait ?? null,
        timePlayed: data.time_played ?? 0,
        gamesPlayed: data.games_played ?? 0,
      }
    })
}

export async function enrichRankProfile(battletag, summary) {
  const best = getBestRank(summary)
  if (!best) {
    return {
      rankLabel: 'Unranked',
      rankIcon: null,
      rankRole: null,
      roleLabel: null,
      mostHeroes: [],
    }
  }

  let mostHeroes = []
  try {
    mostHeroes = await getTopHeroesForRole(battletag, best.role, best.platform, 3)
  } catch (err) {
    console.warn('Failed to load most heroes:', err.message ?? err)
  }

  return {
    rankLabel: best.label,
    rankIcon: best.rankIcon,
    rankRole: best.role,
    roleLabel: ROLE_LABEL[best.role] ?? best.role,
    mostHeroes,
  }
}

export async function buildRankProfile(battletag) {
  const summary = await fetchPlayerSummary(battletag)
  const rank = await enrichRankProfile(battletag, summary)
  return { summary, rank }
}

/** True if `ts` falls on the same UTC calendar day as now. */
export function isFetchedToday(ts) {
  if (!ts) return false
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

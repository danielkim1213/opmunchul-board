/** Formats a second count as `MM:SS`, or `H:MM:SS` once it crosses an hour. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  }
  return `${minutes}:${ss}`
}

/**
 * Parses a user-typed timestamp like `1:23`, `01:02:03`, or a raw second
 * count (`83`) into a whole number of seconds. Returns null if unparsable.
 */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) {
    return null
  }

  let seconds = 0
  for (const part of parts) {
    seconds = seconds * 60 + Number(part)
  }
  return seconds
}

/** Extracts an 11-char YouTube video ID from a raw ID or a full URL. */
export function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const ID_RE = /^[a-zA-Z0-9_-]{11}$/
  if (ID_RE.test(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1)
      return ID_RE.test(id) ? id : null
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v')
      if (v && ID_RE.test(v)) return v
      const match = url.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/)
      if (match) return match[1]
    }
  } catch {
    return null
  }
  return null
}

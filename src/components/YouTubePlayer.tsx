import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Minimal shape of the bits of the YT IFrame API we actually touch.
interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  getCurrentTime: () => number
  destroy: () => void
}
interface YTPlayerState {
  PLAYING: number
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, unknown>
      events?: {
        onReady?: () => void
        onStateChange?: (event: { data: number }) => void
        onError?: () => void
      }
    },
  ) => YTPlayer
  PlayerState: YTPlayerState
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiLoadPromise: Promise<YTNamespace> | null = null

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiLoadPromise) return apiLoadPromise

  apiLoadPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT as YTNamespace)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiLoadPromise
}

export interface YouTubePlayerHandle {
  /** Seeks the underlying player and resumes playback. */
  seekTo: (seconds: number) => void
}

interface YouTubePlayerProps {
  videoId: string
  onTimeUpdate: (seconds: number) => void
  onReady?: () => void
}

const POLL_INTERVAL_MS = 400

const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(function YouTubePlayer(
  { videoId, onTimeUpdate, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const intervalRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number) {
      playerRef.current?.seekTo(seconds, true)
      playerRef.current?.playVideo()
    },
  }))

  useEffect(() => {
    let cancelled = false
    setError(null)

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return

      // The IFrame API replaces `containerRef.current` outright with the
      // <iframe>, so `.yt-player__frame` no longer exists afterwards — sizing
      // has to be forced via CSS on the resulting iframe (see board/Board.css),
      // not on this now-gone wrapper div.
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => onReady?.(),
          onStateChange: (event) => {
            if (intervalRef.current) {
              window.clearInterval(intervalRef.current)
              intervalRef.current = null
            }
            if (event.data === YT.PlayerState.PLAYING) {
              intervalRef.current = window.setInterval(() => {
                const t = playerRef.current?.getCurrentTime()
                if (typeof t === 'number') onTimeUpdate(t)
              }, POLL_INTERVAL_MS)
            }
          },
          onError: () => setError('영상을 불러올 수 없습니다. YouTube 영상 ID를 확인해 주세요.'),
        },
      })
    })

    return () => {
      cancelled = true
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      playerRef.current?.destroy()
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  return (
    <div className="yt-player">
      <div className="yt-player__frame" ref={containerRef} />
      {error && <div className="yt-player__error">{error}</div>}
    </div>
  )
})

export default YouTubePlayer

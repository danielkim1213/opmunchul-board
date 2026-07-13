/**
 * Global FIFO queue for OverFast HTTP calls.
 * If ≥ maxPerSecond requests would fire within 1s, wait a full second then continue.
 */
export function createRateQueue({ maxPerSecond = 25 } = {}) {
  const pending = []
  const stamps = []
  let draining = false

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (pending.length > 0) {
        const now = Date.now()
        while (stamps.length > 0 && now - stamps[0] >= 1000) {
          stamps.shift()
        }
        if (stamps.length >= maxPerSecond) {
          // Burst cap hit — cool down for 1s as requested.
          await sleep(1000)
          stamps.length = 0
          continue
        }

        const job = pending.shift()
        stamps.push(Date.now())
        try {
          job.resolve(await job.fn())
        } catch (err) {
          job.reject(err)
        }
      }
    } finally {
      draining = false
      if (pending.length > 0) void drain()
    }
  }

  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      pending.push({ fn, resolve, reject })
      void drain()
    })
  }
}

/** Shared OverFast request scheduler (25 req/s). */
export const overfastEnqueue = createRateQueue({ maxPerSecond: 25 })

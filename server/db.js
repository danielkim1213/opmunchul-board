/**
 * Database access via libSQL (@libsql/client).
 *
 * - Production (Vercel): hosted Turso database — set TURSO_DATABASE_URL and
 *   TURSO_AUTH_TOKEN. Vercel functions have no persistent filesystem, so
 *   hosted libSQL is used instead of a local SQLite file.
 * - Local dev: falls back to a plain SQLite file (server/data.sqlite, or
 *   DATA_DIR if set) — same file format as before, existing data keeps working.
 *
 * The `prepare()` wrapper mirrors the old synchronous node:sqlite API shape
 * (get/all/run) but every method is async — call sites must `await`.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL
  const dataDir = process.env.DATA_DIR || __dirname
  mkdirSync(dataDir, { recursive: true })
  return pathToFileURL(join(dataDir, 'data.sqlite')).href
}

const url = resolveUrl()
const isRemote = /^(libsql|https?|wss?):/.test(url)

// The `/web` build is pure fetch-based JS (no native binding) — ideal for
// serverless. The node build (needed for file: URLs in local dev) ships a
// native libsql binding. Both import branches use literal specifiers so
// Vercel's file tracer picks them up.
const { createClient } = isRemote
  ? await import('@libsql/client/web')
  : await import('@libsql/client')

console.log('Database:', isRemote ? url : url.replace('file://', 'file:'))

export const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
})

/** libSQL rows are array-like; convert to plain objects keyed by column name
 * so spreads (`{ ...row }`) and JSON serialization behave like before. */
function toObject(columns, row) {
  if (!row) return undefined
  const obj = {}
  for (let i = 0; i < columns.length; i += 1) obj[columns[i]] = row[i]
  return obj
}

export function prepare(sql) {
  return {
    async get(...args) {
      const rs = await client.execute({ sql, args })
      return toObject(rs.columns, rs.rows[0])
    },
    async all(...args) {
      const rs = await client.execute({ sql, args })
      return rs.rows.map((row) => toObject(rs.columns, row))
    },
    async run(...args) {
      await client.execute({ sql, args })
    },
  }
}

/**
 * Runs several statements atomically in one transaction.
 * @param {Array<{ sql: string, args?: unknown[] }>} statements
 */
export function batch(statements) {
  return client.batch(
    statements.map(({ sql, args }) => ({ sql, args: args ?? [] })),
    'write',
  )
}

export default { prepare, batch, client }

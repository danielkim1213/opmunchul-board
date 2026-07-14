import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Railway Volume: set DATA_DIR=/data (and mount volume there)
const dataDir = process.env.DATA_DIR || __dirname
mkdirSync(dataDir, { recursive: true })
const DB_PATH = join(dataDir, 'data.sqlite')
console.log('SQLite path:', DB_PATH)

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    battletag_key TEXT PRIMARY KEY,     -- lowercased battletag, unique id
    battletag     TEXT NOT NULL,        -- original casing
    password_hash TEXT NOT NULL,
    rank_label    TEXT NOT NULL,
    rank_icon     TEXT,
    avatar        TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    battletag_key TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (battletag_key) REFERENCES users(battletag_key) ON DELETE CASCADE
  );
`)

/** Add columns introduced after the first schema without breaking existing DBs. */
function ensureColumn(table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`)
  }
}

ensureColumn('users', 'rank_role', 'TEXT')
ensureColumn('users', 'most_heroes', 'TEXT') // JSON array of top heroes
ensureColumn('users', 'rank_fetched_at', 'INTEGER') // last OverFast refresh (ms)

export default db

/**
 * SQLite via Node's built-in `node:sqlite` (Node 22+).
 * No native npm addon — much more reliable on Railway than better-sqlite3.
 */
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || __dirname
mkdirSync(dataDir, { recursive: true })
const DB_PATH = join(dataDir, 'data.sqlite')
console.log('SQLite path:', DB_PATH)

const db = new DatabaseSync(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    battletag_key TEXT PRIMARY KEY,
    battletag     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rank_label    TEXT NOT NULL,
    rank_icon     TEXT,
    avatar        TEXT,
    created_at    INTEGER NOT NULL,
    rank_role     TEXT,
    most_heroes   TEXT,
    rank_fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    battletag_key TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (battletag_key) REFERENCES users(battletag_key) ON DELETE CASCADE
  );
`)

function ensureColumn(table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`)
  }
}

ensureColumn('users', 'rank_role', 'TEXT')
ensureColumn('users', 'most_heroes', 'TEXT')
ensureColumn('users', 'rank_fetched_at', 'INTEGER')

export default db

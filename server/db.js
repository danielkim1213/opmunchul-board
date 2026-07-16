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

// The account model switched from BattleTag-keyed rows to user-chosen
// usernames (BattleTag now comes from Blizzard OAuth). The old `users` table
// keyed by `battletag_key` is incompatible, so drop the legacy schema.
const legacy = db.prepare(`PRAGMA table_info(users)`).all()
if (legacy.length > 0 && !legacy.some((c) => c.name === 'username_key')) {
  console.log('Migrating away from legacy BattleTag-keyed schema (dropping old tables).')
  db.exec('DROP TABLE IF EXISTS sessions;')
  db.exec('DROP TABLE IF EXISTS users;')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username_key  TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    battletag     TEXT NOT NULL,
    battletag_key TEXT NOT NULL UNIQUE,
    blizzard_id   TEXT,
    rank_label    TEXT,
    rank_icon     TEXT,
    rank_role     TEXT,
    most_heroes   TEXT,
    avatar        TEXT,
    created_at    INTEGER NOT NULL,
    rank_fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    username_key  TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (username_key) REFERENCES users(username_key) ON DELETE CASCADE
  );

  -- Short-lived records tracking an in-progress Blizzard OAuth link.
  CREATE TABLE IF NOT EXISTS oauth_links (
    state         TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'pending',
    battletag     TEXT,
    battletag_key TEXT,
    blizzard_id   TEXT,
    profile       TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    consumed      INTEGER NOT NULL DEFAULT 0
  );

  -- VOD review submissions. Submitter identity is denormalized (rather than a
  -- users FK) because a submission is a snapshot of the author's rank at the
  -- time it was posted, and demo VODs aren't necessarily tied to a real login.
  CREATE TABLE IF NOT EXISTS vods (
    id                    TEXT PRIMARY KEY,
    replay_code           TEXT NOT NULL,
    youtube_id            TEXT NOT NULL,
    hero                  TEXT NOT NULL,
    team_side             TEXT NOT NULL,
    note                  TEXT NOT NULL,
    submitter_battletag   TEXT NOT NULL,
    submitter_rank_label  TEXT NOT NULL,
    submitter_rank_icon   TEXT,
    submitter_role_label  TEXT,
    created_at            INTEGER NOT NULL
  );

  -- Timestamped feedback comments on a VOD. parent_id supports a single
  -- level of replies (a reply's parent is always a top-level comment).
  CREATE TABLE IF NOT EXISTS vod_comments (
    id                TEXT PRIMARY KEY,
    vod_id            TEXT NOT NULL,
    parent_id         TEXT,
    username_key      TEXT NOT NULL,
    timestamp_seconds INTEGER NOT NULL,
    content           TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    FOREIGN KEY (vod_id) REFERENCES vods(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES vod_comments(id) ON DELETE CASCADE,
    FOREIGN KEY (username_key) REFERENCES users(username_key)
  );

  CREATE TABLE IF NOT EXISTS vod_comment_upvotes (
    comment_id   TEXT NOT NULL,
    username_key TEXT NOT NULL,
    PRIMARY KEY (comment_id, username_key),
    FOREIGN KEY (comment_id) REFERENCES vod_comments(id) ON DELETE CASCADE
  );
`)

export const DEMO_VOD_ID = 'demo-vod-1'

if (!db.prepare('SELECT 1 FROM vods WHERE id = ?').get(DEMO_VOD_ID)) {
  db.prepare(`
    INSERT INTO vods (
      id, replay_code, youtube_id, hero, team_side, note,
      submitter_battletag, submitter_rank_label, submitter_rank_icon, submitter_role_label,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEMO_VOD_ID,
    'X8YZ4B',
    'dZl1yGUetjI',
    '아나',
    'defense',
    '왕의 길 2세컨포인트 포지셔닝이 너무 안 좋았던 것 같아요. 윈스턴한테 계속 다이브당했는데, 팀을 힐 하면서도 안전하게 있으려면 어떻게 포지셔닝해야 할까요?',
    '아나원챔러#1234',
    'Diamond IV',
    null,
    '서포터',
    Date.now(),
  )
}

export default db

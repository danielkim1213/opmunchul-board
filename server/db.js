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

// Required for ON DELETE CASCADE (post_comments/post_comment_upvotes/
// post_poll_options/post_poll_votes) to actually take effect — SQLite
// ignores those clauses unless foreign key enforcement is turned on, and
// it's off by default on every new connection.
db.exec('PRAGMA foreign_keys = ON;')

// The account model switched from BattleTag-keyed rows to user-chosen
// usernames (BattleTag now comes from Blizzard OAuth). The old `users` table
// keyed by `battletag_key` is incompatible, so drop the legacy schema.
const legacy = db.prepare(`PRAGMA table_info(users)`).all()
if (legacy.length > 0 && !legacy.some((c) => c.name === 'username_key')) {
  console.log('Migrating away from legacy BattleTag-keyed schema (dropping old tables).')
  db.exec('DROP TABLE IF EXISTS sessions;')
  db.exec('DROP TABLE IF EXISTS users;')
}

// The single-demo-VOD model (vods/vod_comments/vod_comment_upvotes) has been
// replaced by a general `posts` table (tip/feedback/poll) — drop the old
// tables outright rather than migrating, since it only ever held demo data.
db.exec('DROP TABLE IF EXISTS vod_comment_upvotes;')
db.exec('DROP TABLE IF EXISTS vod_comments;')
db.exec('DROP TABLE IF EXISTS vods;')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username_key  TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    battletag     TEXT NOT NULL,
    battletag_key TEXT NOT NULL UNIQUE,
    blizzard_id   TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
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

  -- Board posts: type is 'tip' | 'feedback' | 'poll'. Author info is looked
  -- up live via JOIN on users (like comments), so badges always reflect the
  -- author's current rank rather than a snapshot.
  -- allowed_tiers is a JSON array of tier keys (see server/tiers.js) that
  -- gates comment/upvote/reply/vote participation; NULL/empty = unrestricted.
  -- replay_code/youtube_id/hero/team_side are only used by 'feedback' posts;
  -- body is the tip's body text or the feedback request note.
  CREATE TABLE IF NOT EXISTS posts (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT,
    author_username_key TEXT NOT NULL,
    allowed_tiers       TEXT,
    replay_code         TEXT,
    youtube_id          TEXT,
    hero                TEXT,
    team_side           TEXT,
    created_at          INTEGER NOT NULL,
    FOREIGN KEY (author_username_key) REFERENCES users(username_key)
  );

  -- Comments on 'tip' and 'feedback' posts. parent_id supports a single
  -- level of replies. timestamp_seconds is only meaningful for 'feedback'
  -- posts (NULL there means "global" feedback not tied to a moment); it's
  -- always NULL for 'tip' comments.
  CREATE TABLE IF NOT EXISTS post_comments (
    id                TEXT PRIMARY KEY,
    post_id           TEXT NOT NULL,
    parent_id         TEXT,
    username_key      TEXT NOT NULL,
    timestamp_seconds INTEGER,
    content           TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE,
    FOREIGN KEY (username_key) REFERENCES users(username_key)
  );

  CREATE TABLE IF NOT EXISTS post_comment_upvotes (
    comment_id   TEXT NOT NULL,
    username_key TEXT NOT NULL,
    PRIMARY KEY (comment_id, username_key),
    FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE
  );

  -- 'poll' post options and single-choice votes (one row per voter per poll;
  -- re-voting UPDATEs the existing row rather than inserting a new one).
  CREATE TABLE IF NOT EXISTS post_poll_options (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL,
    label       TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS post_poll_votes (
    post_id      TEXT NOT NULL,
    option_id    TEXT NOT NULL,
    username_key TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (post_id, username_key),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES post_poll_options(id) ON DELETE CASCADE
  );
`)

// --- Non-destructive migrations for real user data created before these
// features existed. Never drop/recreate `posts`/`post_comments` here. ---

function addColumnIfMissing(table, column, ddl) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all()
  if (info.length > 0 && !info.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
  }
}

// Supports "edited" indicators for posts/comments.
addColumnIfMissing('posts', 'updated_at', 'updated_at INTEGER')
addColumnIfMissing('post_comments', 'updated_at', 'updated_at INTEGER')

// Notice posts (admin-only) are pinned to the top of the board list.
addColumnIfMissing('posts', 'is_notice', 'is_notice INTEGER NOT NULL DEFAULT 0')

// Board role (user | admin). Replaces the old ADMIN_USERNAMES nickname check.
addColumnIfMissing('users', 'role', "role TEXT NOT NULL DEFAULT 'user'")
// Seed the initial admin account (not a guessable default like "admin").
db.exec(`UPDATE users SET role = 'admin' WHERE username_key = 'kyw4091';`)

// team_side terminology moved from attack/defense to red/blue — remap any
// rows written under the old scheme so old feedback posts still render.
db.exec(`UPDATE posts SET team_side = 'red' WHERE team_side = 'attack';`)
db.exec(`UPDATE posts SET team_side = 'blue' WHERE team_side = 'defense';`)

// Board list: page posts first (ORDER BY + LIMIT), then aggregate only those
// rows. Without these indexes each COUNT(*) can devolve into a table scan.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_list
    ON posts(is_notice DESC, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_type_list
    ON posts(type, is_notice DESC, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post
    ON post_comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_poll_options_post
    ON post_poll_options(post_id);
  CREATE INDEX IF NOT EXISTS idx_poll_votes_post
    ON post_poll_votes(post_id);
`)

export default db

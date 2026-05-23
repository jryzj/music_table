import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'music_table.db')

const ALLOWED_SORT_COLS = ['id', 'user_sub', 'email', 'created_at', 'duration', 'status', 'seed']
const MUSIC_SORT_COLS = ['id', 'filename', 'duration', 'bpm', 'seed', 'music_status', 'created_at']
const ALLOWED_SORT_ORDERS = ['ASC', 'DESC']

let db = null

export function initDb() {
  if (db) return db
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_sub TEXT NOT NULL,
      email TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS generation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_sub TEXT,
      genres TEXT,
      vocal_type TEXT,
      custom_tags TEXT,
      custom_lyrics TEXT,
      duration INTEGER,
      bpm INTEGER,
      effect TEXT,
      effect_intensity REAL,
      seed INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      track_id TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_management (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      user_sub TEXT,
      genres TEXT,
      vocal_type TEXT,
      custom_tags TEXT,
      custom_lyrics TEXT,
      duration INTEGER,
      bpm INTEGER,
      effect TEXT,
      effect_intensity REAL,
      seed INTEGER,
      music_status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  const cols = db.prepare("PRAGMA table_info(generation_log)").all()
  if (!cols.some(c => c.name === 'filename')) {
    db.exec('ALTER TABLE generation_log ADD COLUMN filename TEXT')
  }
  return db
}

export function closeDb() {
  if (db) { db.close(); db = null }
}

function sanitizeSort(sortBy, sortOrder) {
  const col = ALLOWED_SORT_COLS.includes(sortBy) ? sortBy : 'created_at'
  const order = ALLOWED_SORT_ORDERS.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC'
  return { sortBy: col, sortOrder: order }
}

export function logUserAccess({ userSub, email, ipAddress, userAgent }) {
  const d = initDb()
  const stmt = d.prepare(
    'INSERT INTO user_access (user_sub, email, ip_address, user_agent) VALUES (?, ?, ?, ?)'
  )
  return stmt.run(userSub, email || null, ipAddress || null, userAgent || null)
}

export function logGeneration({ userSub, genres, vocalType, customTags, customLyrics, duration, bpm, effect, effectIntensity, seed, status, trackId, errorMessage, fileName }) {
  const d = initDb()
  const stmt = d.prepare(
    `INSERT INTO generation_log
     (user_sub, genres, vocal_type, custom_tags, custom_lyrics, duration, bpm, effect, effect_intensity, seed, status, track_id, error_message, filename)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  return stmt.run(
    userSub || null,
    genres ? (Array.isArray(genres) ? genres.join(',') : String(genres)) : null,
    vocalType || null,
    customTags || null,
    customLyrics || null,
    duration || null,
    bpm || null,
    effect || null,
    effectIntensity != null ? effectIntensity : null,
    seed || null,
    status || 'success',
    trackId ? String(trackId) : null,
    errorMessage || null,
    fileName || null
  )
}

export function queryUserAccess({ offset = 0, limit = 50, sortBy = 'created_at', sortOrder = 'DESC', search = '' } = {}) {
  const d = initDb()
  const { sortBy: sb, sortOrder: so } = sanitizeSort(sortBy, sortOrder)
  const searchClause = search
    ? `WHERE CAST(id AS TEXT) LIKE ? OR user_sub LIKE ? OR email LIKE ? OR ip_address LIKE ? OR user_agent LIKE ? OR created_at LIKE ?`
    : ''
  const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : []
  const total = d.prepare(`SELECT COUNT(*) as count FROM user_access ${searchClause}`).get(...searchParams).count
  const rows = d.prepare(`SELECT * FROM user_access ${searchClause} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`).all(...searchParams, limit, offset)
  return { rows, total }
}

export function queryGenerationLog({ offset = 0, limit = 50, sortBy = 'created_at', sortOrder = 'DESC', search = '' } = {}) {
  const d = initDb()
  const { sortBy: sb, sortOrder: so } = sanitizeSort(sortBy, sortOrder)
  const emailSubq = '(SELECT email FROM user_access WHERE user_sub = gl.user_sub AND email IS NOT NULL LIMIT 1)'
  const searchClause = search
    ? `WHERE CAST(gl.id AS TEXT) LIKE ? OR gl.user_sub LIKE ? OR gl.genres LIKE ? OR gl.vocal_type LIKE ? OR gl.custom_tags LIKE ? OR gl.custom_lyrics LIKE ? OR CAST(gl.duration AS TEXT) LIKE ? OR CAST(gl.bpm AS TEXT) LIKE ? OR gl.effect LIKE ? OR CAST(gl.seed AS TEXT) LIKE ? OR gl.status LIKE ? OR gl.track_id LIKE ? OR gl.error_message LIKE ? OR gl.created_at LIKE ? OR ${emailSubq} LIKE ?`
    : ''
  const searchParams = search ? Array(15).fill(`%${search}%`) : []
  const total = d.prepare(`SELECT COUNT(*) as count FROM generation_log gl ${searchClause}`).get(...searchParams).count
  const rows = d.prepare(`SELECT gl.*, ${emailSubq} as email FROM generation_log gl ${searchClause} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`).all(...searchParams, limit, offset)
  return { rows, total }
}

export function insertMusicManagement({ filename, userSub, genres, vocalType, customTags, customLyrics, duration, bpm, effect, effectIntensity, seed }) {
  const d = initDb()
  const stmt = d.prepare(
    `INSERT INTO music_management (filename, user_sub, genres, vocal_type, custom_tags, custom_lyrics, duration, bpm, effect, effect_intensity, seed, music_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
  )
  const result = stmt.run(
    filename,
    userSub || null,
    genres || null,
    vocalType || null,
    customTags || null,
    customLyrics || null,
    duration || null,
    bpm || null,
    effect || null,
    effectIntensity != null ? effectIntensity : null,
    seed || null
  )
  return { id: Number(result.lastInsertRowid), status: 'open' }
}

export function updateMusicStatus(id, status) {
  const d = initDb()
  return d.prepare('UPDATE music_management SET music_status = ? WHERE id = ?').run(status, id)
}

export function deleteMusicRecord(id) {
  const d = initDb()
  return d.prepare('DELETE FROM music_management WHERE id = ?').run(id)
}

export function getMusicFilename(id) {
  const d = initDb()
  const row = d.prepare('SELECT filename FROM music_management WHERE id = ?').get(id)
  return row ? row.filename : null
}

export function queryUserMusic(userSub, status = 'open') {
  const d = initDb()
  return d.prepare(
    'SELECT * FROM music_management WHERE user_sub = ? AND music_status = ? ORDER BY created_at DESC'
  ).all(userSub, status)
}

export function queryMusicManagement({ offset = 0, limit = 50, sortBy = 'created_at', sortOrder = 'DESC', search = '' } = {}) {
  const d = initDb()
  const sb = MUSIC_SORT_COLS.includes(sortBy) ? sortBy : 'created_at'
  const so = ALLOWED_SORT_ORDERS.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC'
  const emailSubq = '(SELECT email FROM user_access WHERE user_sub = mm.user_sub AND email IS NOT NULL LIMIT 1)'
  const searchClause = search
    ? `WHERE CAST(mm.id AS TEXT) LIKE ? OR mm.filename LIKE ? OR mm.genres LIKE ? OR mm.vocal_type LIKE ? OR mm.music_status LIKE ? OR mm.created_at LIKE ? OR ${emailSubq} LIKE ?`
    : ''
  const searchParams = search ? Array(7).fill(`%${search}%`) : []
  const total = d.prepare(`SELECT COUNT(*) as count FROM music_management mm ${searchClause}`).get(...searchParams).count
  const rows = d.prepare(`SELECT mm.*, ${emailSubq} as email FROM music_management mm ${searchClause} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`).all(...searchParams, limit, offset)
  return { rows, total }
}

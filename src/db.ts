import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { config } from './config';
import type { User, AuditEntry } from './types';

let _db: Database.Database | null = null;

/** Return the singleton database connection, initialising it on first call. */
export function getDb(): Database.Database {
  if (!_db) {
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    _db = new Database(config.dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    migrate(_db);
  }
  return _db;
}

/** Close the connection (used in tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Allow injecting a test database. */
export function setDb(db: Database.Database): void {
  _db = db;
}

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      name          TEXT    NOT NULL,
      company       TEXT,
      password_hash TEXT    NOT NULL,
      is_approved   INTEGER NOT NULL DEFAULT 0,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      reason        TEXT,
      requested_at  TEXT    NOT NULL,
      approved_at   TEXT,
      approved_by   TEXT,
      admin_notes   TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      user_email   TEXT    NOT NULL,
      part_id      TEXT    NOT NULL,
      part_number  TEXT    NOT NULL,
      revision     TEXT    NOT NULL,
      action       TEXT    NOT NULL,
      accessed_at  TEXT    NOT NULL
    );
  `);

  seedAdminIfMissing(db);
}

/** Create a default admin account if no admin exists yet. */
function seedAdminIfMissing(db: Database.Database): void {
  const existing = db
    .prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1')
    .get() as { id: number } | undefined;

  if (!existing) {
    const hash = bcrypt.hashSync('ChangeMe123!', 12);
    db.prepare(`
      INSERT INTO users (email, name, company, password_hash, is_approved, is_admin, requested_at)
      VALUES (?, ?, ?, ?, 1, 1, ?)
    `).run(config.adminEmail, 'Data Owner (Admin)', '3Shape', hash, new Date().toISOString());

    console.log(`[db] Created default admin account: ${config.adminEmail}`);
    console.log('[db] Default password: ChangeMe123! — please change it immediately.');
  }
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export function findUserByEmail(email: string): User | undefined {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email) as DbUser | undefined;
  return row ? mapUser(row) : undefined;
}

export function findUserById(id: number): User | undefined {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(id) as DbUser | undefined;
  return row ? mapUser(row) : undefined;
}

export function getAllUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY requested_at DESC')
    .all() as DbUser[];
  return rows.map(mapUser);
}

export function getPendingUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users WHERE is_approved = 0 AND is_admin = 0 ORDER BY requested_at DESC')
    .all() as DbUser[];
  return rows.map(mapUser);
}

export function createUser(params: {
  email: string;
  name: string;
  company?: string;
  passwordHash: string;
  reason?: string;
}): User {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(`
    INSERT INTO users (email, name, company, password_hash, is_approved, is_admin, reason, requested_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  `);
  const result = stmt.run(
    params.email,
    params.name,
    params.company ?? null,
    params.passwordHash,
    params.reason ?? null,
    now,
  );
  return findUserById(result.lastInsertRowid as number)!;
}

export function approveUser(userId: number, adminEmail: string, notes?: string): void {
  getDb()
    .prepare(`
      UPDATE users
      SET is_approved = 1, approved_at = ?, approved_by = ?, admin_notes = ?
      WHERE id = ?
    `)
    .run(new Date().toISOString(), adminEmail, notes ?? null, userId);
}

export function rejectUser(userId: number, adminEmail: string, notes?: string): void {
  // We keep the row but mark it with a rejection note so the user sees a meaningful message.
  getDb()
    .prepare(`
      UPDATE users
      SET is_approved = 0, approved_at = ?, approved_by = ?, admin_notes = ?
      WHERE id = ?
    `)
    .run(new Date().toISOString(), adminEmail, notes ?? 'Access request rejected.', userId);
}

export function revokeUser(userId: number): void {
  getDb()
    .prepare('UPDATE users SET is_approved = 0 WHERE id = ?')
    .run(userId);
}

export function updatePassword(userId: number, passwordHash: string): void {
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, userId);
}

// ---------------------------------------------------------------------------
// Audit log helpers
// ---------------------------------------------------------------------------

export function logAccess(entry: Omit<AuditEntry, 'id'>): void {
  getDb()
    .prepare(`
      INSERT INTO audit_log (user_id, user_email, part_id, part_number, revision, action, accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entry.userId,
      entry.userEmail,
      entry.partId,
      entry.partNumber,
      entry.revision,
      entry.action,
      entry.accessedAt,
    );
}

export function getAuditLog(limit = 500): AuditEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM audit_log ORDER BY accessed_at DESC LIMIT ?')
    .all(limit) as DbAuditEntry[];
  return rows.map(mapAudit);
}

// ---------------------------------------------------------------------------
// Row → model mappers
// ---------------------------------------------------------------------------

interface DbUser {
  id: number;
  email: string;
  name: string;
  company: string | null;
  password_hash: string;
  is_approved: number;
  is_admin: number;
  reason: string | null;
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  admin_notes: string | null;
}

interface DbAuditEntry {
  id: number;
  user_id: number;
  user_email: string;
  part_id: string;
  part_number: string;
  revision: string;
  action: string;
  accessed_at: string;
}

function mapUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company ?? undefined,
    passwordHash: row.password_hash,
    isApproved: row.is_approved === 1,
    isAdmin: row.is_admin === 1,
    reason: row.reason ?? undefined,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    adminNotes: row.admin_notes ?? undefined,
  };
}

function mapAudit(row: DbAuditEntry): AuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    partId: row.part_id,
    partNumber: row.part_number,
    revision: row.revision,
    action: row.action as AuditEntry['action'],
    accessedAt: row.accessed_at,
  };
}

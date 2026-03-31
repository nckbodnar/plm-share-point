import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import {
  setDb,
  closeDb,
  findUserByEmail,
  findUserById,
  getAllUsers,
  getPendingUsers,
  createUser,
  approveUser,
  rejectUser,
  revokeUser,
  logAccess,
  getAuditLog,
} from '../src/db';

function createTestDb(): Database.Database {
  // In-memory SQLite database for isolated tests
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrateTestDb(db: Database.Database): void {
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
}

beforeEach(() => {
  const db = createTestDb();
  migrateTestDb(db);
  setDb(db);
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// createUser / findUserByEmail / findUserById
// ---------------------------------------------------------------------------

describe('createUser', () => {
  it('creates a new unapproved user', () => {
    const hash = bcrypt.hashSync('password123', 1);
    const user = createUser({
      email: 'alice@example.com',
      name: 'Alice',
      company: 'ACME',
      passwordHash: hash,
      reason: 'Need to check specs',
    });

    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toBe('alice@example.com');
    expect(user.name).toBe('Alice');
    expect(user.isApproved).toBe(false);
    expect(user.isAdmin).toBe(false);
  });

  it('findUserByEmail returns the created user (case-insensitive)', () => {
    const hash = bcrypt.hashSync('password123', 1);
    createUser({ email: 'Alice@Example.COM', name: 'Alice', passwordHash: hash });

    const found = findUserByEmail('alice@example.com');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Alice');
  });

  it('findUserByEmail returns undefined for unknown email', () => {
    expect(findUserByEmail('nobody@example.com')).toBeUndefined();
  });

  it('findUserById returns undefined for unknown id', () => {
    expect(findUserById(9999)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// approveUser / revokeUser / rejectUser
// ---------------------------------------------------------------------------

describe('approveUser', () => {
  it('sets is_approved to true', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const user = createUser({ email: 'bob@example.com', name: 'Bob', passwordHash: hash });
    expect(user.isApproved).toBe(false);

    approveUser(user.id, 'admin@example.com', 'Looks good');
    const updated = findUserById(user.id)!;
    expect(updated.isApproved).toBe(true);
    expect(updated.approvedBy).toBe('admin@example.com');
  });
});

describe('rejectUser', () => {
  it('keeps is_approved false and stores note', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const user = createUser({ email: 'carol@example.com', name: 'Carol', passwordHash: hash });

    rejectUser(user.id, 'admin@example.com', 'Not authorised');
    const updated = findUserById(user.id)!;
    expect(updated.isApproved).toBe(false);
    expect(updated.adminNotes).toBe('Not authorised');
  });
});

describe('revokeUser', () => {
  it('sets is_approved back to false', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const user = createUser({ email: 'dave@example.com', name: 'Dave', passwordHash: hash });
    approveUser(user.id, 'admin@example.com');
    expect(findUserById(user.id)!.isApproved).toBe(true);

    revokeUser(user.id);
    expect(findUserById(user.id)!.isApproved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAllUsers / getPendingUsers
// ---------------------------------------------------------------------------

describe('getAllUsers / getPendingUsers', () => {
  it('getPendingUsers returns only unapproved non-admin users', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const u1 = createUser({ email: 'u1@x.com', name: 'U1', passwordHash: hash });
    const u2 = createUser({ email: 'u2@x.com', name: 'U2', passwordHash: hash });
    approveUser(u2.id, 'admin@x.com');

    const pending = getPendingUsers();
    expect(pending.map((u) => u.id)).toContain(u1.id);
    expect(pending.map((u) => u.id)).not.toContain(u2.id);
  });

  it('getAllUsers includes both approved and pending', () => {
    const hash = bcrypt.hashSync('pw', 1);
    createUser({ email: 'a@x.com', name: 'A', passwordHash: hash });
    const b = createUser({ email: 'b@x.com', name: 'B', passwordHash: hash });
    approveUser(b.id, 'admin@x.com');

    const all = getAllUsers();
    expect(all.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

describe('logAccess / getAuditLog', () => {
  it('stores an audit entry and retrieves it', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const user = createUser({ email: 'eve@x.com', name: 'Eve', passwordHash: hash });

    logAccess({
      userId: user.id,
      userEmail: user.email,
      partId: 'part-001',
      partNumber: 'PN-10001',
      revision: 'C',
      action: 'view_part',
      accessedAt: new Date().toISOString(),
    });

    const log = getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0]!.partNumber).toBe('PN-10001');
    expect(log[0]!.action).toBe('view_part');
  });

  it('getAuditLog returns entries in descending order', () => {
    const hash = bcrypt.hashSync('pw', 1);
    const user = createUser({ email: 'frank@x.com', name: 'Frank', passwordHash: hash });

    const t1 = '2024-01-01T00:00:00Z';
    const t2 = '2024-06-01T00:00:00Z';

    logAccess({ userId: user.id, userEmail: user.email, partId: 'p1', partNumber: 'PN-1', revision: 'A', action: 'view_part', accessedAt: t1 });
    logAccess({ userId: user.id, userEmail: user.email, partId: 'p2', partNumber: 'PN-2', revision: 'B', action: 'view_document', accessedAt: t2 });

    const log = getAuditLog();
    expect(log[0]!.accessedAt).toBe(t2); // newest first
    expect(log[1]!.accessedAt).toBe(t1);
  });
});

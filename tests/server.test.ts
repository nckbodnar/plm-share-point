/**
 * Integration tests for the Express server endpoints.
 *
 * Uses supertest to send HTTP requests against the app without binding to a port.
 * Uses an in-memory SQLite database to isolate tests from each other.
 */

import request from 'supertest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import app from '../src/server';
import { setDb, closeDb, createUser, approveUser } from '../src/db';
import { setPlmService } from '../src/services/plmService';
import { MockPlmService } from '../src/services/plmService';
import { signToken } from '../src/middleware/auth';

// Use the mock PLM service for all integration tests
setPlmService(new MockPlmService());

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      company TEXT,
      password_hash TEXT NOT NULL,
      is_approved INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      requested_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT,
      admin_notes TEXT
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_email TEXT NOT NULL,
      part_id TEXT NOT NULL,
      part_number TEXT NOT NULL,
      revision TEXT NOT NULL,
      action TEXT NOT NULL,
      accessed_at TEXT NOT NULL
    );
  `);
  return db;
}

let approvedUserId: number;
let adminUserId: number;
let approvedUserToken: string;
let adminToken: string;

beforeEach(() => {
  const db = createTestDb();
  setDb(db);

  const hash = bcrypt.hashSync('Password1!', 1);

  // Approved regular user
  const approvedUser = createUser({ email: 'viewer@example.com', name: 'Viewer', passwordHash: hash });
  approveUser(approvedUser.id, 'admin@example.com');
  approvedUserId = approvedUser.id;
  approvedUserToken = signToken({ userId: approvedUser.id, email: approvedUser.email, isAdmin: false });

  // Admin user
  db.prepare(`
    INSERT INTO users (email, name, password_hash, is_approved, is_admin, requested_at)
    VALUES ('admin@example.com', 'Admin', ?, 1, 1, ?)
  `).run(hash, new Date().toISOString());
  const adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com') as { id: number };
  adminUserId = adminUser.id;
  adminToken = signToken({ userId: adminUserId, email: 'admin@example.com', isAdmin: true });
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Authentication routes
// ---------------------------------------------------------------------------

describe('GET /login', () => {
  it('returns 200 with login form', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sign In');
  });
});

describe('POST /login', () => {
  it('rejects wrong credentials', async () => {
    const res = await request(app)
      .post('/login')
      .send('email=viewer%40example.com&password=wrong');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('redirects to /parts on success', async () => {
    const res = await request(app)
      .post('/login')
      .send('email=viewer%40example.com&password=Password1!');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/parts');
  });

  it('rejects unapproved user', async () => {
    const hash = bcrypt.hashSync('Password1!', 1);
    createUser({ email: 'pending@example.com', name: 'Pending', passwordHash: hash });

    const res = await request(app)
      .post('/login')
      .send('email=pending%40example.com&password=Password1!');
    expect(res.status).toBe(200);
    expect(res.text).toContain('pending approval');
  });
});

describe('GET /logout', () => {
  it('clears auth cookie and redirects to /login', async () => {
    const res = await request(app)
      .get('/logout')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});

describe('GET /request-access', () => {
  it('returns 200 with the request form', async () => {
    const res = await request(app).get('/request-access');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Request Access');
  });
});

describe('POST /request-access', () => {
  it('creates a user and shows success message', async () => {
    const res = await request(app)
      .post('/request-access')
      .type('form')
      .send({
        email: 'new@example.com',
        name: 'New User',
        company: 'ACME',
        reason: 'Need specs',
        password: 'Password1!',
        passwordConfirm: 'Password1!',
      });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Request submitted');
  });

  it('shows error when passwords do not match', async () => {
    const res = await request(app)
      .post('/request-access')
      .type('form')
      .send({
        email: 'new2@example.com',
        name: 'New User 2',
        reason: 'Need specs',
        password: 'Password1!',
        passwordConfirm: 'Different!',
      });
    expect(res.status).toBe(200);
    expect(res.text).toContain('do not match');
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/request-access')
      .type('form')
      .send({
        email: 'viewer@example.com',
        name: 'Duplicate',
        reason: 'Test',
        password: 'Password1!',
        passwordConfirm: 'Password1!',
      });
    expect(res.status).toBe(200);
    expect(res.text).toContain('already exists');
  });
});

// ---------------------------------------------------------------------------
// Parts routes (require auth)
// ---------------------------------------------------------------------------

describe('GET /parts', () => {
  it('redirects to /login when unauthenticated', async () => {
    const res = await request(app).get('/parts');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });

  it('returns 200 with parts list when authenticated', async () => {
    const res = await request(app)
      .get('/parts')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Released Parts');
  });

  it('filters parts by search query', async () => {
    const res = await request(app)
      .get('/parts?q=titanium')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Titanium');
  });
});

describe('GET /parts/:id', () => {
  it('returns 200 with part detail for authenticated user', async () => {
    const res = await request(app)
      .get('/parts/part-001')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('PN-10001');
    expect(res.text).toContain('Latest Released Revision');
  });

  it('returns 404 for unknown part', async () => {
    const res = await request(app)
      .get('/parts/unknown-id')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(404);
  });

  it('shows previous revision section when available', async () => {
    const res = await request(app)
      .get('/parts/part-001')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Previous Released Revision');
  });

  it('does not show previous revision section for single-revision parts', async () => {
    const res = await request(app)
      .get('/parts/part-003')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Previous Released Revision');
  });
});

describe('GET /parts/:id/documents/:docId', () => {
  it('returns document content for a valid document ID', async () => {
    const res = await request(app)
      .get('/parts/part-001/documents/doc-001-C')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
  });

  it('returns 403 for a document ID not belonging to the part', async () => {
    const res = await request(app)
      .get('/parts/part-001/documents/doc-002-B')  // belongs to part-002
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/parts/part-001/documents/doc-001-C');
    expect([302, 401]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

describe('GET /admin/dashboard', () => {
  it('returns 403 for a non-admin authenticated user', async () => {
    const res = await request(app)
      .get('/admin/dashboard')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 for an admin user', async () => {
    const res = await request(app)
      .get('/admin/dashboard')
      .set('Cookie', `auth_token=${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Access Management');
  });
});

describe('POST /admin/users/:id/approve', () => {
  it('allows admin to approve a pending user', async () => {
    const hash = bcrypt.hashSync('pw', 1);
    const pending = createUser({ email: 'pending2@example.com', name: 'Pending2', passwordHash: hash });

    const res = await request(app)
      .post(`/admin/users/${pending.id}/approve`)
      .set('Cookie', `auth_token=${adminToken}`)
      .type('form')
      .send({ notes: 'Approved' });

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/dashboard');
  });
});

describe('POST /admin/users/:id/revoke', () => {
  it('allows admin to revoke an approved user', async () => {
    const res = await request(app)
      .post(`/admin/users/${approvedUserId}/revoke`)
      .set('Cookie', `auth_token=${adminToken}`);

    expect(res.status).toBe(302);
  });
});

describe('GET /admin/audit', () => {
  it('returns audit log page for admin', async () => {
    const res = await request(app)
      .get('/admin/audit')
      .set('Cookie', `auth_token=${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Audit Log');
  });
});

// ---------------------------------------------------------------------------
// Assemblies routes
// ---------------------------------------------------------------------------

describe('GET /assemblies', () => {
  it('redirects to /login when unauthenticated', async () => {
    const res = await request(app).get('/assemblies');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('/login');
  });

  it('returns 200 with assembly list when authenticated', async () => {
    const res = await request(app)
      .get('/assemblies')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Assemblies');
    expect(res.text).toContain('ASM-20001');
  });

  it('shows all 3 mock assemblies', async () => {
    const res = await request(app)
      .get('/assemblies')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('ASM-20001');
    expect(res.text).toContain('ASM-20002');
    expect(res.text).toContain('ASM-20003');
  });

  it('filters assemblies by search query', async () => {
    const res = await request(app)
      .get('/assemblies?q=zirconia')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Zirconia');
    expect(res.text).not.toContain('ASM-20001');
  });
});

describe('GET /assemblies/:id', () => {
  it('returns 200 with assembly detail for authenticated user', async () => {
    const res = await request(app)
      .get('/assemblies/asm-001')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('ASM-20001');
    expect(res.text).toContain('Bill of Materials');
  });

  it('shows revision switcher when previousRevision exists', async () => {
    const res = await request(app)
      .get('/assemblies/asm-001')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Previous');
  });

  it('returns 404 for unknown assembly', async () => {
    const res = await request(app)
      .get('/assemblies/unknown-asm')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 302 redirect when unauthenticated', async () => {
    const res = await request(app).get('/assemblies/asm-001');
    expect(res.status).toBe(302);
  });
});

describe('GET /assemblies/:id/bom.json', () => {
  it('returns JSON with nodes and edges for latest revision', async () => {
    const res = await request(app)
      .get('/assemblies/asm-001/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.text) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes.length).toBeGreaterThan(1); // root + at least 1 part
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('root node has isRoot=true', async () => {
    const res = await request(app)
      .get('/assemblies/asm-001/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    const body = JSON.parse(res.text) as { nodes: Array<{ data: { isRoot: boolean } }> };
    const root = body.nodes.find((n) => n.data.isRoot);
    expect(root).toBeDefined();
  });

  it('returns previous revision BOM when ?rev= param is provided', async () => {
    const res = await request(app)
      .get('/assemblies/asm-001/bom.json?rev=A')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { nodes: unknown[]; edges: unknown[] };
    // Previous revision A has 2 components (+ root = 3 nodes)
    expect(body.nodes.length).toBe(3);
  });

  it('returns 404 JSON for unknown assembly', async () => {
    const res = await request(app)
      .get('/assemblies/unknown-asm/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(404);
  });

  it('asm-003 latest BOM has 6 nodes (root + 5 components)', async () => {
    const res = await request(app)
      .get('/assemblies/asm-003/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { nodes: unknown[] };
    expect(body.nodes.length).toBe(6);
  });
});

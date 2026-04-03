import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/server';
import * as pgDb from '../src/pgDb';
import { signToken } from '../src/middleware/auth';
import type { User } from '../src/types';

jest.mock('../src/pgDb', () => ({
  initPgDb: jest.fn().mockResolvedValue(undefined),
  findUserById: jest.fn(),
  findUserByEmail: jest.fn(),
  createUser: jest.fn(),
  getAllUsers: jest.fn().mockResolvedValue([]),
  getPendingUsers: jest.fn().mockResolvedValue([]),
  approveUser: jest.fn().mockResolvedValue(undefined),
  rejectUser: jest.fn().mockResolvedValue(undefined),
  revokeUser: jest.fn().mockResolvedValue(undefined),
  updatePassword: jest.fn().mockResolvedValue(undefined),
  getAuditLog: jest.fn().mockResolvedValue([]),
  logAccess: jest.fn().mockResolvedValue(undefined),
  listDrawings: jest.fn().mockResolvedValue([]),
  listProjects: jest.fn().mockResolvedValue([]),
  listGroups: jest.fn().mockResolvedValue([]),
  listLocations: jest.fn().mockResolvedValue([]),
  listAssemblies: jest.fn().mockResolvedValue([]),
  getDrawing: jest.fn().mockResolvedValue(null),
  getAssemblyComponents: jest.fn().mockResolvedValue([]),
  getGroupsForUser: jest.fn().mockResolvedValue([]),
  getLocationsForUser: jest.fn().mockResolvedValue([]),
  removeAllGroupsFromUser: jest.fn().mockResolvedValue(undefined),
  addUserToGroup: jest.fn().mockResolvedValue(undefined),
  removeAllLocationsFromUser: jest.fn().mockResolvedValue(undefined),
  addLocationToUser: jest.fn().mockResolvedValue(undefined),
}));

// Helper to create a fake user
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'viewer@example.com',
    name: 'Viewer',
    passwordHash: bcrypt.hashSync('Password1!', 1),
    isApproved: true,
    isAdmin: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

const approvedUser = makeUser({ id: 1, email: 'viewer@example.com', isApproved: true, isAdmin: false });
const adminUser = makeUser({ id: 2, email: 'admin@example.com', isApproved: true, isAdmin: true });
const pendingUser = makeUser({ id: 3, email: 'pending@example.com', isApproved: false });

const approvedUserToken = signToken({ userId: approvedUser.id, email: approvedUser.email, isAdmin: false });
const adminToken = signToken({ userId: adminUser.id, email: adminUser.email, isAdmin: true });

beforeEach(() => {
  jest.clearAllMocks();

  (pgDb.findUserById as jest.Mock).mockImplementation(async (id: number) => {
    if (id === 1) return approvedUser;
    if (id === 2) return adminUser;
    return undefined;
  });

  (pgDb.findUserByEmail as jest.Mock).mockResolvedValue(undefined);
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
    (pgDb.findUserByEmail as jest.Mock).mockResolvedValueOnce(approvedUser);
    const res = await request(app)
      .post('/login')
      .send('email=viewer%40example.com&password=wrong');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('redirects to /drawings on success', async () => {
    (pgDb.findUserByEmail as jest.Mock).mockResolvedValueOnce(approvedUser);
    const res = await request(app)
      .post('/login')
      .send('email=viewer%40example.com&password=Password1!');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/drawings');
  });

  it('rejects unapproved user', async () => {
    (pgDb.findUserByEmail as jest.Mock).mockResolvedValueOnce(pendingUser);
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
    (pgDb.createUser as jest.Mock).mockResolvedValueOnce(makeUser({ id: 10, email: 'new@example.com' }));
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
    (pgDb.findUserByEmail as jest.Mock).mockResolvedValueOnce(approvedUser);
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
// Parts routes (now redirect to /drawings)
// ---------------------------------------------------------------------------

describe('GET /parts', () => {
  it('redirects to /login when unauthenticated', async () => {
    const res = await request(app).get('/parts');
    expect([301, 302]).toContain(res.status);
  });

  it('redirects to /drawings', async () => {
    const res = await request(app)
      .get('/parts')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(301);
    expect(res.headers['location']).toBe('/drawings');
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
    (pgDb.findUserById as jest.Mock).mockImplementation(async (id: number) => {
      if (id === 2) return adminUser;
      if (id === 3) return pendingUser;
      return undefined;
    });

    const res = await request(app)
      .post(`/admin/users/3/approve`)
      .set('Cookie', `auth_token=${adminToken}`)
      .type('form')
      .send({ notes: 'Approved' });

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/dashboard');
  });
});

describe('POST /admin/users/:id/revoke', () => {
  it('allows admin to revoke an approved user', async () => {
    (pgDb.findUserById as jest.Mock).mockImplementation(async (id: number) => {
      if (id === 2) return adminUser;
      if (id === 1) return approvedUser;
      return undefined;
    });

    const res = await request(app)
      .post(`/admin/users/1/revoke`)
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
  });
});

describe('GET /assemblies/:id', () => {
  it('returns 404 for unknown assembly', async () => {
    (pgDb.getDrawing as jest.Mock).mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/assemblies/unknown-id')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 302 redirect when unauthenticated', async () => {
    const res = await request(app).get('/assemblies/some-id');
    expect(res.status).toBe(302);
  });

  it('returns 200 with assembly detail for authenticated user', async () => {
    const fakeAssembly = {
      id: 'asm-001', name: 'Test Assembly', revision: 'A',
      description: 'Test desc', metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    (pgDb.getDrawing as jest.Mock).mockResolvedValueOnce(fakeAssembly);
    (pgDb.getAssemblyComponents as jest.Mock).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/assemblies/asm-001')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Assembly');
  });
});

describe('GET /assemblies/:id/bom.json', () => {
  it('returns JSON with nodes and edges', async () => {
    const fakeAssembly = {
      id: 'asm-001', name: 'Test Assembly', revision: 'A',
      description: null, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    (pgDb.getDrawing as jest.Mock).mockResolvedValueOnce(fakeAssembly);
    (pgDb.getAssemblyComponents as jest.Mock).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/assemblies/asm-001/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.text) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes.length).toBe(1);
    expect(body.edges.length).toBe(0);
  });

  it('root node has isRoot=true', async () => {
    const fakeAssembly = {
      id: 'asm-001', name: 'Test Assembly', revision: 'A',
      description: null, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    (pgDb.getDrawing as jest.Mock).mockResolvedValueOnce(fakeAssembly);
    (pgDb.getAssemblyComponents as jest.Mock).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/assemblies/asm-001/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    const body = JSON.parse(res.text) as { nodes: Array<{ data: { isRoot: boolean } }> };
    const root = body.nodes.find((n) => n.data.isRoot);
    expect(root).toBeDefined();
  });

  it('returns 404 JSON for unknown assembly', async () => {
    (pgDb.getDrawing as jest.Mock).mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/assemblies/unknown-asm/bom.json')
      .set('Cookie', `auth_token=${approvedUserToken}`);
    expect(res.status).toBe(404);
  });
});

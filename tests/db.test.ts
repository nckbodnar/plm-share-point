import { Pool } from 'pg';
import {
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
} from '../src/pgDb';

// Access the shared mockQuery via the mock Pool class
const mockPool = new Pool();
const mockQuery = mockPool.query as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('findUserByEmail', () => {
  it('queries with lowercase email comparison', async () => {
    const fakeUser = {
      id: 1, email: 'alice@example.com', name: 'Alice', company: null,
      password_hash: 'hash', is_approved: false, is_admin: false,
      reason: null, requested_at: new Date(), approved_at: null,
      approved_by: null, admin_notes: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeUser] });

    const user = await findUserByEmail('Alice@Example.com');

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      ['Alice@Example.com'],
    );
    expect(user).toBeDefined();
    expect(user!.email).toBe('alice@example.com');
  });

  it('returns undefined when no user found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const user = await findUserByEmail('nobody@example.com');
    expect(user).toBeUndefined();
  });
});

describe('findUserById', () => {
  it('queries by id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const user = await findUserById(9999);
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [9999]);
    expect(user).toBeUndefined();
  });

  it('returns mapped user when found', async () => {
    const fakeUser = {
      id: 42, email: 'bob@example.com', name: 'Bob', company: 'ACME',
      password_hash: 'hash', is_approved: true, is_admin: false,
      reason: 'testing', requested_at: new Date(), approved_at: new Date(),
      approved_by: 'admin@example.com', admin_notes: 'ok',
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeUser] });
    const user = await findUserById(42);
    expect(user).toBeDefined();
    expect(user!.id).toBe(42);
    expect(user!.isApproved).toBe(true);
  });
});

describe('getAllUsers', () => {
  it('selects all users ordered by requested_at DESC', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getAllUsers();
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users ORDER BY requested_at DESC');
  });
});

describe('getPendingUsers', () => {
  it('filters unapproved non-admin users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getPendingUsers();
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE is_approved = false AND is_admin = false ORDER BY requested_at DESC',
    );
  });
});

describe('createUser', () => {
  it('inserts user and returns mapped result', async () => {
    const fakeUser = {
      id: 1, email: 'carol@example.com', name: 'Carol', company: null,
      password_hash: 'hash', is_approved: false, is_admin: false,
      reason: 'Need access', requested_at: new Date(), approved_at: null,
      approved_by: null, admin_notes: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeUser] });

    const user = await createUser({
      email: 'carol@example.com',
      name: 'Carol',
      passwordHash: 'hash',
      reason: 'Need access',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      ['carol@example.com', 'Carol', null, 'hash', 'Need access'],
    );
    expect(user.email).toBe('carol@example.com');
    expect(user.isApproved).toBe(false);
  });
});

describe('approveUser', () => {
  it('updates user approval status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await approveUser(1, 'admin@example.com', 'Looks good');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET is_approved = true'),
      ['admin@example.com', 'Looks good', 1],
    );
  });
});

describe('rejectUser', () => {
  it('updates user with rejection notes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await rejectUser(2, 'admin@example.com', 'Not authorised');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET is_approved = false'),
      ['admin@example.com', 'Not authorised', 2],
    );
  });
});

describe('revokeUser', () => {
  it('sets is_approved to false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await revokeUser(3);
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE users SET is_approved = false WHERE id = $1',
      [3],
    );
  });
});

describe('logAccess', () => {
  it('inserts an audit log entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await logAccess({
      userId: 1,
      userEmail: 'user@example.com',
      partId: 'part-001',
      partNumber: 'PN-10001',
      revision: 'C',
      action: 'view_part',
      accessedAt: '2024-01-01T00:00:00Z',
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      [1, 'user@example.com', 'part-001', 'PN-10001', 'C', 'view_part', '2024-01-01T00:00:00Z'],
    );
  });
});

describe('getAuditLog', () => {
  it('queries audit log with limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getAuditLog(100);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM audit_log ORDER BY accessed_at DESC LIMIT $1',
      [100],
    );
  });

  it('uses default limit of 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getAuditLog();
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM audit_log ORDER BY accessed_at DESC LIMIT $1',
      [500],
    );
  });
});

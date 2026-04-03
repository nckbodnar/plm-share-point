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
      admin_notes   TEXT,
      group_id      INTEGER,
      location_id   INTEGER,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      description TEXT,
      lead        TEXT,
      created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS locations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL,
      address    TEXT,
      manager    TEXT,
      capacity   INTEGER,
      created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      status      TEXT    NOT NULL,
      description TEXT,
      manager     TEXT,
      start_date  TEXT,
      end_date    TEXT,
      created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drawings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      version     TEXT,
      status      TEXT,
      description TEXT,
      created_by  TEXT,
      created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_modified TEXT,
      project_id  INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS project_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL,
      group_id    INTEGER,
      location_id INTEGER,
      permission_type TEXT NOT NULL DEFAULT 'view',
      created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (location_id) REFERENCES locations(id)
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

  seedBasicData(db);
}

/** Create basic data if missing. */
function seedBasicData(db: Database.Database): void {
  // Create default groups
  const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
  if (groupCount.count === 0) {
    db.prepare(`
      INSERT INTO groups (name, type, description, lead)
      VALUES 
        ('Engineering Team', 'Department', 'Mechanical and electrical engineers', 'John Doe'),
        ('Quality Assurance', 'Department', 'Product testing and quality control', 'Jane Smith'),
        ('Project Alpha', 'Project Team', 'Special project development team', 'Bob Johnson'),
        ('Administrators', 'System', 'System administrators and IT support', 'Alice Brown')
    `).run();
  }

  // Create default locations
  const locationCount = db.prepare('SELECT COUNT(*) as count FROM locations').get() as { count: number };
  if (locationCount.count === 0) {
    db.prepare(`
      INSERT INTO locations (name, type, address, manager, capacity)
      VALUES 
        ('Main Factory', 'Manufacturing', '123 Industrial Blvd, Detroit, MI', 'John Doe', 1000),
        ('R&D Center', 'Research', '456 Tech Park Dr, Silicon Valley, CA', 'Jane Smith', 200),
        ('Parts Warehouse', 'Storage', '789 Storage Way, Ohio, OH', 'Bob Johnson', 5000)
    `).run();
  }

  // Create default projects
  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
  if (projectCount.count === 0) {
    db.prepare(`
      INSERT INTO projects (name, status, description, manager, start_date, end_date)
      VALUES 
        ('Vehicle Model 2024', 'Active', 'Next generation vehicle development project', 'John Doe', '2024-01-01', '2024-12-31'),
        ('Electric Powertrain', 'In Progress', 'Electric vehicle powertrain development', 'Jane Smith', '2024-02-01', '2024-11-30'),
        ('Advanced Safety Systems', 'Planning', 'Next-gen safety and driver assistance systems', 'Bob Johnson', '2024-03-01', '2025-02-28')
    `).run();
  }

  // Create default drawings
  const drawingCount = db.prepare('SELECT COUNT(*) as count FROM drawings').get() as { count: number };
  if (drawingCount.count === 0) {
    db.prepare(`
      INSERT INTO drawings (name, version, status, description, created_by, last_modified, project_id)
      VALUES 
        ('Engine Block Drawing', 'v1.2', 'Active', 'Technical drawing for main engine block assembly', 'John Doe', '2024-02-20', 1),
        ('Transmission Housing', 'v2.0', 'Under Review', 'Housing assembly for automatic transmission', 'Jane Smith', '2024-02-25', 1),
        ('Brake Assembly', 'v1.5', 'Active', 'Complete brake system assembly drawing', 'Bob Johnson', '2024-02-28', 2)
    `).run();
  }

  // Create default admin account
  const existing = db
    .prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1')
    .get() as { id: number } | undefined;

  if (!existing) {
    const hash = bcrypt.hashSync('ChangeMe123!', 12);
    db.prepare(`
      INSERT INTO users (email, name, company, password_hash, is_approved, is_admin, requested_at, group_id, location_id)
      VALUES (?, ?, ?, ?, 1, 1, ?, 4, 1)
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

interface DbGroup {
  id: number;
  name: string;
  type: string;
  description?: string;
  lead?: string;
  created_at: string;
}

interface DbLocation {
  id: number;
  name: string;
  type: string;
  address?: string;
  manager?: string;
  capacity?: number;
  created_at: string;
}

interface DbProject {
  id: number;
  name: string;
  status: string;
  description?: string;
  manager?: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
}

interface DbDrawing {
  id: number;
  name: string;
  version?: string;
  status?: string;
  description?: string;
  created_by?: string;
  created_at: string;
  last_modified?: string;
  project_id?: number;
}

interface DbUserWithGroupLocation {
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
  group_id: number | null;
  location_id: number | null;
  group_name: string | null;
  location_name: string | null;
}

interface DbProjectPermission {
  id: number;
  project_id: number;
  group_id?: number;
  location_id?: number;
  permission_type: string;
  created_at: string;
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

// ---------------------------------------------------------------------------
// Groups, Locations, Projects, Drawings helpers
// ---------------------------------------------------------------------------

export interface Group {
  id: number;
  name: string;
  type: string;
  description?: string;
  lead?: string;
  createdAt: string;
}

export interface Location {
  id: number;
  name: string;
  type: string;
  address?: string;
  manager?: string;
  capacity?: number;
  createdAt: string;
}

export interface Project {
  id: number;
  name: string;
  status: string;
  description?: string;
  manager?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
}

export interface Drawing {
  id: number;
  name: string;
  version?: string;
  status?: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
  lastModified?: string;
  projectId?: number;
}

export interface ProjectPermission {
  id: number;
  projectId: number;
  groupId?: number;
  locationId?: number;
  permissionType: string;
  createdAt: string;
}

// Groups
export function getAllGroups(): Group[] {
  const rows = getDb().prepare('SELECT * FROM groups ORDER BY name').all() as DbGroup[];
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    lead: row.lead,
    createdAt: row.created_at
  }));
}

export function getGroupById(id: number): Group | undefined {
  const row = getDb().prepare('SELECT * FROM groups WHERE id = ?').get(id) as DbGroup | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    lead: row.lead,
    createdAt: row.created_at
  };
}

// Get users in a group
export function getUsersByGroupId(groupId: number) {
  const rows = getDb().prepare('SELECT * FROM users WHERE group_id = ? AND is_approved = 1').all(groupId) as DbUser[];
  return rows.map(row => mapUser(row));
}

// Locations
export function getAllLocations(): Location[] {
  const rows = getDb().prepare('SELECT * FROM locations ORDER BY name').all() as DbLocation[];
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    manager: row.manager,
    capacity: row.capacity,
    createdAt: row.created_at
  }));
}

export function getLocationById(id: number): Location | undefined {
  const row = getDb().prepare('SELECT * FROM locations WHERE id = ?').get(id) as DbLocation | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    manager: row.manager,
    capacity: row.capacity,
    createdAt: row.created_at
  };
}

// Projects
export function getAllProjects(): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects ORDER BY name').all() as DbProject[];
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    status: row.status,
    description: row.description,
    manager: row.manager,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at
  }));
}

export function getProjectById(id: number): Project | undefined {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as DbProject | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    description: row.description,
    manager: row.manager,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at
  };
}

// Drawings
export function getAllDrawings(): Drawing[] {
  const rows = getDb().prepare('SELECT * FROM drawings ORDER BY name').all() as DbDrawing[];
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastModified: row.last_modified,
    projectId: row.project_id
  }));
}

export function getDrawingById(id: number): Drawing | undefined {
  const row = getDb().prepare('SELECT * FROM drawings WHERE id = ?').get(id) as DbDrawing | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastModified: row.last_modified,
    projectId: row.project_id
  };
}

// User permissions
export function updateUserGroupAndLocation(userId: number, groupId?: number, locationId?: number): void {
  getDb().prepare(`
    UPDATE users SET group_id = ?, location_id = ? WHERE id = ?
  `).run(groupId || null, locationId || null, userId);
}

export function getUserWithGroupAndLocation(userId: number): DbUserWithGroupLocation | undefined {
  const row = getDb().prepare(`
    SELECT u.*, g.name as group_name, l.name as location_name
    FROM users u
    LEFT JOIN groups g ON u.group_id = g.id
    LEFT JOIN locations l ON u.location_id = l.id
    WHERE u.id = ?
  `).get(userId) as DbUserWithGroupLocation | undefined;
  return row;
}

// Project permissions
export function getProjectPermissions(projectId: number): ProjectPermission[] {
  const rows = getDb().prepare('SELECT * FROM project_permissions WHERE project_id = ?').all(projectId) as DbProjectPermission[];
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    groupId: row.group_id,
    locationId: row.location_id,
    permissionType: row.permission_type,
    createdAt: row.created_at
  }));
}

export function addProjectPermission(projectId: number, groupId?: number, locationId?: number, permissionType = 'view'): void {
  getDb().prepare(`
    INSERT INTO project_permissions (project_id, group_id, location_id, permission_type)
    VALUES (?, ?, ?, ?)
  `).run(projectId, groupId || null, locationId || null, permissionType);
}

export function removeProjectPermission(permissionId: number): void {
  getDb().prepare('DELETE FROM project_permissions WHERE id = ?').run(permissionId);
}

// Check if user can access project
export function canUserAccessProject(userId: number, projectId: number): boolean {
  const user = getUserWithGroupAndLocation(userId);
  if (!user) return false;
  
  // Admin can access everything
  if (user.is_admin) return true;
  
  // Check if user's group or location has permission
  const permission = getDb().prepare(`
    SELECT COUNT(*) as count FROM project_permissions 
    WHERE project_id = ? AND (
      (group_id IS NOT NULL AND group_id = ?) OR 
      (location_id IS NOT NULL AND location_id = ?)
    )
  `).get(projectId, user.group_id, user.location_id) as { count: number };
  
  return permission.count > 0;
}

// Get drawings that user can access
export function getAccessibleDrawings(userId: number): Drawing[] {
  const user = getUserWithGroupAndLocation(userId);
  if (!user) return [];
  
  // Admin can see all drawings
  if (user.is_admin) {
    return getAllDrawings();
  }
  
  // Get drawings from projects that user can access
  const rows = getDb().prepare(`
    SELECT DISTINCT d.* FROM drawings d
    JOIN projects p ON d.project_id = p.id
    JOIN project_permissions pp ON p.id = pp.project_id
    WHERE (pp.group_id = ? OR pp.location_id = ?)
    ORDER BY d.name
  `).all(user.group_id, user.location_id) as DbDrawing[];
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastModified: row.last_modified,
    projectId: row.project_id
  }));
}

import { Pool } from 'pg';
import { config } from './config';
import type { TechDoc, TechDocMetadata, Project, DbLocation, Group, User, AuditEntry } from './types';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  company       TEXT,
  password_hash TEXT NOT NULL,
  is_approved   BOOLEAN NOT NULL DEFAULT false,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  reason        TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,
  admin_notes   TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  user_email   TEXT NOT NULL,
  part_id      TEXT NOT NULL,
  part_number  TEXT NOT NULL,
  revision     TEXT NOT NULL,
  action       TEXT NOT NULL,
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_email  TEXT NOT NULL,
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_email, group_id)
);

CREATE TABLE IF NOT EXISTS group_projects (
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, project_id)
);

CREATE TABLE IF NOT EXISTS tech_docs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  revision    TEXT NOT NULL DEFAULT 'A',
  file_path   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tech_doc_projects (
  tech_doc_id UUID NOT NULL REFERENCES tech_docs(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (tech_doc_id, project_id)
);

CREATE TABLE IF NOT EXISTS tech_doc_locations (
  tech_doc_id UUID NOT NULL REFERENCES tech_docs(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (tech_doc_id, location_id)
);

CREATE TABLE IF NOT EXISTS project_locations (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, location_id)
);

CREATE TABLE IF NOT EXISTS user_locations (
  user_email  TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_email, location_id)
);

CREATE INDEX IF NOT EXISTS idx_tech_docs_metadata        ON tech_docs USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_tech_docs_name            ON tech_docs (name);
CREATE INDEX IF NOT EXISTS idx_tech_doc_projects_doc     ON tech_doc_projects (tech_doc_id);
CREATE INDEX IF NOT EXISTS idx_tech_doc_projects_project ON tech_doc_projects (project_id);

CREATE TABLE IF NOT EXISTS assembly_components (
  parent_id            UUID NOT NULL REFERENCES tech_docs(id) ON DELETE CASCADE,
  child_id             UUID NOT NULL REFERENCES tech_docs(id) ON DELETE CASCADE,
  quantity             INTEGER NOT NULL DEFAULT 1,
  reference_designator TEXT,
  PRIMARY KEY (parent_id, child_id)
);

-- Revision history: each row is a snapshot of a past revision
CREATE TABLE IF NOT EXISTS tech_doc_revisions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tech_doc_id  UUID NOT NULL REFERENCES tech_docs(id) ON DELETE CASCADE,
  revision     TEXT NOT NULL,
  file_path    TEXT,
  notes        TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_doc_revisions_doc ON tech_doc_revisions (tech_doc_id, created_at DESC);
`;

export async function initPgDb(): Promise<void> {
  const db = getPool();
  await db.query(SCHEMA_SQL);
  await seedDefaultData();
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

function rowToTechDoc(row: Record<string, unknown>): TechDoc {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? undefined,
    revision: row['revision'] as string,
    filePath: (row['file_path'] as string | null) ?? undefined,
    metadata: (row['metadata'] as TechDocMetadata) ?? {},
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

function rowToLocation(row: Record<string, unknown>): DbLocation {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

function rowToGroup(row: Record<string, unknown>): Group {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

// ── Drawing CRUD ──────────────────────────────────────────────────────────────

export async function createTechDoc(data: {
  name: string;
  description?: string;
  revision?: string;
  metadata?: TechDocMetadata;
}): Promise<TechDoc> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO tech_docs (name, description, revision, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, data.description ?? null, data.revision ?? 'A', JSON.stringify(data.metadata ?? {})],
  );
  return rowToTechDoc(rows[0] as Record<string, unknown>);
}

export async function getTechDoc(id: string): Promise<TechDoc | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM tech_docs WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return rowToTechDoc(rows[0] as Record<string, unknown>);
}

export async function listTechDocs(filters?: {
  projectId?: string;
  locationId?: string;
  search?: string;
  metadata?: Record<string, unknown>;
}): Promise<TechDoc[]> {
  const db = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.projectId) {
    params.push(filters.projectId);
    conditions.push(`d.id IN (SELECT tech_doc_id FROM tech_doc_projects WHERE project_id = $${params.length})`);
  }
  if (filters?.locationId) {
    params.push(filters.locationId);
    conditions.push(`d.id IN (SELECT tech_doc_id FROM tech_doc_locations WHERE location_id = $${params.length})`);
  }
  if (filters?.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(d.name ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
  }
  if (filters?.metadata) {
    params.push(JSON.stringify(filters.metadata));
    conditions.push(`d.metadata @> $${params.length}::jsonb`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT d.* FROM tech_docs d ${where} ORDER BY d.name`, params);
  return (rows as Record<string, unknown>[]).map(rowToTechDoc);
}

export async function updateTechDoc(id: string, data: Partial<TechDoc>): Promise<TechDoc | null> {
  const db = getPool();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { params.push(data.name); sets.push(`name = $${params.length}`); }
  if (data.description !== undefined) { params.push(data.description); sets.push(`description = $${params.length}`); }
  if (data.revision !== undefined) { params.push(data.revision); sets.push(`revision = $${params.length}`); }
  if (data.metadata !== undefined) { params.push(JSON.stringify(data.metadata)); sets.push(`metadata = $${params.length}`); }

  if (sets.length === 0) return getTechDoc(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE tech_docs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;
  return rowToTechDoc(rows[0] as Record<string, unknown>);
}

export async function deleteTechDoc(id: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM tech_docs WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ── Revision history ──────────────────────────────────────────────────────────

export interface TechDocRevision {
  id: string;
  techDocId: string;
  revision: string;
  filePath?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

function rowToRevision(row: Record<string, unknown>): TechDocRevision {
  return {
    id: row['id'] as string,
    techDocId: row['tech_doc_id'] as string,
    revision: row['revision'] as string,
    filePath: (row['file_path'] as string | null) ?? undefined,
    notes: (row['notes'] as string | null) ?? undefined,
    createdBy: (row['created_by'] as string | null) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

/** Save a snapshot of the current revision into history */
export async function createRevisionSnapshot(data: {
  techDocId: string;
  revision: string;
  filePath?: string;
  notes?: string;
  createdBy?: string;
}): Promise<TechDocRevision> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO tech_doc_revisions (tech_doc_id, revision, file_path, notes, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.techDocId, data.revision, data.filePath ?? null, data.notes ?? null, data.createdBy ?? null],
  );
  return rowToRevision(rows[0] as Record<string, unknown>);
}

export async function listRevisions(techDocId: string): Promise<TechDocRevision[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT * FROM tech_doc_revisions WHERE tech_doc_id = $1 ORDER BY created_at DESC`,
    [techDocId],
  );
  return (rows as Record<string, unknown>[]).map(rowToRevision);
}

export async function getRevision(revisionId: string): Promise<TechDocRevision | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM tech_doc_revisions WHERE id = $1', [revisionId]);
  if (rows.length === 0) return null;
  return rowToRevision(rows[0] as Record<string, unknown>);
}

export async function deleteRevision(revisionId: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM tech_doc_revisions WHERE id = $1', [revisionId]);
  return (rowCount ?? 0) > 0;
}

export async function setTechDocFilePath(id: string, filePath: string): Promise<void> {
  const db = getPool();
  await db.query('UPDATE tech_docs SET file_path = $1, updated_at = NOW() WHERE id = $2', [filePath, id]);
}

export async function getTechDocsForUser(userEmail: string): Promise<TechDoc[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT DISTINCT d.*
     FROM tech_docs d
     JOIN tech_doc_projects dp ON dp.tech_doc_id = d.id
     WHERE
       EXISTS (
         SELECT 1 FROM group_projects gp
         JOIN user_groups ug ON ug.group_id = gp.group_id
         WHERE gp.project_id = dp.project_id AND ug.user_email = $1
       )
       AND
       (
         NOT EXISTS (SELECT 1 FROM project_locations pl WHERE pl.project_id = dp.project_id)
         OR EXISTS (
           SELECT 1 FROM project_locations pl
           JOIN user_locations ul ON ul.location_id = pl.location_id
           WHERE pl.project_id = dp.project_id AND ul.user_email = $1
         )
       )
     ORDER BY d.name`,
    [userEmail],
  );
  return (rows as Record<string, unknown>[]).map(rowToTechDoc);
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export async function createProject(data: { name: string; description?: string }): Promise<Project> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *`,
    [data.name, data.description ?? null],
  );
  return rowToProject(rows[0] as Record<string, unknown>);
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return rowToProject(rows[0] as Record<string, unknown>);
}

export async function listProjects(): Promise<Project[]> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM projects ORDER BY name');
  return (rows as Record<string, unknown>[]).map(rowToProject);
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project | null> {
  const db = getPool();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { params.push(data.name); sets.push(`name = $${params.length}`); }
  if (data.description !== undefined) { params.push(data.description); sets.push(`description = $${params.length}`); }

  if (sets.length === 0) return getProject(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;
  return rowToProject(rows[0] as Record<string, unknown>);
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function addTechDocToProject(techDocId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO tech_doc_projects (tech_doc_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [techDocId, projectId],
  );
}

export async function removeTechDocFromProject(techDocId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM tech_doc_projects WHERE tech_doc_id = $1 AND project_id = $2', [techDocId, projectId]);
}

export async function getProjectsForTechDoc(techDocId: string): Promise<Project[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT p.* FROM projects p
     JOIN tech_doc_projects dp ON dp.project_id = p.id
     WHERE dp.tech_doc_id = $1
     ORDER BY p.name`,
    [techDocId],
  );
  return (rows as Record<string, unknown>[]).map(rowToProject);
}

// ── Location CRUD ─────────────────────────────────────────────────────────────

export async function createLocation(data: { name: string }): Promise<DbLocation> {
  const db = getPool();
  const { rows } = await db.query(`INSERT INTO locations (name) VALUES ($1) RETURNING *`, [data.name]);
  return rowToLocation(rows[0] as Record<string, unknown>);
}

export async function getLocation(id: string): Promise<DbLocation | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM locations WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return rowToLocation(rows[0] as Record<string, unknown>);
}

export async function listLocations(): Promise<DbLocation[]> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM locations ORDER BY name');
  return (rows as Record<string, unknown>[]).map(rowToLocation);
}

export async function updateLocation(id: string, name: string): Promise<DbLocation | null> {
  const db = getPool();
  const { rows } = await db.query(
    `UPDATE locations SET name = $1 WHERE id = $2 RETURNING *`,
    [name, id],
  );
  if (rows.length === 0) return null;
  return rowToLocation(rows[0] as Record<string, unknown>);
}

export async function deleteLocation(id: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM locations WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function addTechDocToLocation(techDocId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO tech_doc_locations (tech_doc_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [techDocId, locationId],
  );
}

export async function removeTechDocFromLocation(techDocId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    'DELETE FROM tech_doc_locations WHERE tech_doc_id = $1 AND location_id = $2',
    [techDocId, locationId],
  );
}

export async function getLocationsForTechDoc(techDocId: string): Promise<DbLocation[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT l.* FROM locations l
     JOIN tech_doc_locations dl ON dl.location_id = l.id
     WHERE dl.tech_doc_id = $1
     ORDER BY l.name`,
    [techDocId],
  );
  return (rows as Record<string, unknown>[]).map(rowToLocation);
}

// ── Group CRUD ────────────────────────────────────────────────────────────────

export async function createGroup(name: string): Promise<Group> {
  const db = getPool();
  const { rows } = await db.query(`INSERT INTO groups (name) VALUES ($1) RETURNING *`, [name]);
  return rowToGroup(rows[0] as Record<string, unknown>);
}

export async function getGroup(id: string): Promise<Group | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return rowToGroup(rows[0] as Record<string, unknown>);
}

export async function listGroups(): Promise<Group[]> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM groups ORDER BY name');
  return (rows as Record<string, unknown>[]).map(rowToGroup);
}

export async function deleteGroup(id: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM groups WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function addUserToGroup(userEmail: string, groupId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO user_groups (user_email, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userEmail, groupId],
  );
}

export async function removeUserFromGroup(userEmail: string, groupId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM user_groups WHERE user_email = $1 AND group_id = $2', [userEmail, groupId]);
}

export async function addGroupToProject(groupId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO group_projects (group_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [groupId, projectId],
  );
}

export async function removeGroupFromProject(groupId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM group_projects WHERE group_id = $1 AND project_id = $2', [groupId, projectId]);
}

export async function getGroupsForUser(userEmail: string): Promise<Group[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT g.* FROM groups g
     JOIN user_groups ug ON ug.group_id = g.id
     WHERE ug.user_email = $1
     ORDER BY g.name`,
    [userEmail],
  );
  return (rows as Record<string, unknown>[]).map(rowToGroup);
}

export async function getProjectsForGroup(groupId: string): Promise<Project[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT p.* FROM projects p
     JOIN group_projects gp ON gp.project_id = p.id
     WHERE gp.group_id = $1
     ORDER BY p.name`,
    [groupId],
  );
  return (rows as Record<string, unknown>[]).map(rowToProject);
}

export async function getUsersInGroup(groupId: string): Promise<string[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT user_email FROM user_groups WHERE group_id = $1 ORDER BY user_email`,
    [groupId],
  );
  return (rows as { user_email: string }[]).map((r) => r.user_email);
}

export async function getGroupsForProject(projectId: string): Promise<Group[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT g.* FROM groups g
     JOIN group_projects gp ON gp.group_id = g.id
     WHERE gp.project_id = $1
     ORDER BY g.name`,
    [projectId],
  );
  return (rows as Record<string, unknown>[]).map(rowToGroup);
}

// ── Project-Location access ───────────────────────────────────────────────────

export async function addLocationToProject(projectId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO project_locations (project_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [projectId, locationId],
  );
}

export async function removeLocationFromProject(projectId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM project_locations WHERE project_id = $1 AND location_id = $2', [projectId, locationId]);
}

export async function getLocationsForProject(projectId: string): Promise<DbLocation[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT l.* FROM locations l
     JOIN project_locations pl ON pl.location_id = l.id
     WHERE pl.project_id = $1
     ORDER BY l.name`,
    [projectId],
  );
  return (rows as Record<string, unknown>[]).map(rowToLocation);
}

// ── User-Location assignment ──────────────────────────────────────────────────

export async function addLocationToUser(userEmail: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO user_locations (user_email, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userEmail, locationId],
  );
}

export async function removeLocationFromUser(userEmail: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM user_locations WHERE user_email = $1 AND location_id = $2', [userEmail, locationId]);
}

export async function removeAllLocationsFromUser(userEmail: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM user_locations WHERE user_email = $1', [userEmail]);
}

export async function getLocationsForUser(userEmail: string): Promise<DbLocation[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT l.* FROM locations l
     JOIN user_locations ul ON ul.location_id = l.id
     WHERE ul.user_email = $1
     ORDER BY l.name`,
    [userEmail],
  );
  return (rows as Record<string, unknown>[]).map(rowToLocation);
}

export async function removeAllGroupsFromUser(userEmail: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM user_groups WHERE user_email = $1', [userEmail]);
}

export async function updateGroup(id: string, name: string): Promise<Group | null> {
  const db = getPool();
  const { rows } = await db.query(
    `UPDATE groups SET name = $1 WHERE id = $2 RETURNING *`,
    [name, id],
  );
  if (rows.length === 0) return null;
  return rowToGroup(rows[0] as Record<string, unknown>);
}

export async function listGroupsWithCounts(): Promise<(Group & { memberCount: number; projectCount: number })[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT g.*,
       (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id)::int AS member_count,
       (SELECT COUNT(*) FROM group_projects gp WHERE gp.group_id = g.id)::int AS project_count
     FROM groups g
     ORDER BY g.name`,
  );
  return (rows as Record<string, unknown>[]).map((row) => ({
    ...rowToGroup(row),
    memberCount: row['member_count'] as number,
    projectCount: row['project_count'] as number,
  }));
}

// ── User helpers ──────────────────────────────────────────────────────────────

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as number,
    email: row['email'] as string,
    name: row['name'] as string,
    company: (row['company'] as string | null) ?? undefined,
    passwordHash: row['password_hash'] as string,
    isApproved: row['is_approved'] as boolean,
    isAdmin: row['is_admin'] as boolean,
    reason: (row['reason'] as string | null) ?? undefined,
    requestedAt: (row['requested_at'] as Date).toISOString(),
    approvedAt: row['approved_at'] ? (row['approved_at'] as Date).toISOString() : undefined,
    approvedBy: (row['approved_by'] as string | null) ?? undefined,
    adminNotes: (row['admin_notes'] as string | null) ?? undefined,
  };
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (rows.length === 0) return undefined;
  return rowToUser(rows[0] as Record<string, unknown>);
}

export async function findUserById(id: number): Promise<User | undefined> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return undefined;
  return rowToUser(rows[0] as Record<string, unknown>);
}

export async function getAllUsers(): Promise<User[]> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM users ORDER BY requested_at DESC');
  return (rows as Record<string, unknown>[]).map(rowToUser);
}

export async function getPendingUsers(): Promise<User[]> {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM users WHERE is_approved = false AND is_admin = false ORDER BY requested_at DESC',
  );
  return (rows as Record<string, unknown>[]).map(rowToUser);
}

export async function createUser(params: {
  email: string;
  name: string;
  company?: string;
  passwordHash: string;
  reason?: string;
}): Promise<User> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO users (email, name, company, password_hash, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.email, params.name, params.company ?? null, params.passwordHash, params.reason ?? null],
  );
  return rowToUser(rows[0] as Record<string, unknown>);
}

export async function approveUser(userId: number, adminEmail: string, notes?: string): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE users SET is_approved = true, approved_at = NOW(), approved_by = $1, admin_notes = $2 WHERE id = $3`,
    [adminEmail, notes ?? null, userId],
  );
}

export async function rejectUser(userId: number, adminEmail: string, notes?: string): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE users SET is_approved = false, approved_at = NOW(), approved_by = $1, admin_notes = $2 WHERE id = $3`,
    [adminEmail, notes ?? 'Access request rejected.', userId],
  );
}

export async function revokeUser(userId: number): Promise<void> {
  const db = getPool();
  await db.query('UPDATE users SET is_approved = false WHERE id = $1', [userId]);
}

export async function updatePassword(userId: number, passwordHash: string): Promise<void> {
  const db = getPool();
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function logAccess(entry: Omit<AuditEntry, 'id'>): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO audit_log (user_id, user_email, part_id, part_number, revision, action, accessed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.userId, entry.userEmail, entry.partId, entry.partNumber, entry.revision, entry.action, entry.accessedAt],
  );
}

export async function getAuditLog(limit = 500): Promise<AuditEntry[]> {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM audit_log ORDER BY accessed_at DESC LIMIT $1',
    [limit],
  );
  return (rows as Record<string, unknown>[]).map((row) => ({
    id: row['id'] as number,
    userId: row['user_id'] as number,
    userEmail: row['user_email'] as string,
    partId: row['part_id'] as string,
    partNumber: row['part_number'] as string,
    revision: row['revision'] as string,
    action: row['action'] as AuditEntry['action'],
    accessedAt: (row['accessed_at'] as Date).toISOString(),
  }));
}

// ── Assembly components ───────────────────────────────────────────────────────

export async function getAssemblyComponents(parentId: string): Promise<Array<TechDoc & { quantity: number; referenceDesignator?: string }>> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT d.*, ac.quantity, ac.reference_designator
     FROM tech_docs d
     JOIN assembly_components ac ON ac.child_id = d.id
     WHERE ac.parent_id = $1
     ORDER BY d.name`,
    [parentId],
  );
  return (rows as Record<string, unknown>[]).map((row) => ({
    ...rowToTechDoc(row),
    quantity: row['quantity'] as number,
    referenceDesignator: (row['reference_designator'] as string | null) ?? undefined,
  }));
}

export async function addComponentToAssembly(parentId: string, childId: string, quantity = 1, referenceDesignator?: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO assembly_components (parent_id, child_id, quantity, reference_designator)
     VALUES ($1, $2, $3, $4) ON CONFLICT (parent_id, child_id) DO UPDATE SET quantity = $3, reference_designator = $4`,
    [parentId, childId, quantity, referenceDesignator ?? null],
  );
}

export async function removeComponentFromAssembly(parentId: string, childId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM assembly_components WHERE parent_id = $1 AND child_id = $2', [parentId, childId]);
}

export async function listAssemblies(): Promise<TechDoc[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT DISTINCT d.* FROM tech_docs d
     WHERE EXISTS (SELECT 1 FROM assembly_components ac WHERE ac.parent_id = d.id)
     ORDER BY d.name`,
  );
  return (rows as Record<string, unknown>[]).map(rowToTechDoc);
}

// ── Seed default data ─────────────────────────────────────────────────────────

async function seedDefaultData(): Promise<void> {
  const db = getPool();

  const { rows: gRows } = await db.query('SELECT COUNT(*) as count FROM groups');
  if (parseInt((gRows[0] as { count: string }).count, 10) === 0) {
    await db.query(`
      INSERT INTO groups (name) VALUES
        ('Engineering Team'), ('Quality Assurance'),
        ('Project Alpha'), ('Administrators')
    `);
  }

  const { rows: lRows } = await db.query('SELECT COUNT(*) as count FROM locations');
  if (parseInt((lRows[0] as { count: string }).count, 10) === 0) {
    await db.query(`
      INSERT INTO locations (name) VALUES
        ('Main Factory'), ('R&D Center'), ('Parts Warehouse')
    `);
  }

  const { rows: pRows } = await db.query('SELECT COUNT(*) as count FROM projects');
  if (parseInt((pRows[0] as { count: string }).count, 10) === 0) {
    await db.query(`
      INSERT INTO projects (name, description) VALUES
        ('Vehicle Model 2024', 'Next generation vehicle development project'),
        ('Electric Powertrain', 'Electric vehicle powertrain development'),
        ('Advanced Safety Systems', 'Next-gen safety and driver assistance systems')
    `);
  }

  const { rows: dRows } = await db.query('SELECT COUNT(*) as count FROM tech_docs');
  if (parseInt((dRows[0] as { count: string }).count, 10) === 0) {
    await db.query(`
      INSERT INTO tech_docs (name, revision, description) VALUES
        ('Engine Block', 'v1.2', 'Technical drawing for main engine block assembly'),
        ('Transmission Housing', 'v2.0', 'Housing assembly for automatic transmission'),
        ('Brake Assembly', 'v1.5', 'Complete brake system assembly drawing')
    `);
  }

  const bcrypt = await import('bcryptjs');
  const { config: cfg } = await import('./config');
  const hash = await bcrypt.hash(cfg.adminPassword, 12);
  await db.query(
    `INSERT INTO users (email, name, company, password_hash, is_approved, is_admin)
     VALUES ($1, $2, $3, $4, true, true)
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash,
                   is_approved   = true,
                   is_admin      = true`,
    [cfg.adminEmail, 'Data Owner (Admin)', '3Shape', hash],
  );
  console.log(`[pgDb] Admin user synced: ${cfg.adminEmail}`);
}

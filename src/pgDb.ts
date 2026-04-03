import { Pool } from 'pg';
import { config } from './config';
import type { Drawing, DrawingMetadata, Project, DbLocation, Group } from './types';

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

CREATE TABLE IF NOT EXISTS drawings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  revision    TEXT NOT NULL DEFAULT 'A',
  file_path   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drawing_projects (
  drawing_id  UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (drawing_id, project_id)
);

CREATE TABLE IF NOT EXISTS drawing_locations (
  drawing_id  UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (drawing_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_drawings_metadata        ON drawings USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_drawings_name            ON drawings (name);
CREATE INDEX IF NOT EXISTS idx_drawing_projects_drawing ON drawing_projects (drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawing_projects_project ON drawing_projects (project_id);
`;

export async function initPgDb(): Promise<void> {
  const db = getPool();
  await db.query(SCHEMA_SQL);
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

function rowToDrawing(row: Record<string, unknown>): Drawing {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? undefined,
    revision: row['revision'] as string,
    filePath: (row['file_path'] as string | null) ?? undefined,
    metadata: (row['metadata'] as DrawingMetadata) ?? {},
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

export async function createDrawing(data: {
  name: string;
  description?: string;
  revision?: string;
  metadata?: DrawingMetadata;
}): Promise<Drawing> {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO drawings (name, description, revision, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, data.description ?? null, data.revision ?? 'A', JSON.stringify(data.metadata ?? {})],
  );
  return rowToDrawing(rows[0] as Record<string, unknown>);
}

export async function getDrawing(id: string): Promise<Drawing | null> {
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM drawings WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return rowToDrawing(rows[0] as Record<string, unknown>);
}

export async function listDrawings(filters?: {
  projectId?: string;
  locationId?: string;
  search?: string;
  metadata?: Record<string, unknown>;
}): Promise<Drawing[]> {
  const db = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.projectId) {
    params.push(filters.projectId);
    conditions.push(`d.id IN (SELECT drawing_id FROM drawing_projects WHERE project_id = $${params.length})`);
  }
  if (filters?.locationId) {
    params.push(filters.locationId);
    conditions.push(`d.id IN (SELECT drawing_id FROM drawing_locations WHERE location_id = $${params.length})`);
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
  const { rows } = await db.query(`SELECT d.* FROM drawings d ${where} ORDER BY d.name`, params);
  return (rows as Record<string, unknown>[]).map(rowToDrawing);
}

export async function updateDrawing(id: string, data: Partial<Drawing>): Promise<Drawing | null> {
  const db = getPool();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { params.push(data.name); sets.push(`name = $${params.length}`); }
  if (data.description !== undefined) { params.push(data.description); sets.push(`description = $${params.length}`); }
  if (data.revision !== undefined) { params.push(data.revision); sets.push(`revision = $${params.length}`); }
  if (data.metadata !== undefined) { params.push(JSON.stringify(data.metadata)); sets.push(`metadata = $${params.length}`); }

  if (sets.length === 0) return getDrawing(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE drawings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;
  return rowToDrawing(rows[0] as Record<string, unknown>);
}

export async function deleteDrawing(id: string): Promise<boolean> {
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM drawings WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function setDrawingFilePath(id: string, filePath: string): Promise<void> {
  const db = getPool();
  await db.query('UPDATE drawings SET file_path = $1, updated_at = NOW() WHERE id = $2', [filePath, id]);
}

export async function getDrawingsForUser(userEmail: string): Promise<Drawing[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT DISTINCT d.*
     FROM drawings d
     JOIN drawing_projects dp ON dp.drawing_id = d.id
     JOIN group_projects gp   ON gp.project_id  = dp.project_id
     JOIN user_groups ug      ON ug.group_id    = gp.group_id
     WHERE ug.user_email = $1
     ORDER BY d.name`,
    [userEmail],
  );
  return (rows as Record<string, unknown>[]).map(rowToDrawing);
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

export async function addDrawingToProject(drawingId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO drawing_projects (drawing_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [drawingId, projectId],
  );
}

export async function removeDrawingFromProject(drawingId: string, projectId: string): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM drawing_projects WHERE drawing_id = $1 AND project_id = $2', [drawingId, projectId]);
}

export async function getProjectsForDrawing(drawingId: string): Promise<Project[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT p.* FROM projects p
     JOIN drawing_projects dp ON dp.project_id = p.id
     WHERE dp.drawing_id = $1
     ORDER BY p.name`,
    [drawingId],
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

export async function addDrawingToLocation(drawingId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO drawing_locations (drawing_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [drawingId, locationId],
  );
}

export async function removeDrawingFromLocation(drawingId: string, locationId: string): Promise<void> {
  const db = getPool();
  await db.query(
    'DELETE FROM drawing_locations WHERE drawing_id = $1 AND location_id = $2',
    [drawingId, locationId],
  );
}

export async function getLocationsForDrawing(drawingId: string): Promise<DbLocation[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT l.* FROM locations l
     JOIN drawing_locations dl ON dl.location_id = l.id
     WHERE dl.drawing_id = $1
     ORDER BY l.name`,
    [drawingId],
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

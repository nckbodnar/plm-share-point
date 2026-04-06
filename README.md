# PLM SharePoint

> **On-premise web portal** for managing and sharing engineering parts, assemblies and technical documents. Provides controlled access to PDF specifications, Bill of Materials trees, and revision history — without requiring a PLM editor licence.

---

## Features

| Capability | Details |
|---|---|
| ✅ Technical document (part) management | Create, edit, upload PDF, bump revisions, full history |
| ✅ Assembly BOM management | Create assemblies, add/remove components, pin specific revisions |
| ✅ Interactive BOM visualisation | ReactFlow tree rendered for each assembly |
| ✅ Revision history | Full snapshot history per document; view and inline-preview old revision PDFs |
| ✅ Inline PDF viewer | PDFs served inline in the browser — no forced download |
| ✅ Role-based access control | Users → Groups → Projects → Documents |
| ✅ Admin approval workflow | New users wait for admin approval before they can sign in |
| ✅ Audit log | Every document and assembly view recorded with timestamp and user identity |
| ✅ CSV audit export | Admins can export filtered audit records as CSV |
| ✅ User management | Admins can approve, reject, revoke and assign users to groups/locations |
| ✅ Projects, Locations, Groups | Full CRUD management of organisational structure |
| ✅ Rate limiting | Global 300 req/15 min; auth 20 req/15 min; document 30 req/hour |
| ✅ CSRF protection | Double-submit signed-cookie pattern on all state-changing requests |
| ✅ JWT authentication | HTTP-only cookie; 8-hour expiry; verified against DB on every request |

---

## Architecture

```
plm-share-point/
├── src/
│   ├── server.ts               # Express app entry point; security middleware; route wiring
│   ├── config.ts               # Environment variable mapping with safe defaults
│   ├── types.ts                # Shared TypeScript interfaces (TechDoc, User, Project, …)
│   ├── pgDb.ts                 # All PostgreSQL queries — schema, CRUD, access checks
│   ├── seed.ts                 # Optional seed script (npm run seed)
│   ├── middleware/
│   │   └── auth.ts             # JWT helpers: signToken, requireAuth, requireAdmin, optionalAuth
│   └── routes/
│       ├── auth.ts             # /login  /logout  /request-access
│       ├── parts.ts            # /parts — TechDoc CRUD, PDF upload, revision management
│       ├── assemblies.ts       # /assemblies — assembly CRUD, BOM components, bom.json
│       ├── projects.ts         # /projects — project CRUD, group/location assignment
│       ├── locations.ts        # /locations — location CRUD
│       ├── groups.ts           # /groups — group CRUD, user/project membership
│       └── admin.ts            # /admin/* — dashboard, user management, audit log
├── views/                      # EJS server-rendered templates
│   ├── partials/               # header.ejs / footer.ejs
│   ├── login.ejs
│   ├── request-access.ejs
│   ├── error.ejs
│   ├── parts/
│   │   ├── index.ejs           # Parts list with search + project/location/type filters
│   │   ├── detail.ejs          # Part detail, inline PDF, revision history table
│   │   └── new.ejs             # Create new part form
│   ├── assemblies/
│   │   ├── index.ejs           # Assembly list with search
│   │   ├── detail.ejs          # BOM tree (ReactFlow) + components table
│   │   └── new.ejs             # Create new assembly form
│   ├── projects/               # index / detail / new / edit
│   ├── locations/              # index / new / edit
│   ├── groups/                 # index / detail / new
│   └── admin/
│       ├── dashboard.ejs       # Stats, pending requests, approved users
│       ├── audit.ejs           # Filterable, paginated audit log + CSV export link
│       ├── users.ejs           # User list with group/location assignment
│       └── profile.ejs         # Admin password change
├── public/
│   ├── css/style.css
│   └── js/app.js
├── data/                       # Legacy placeholder (DB is PostgreSQL)
├── docs/
│   └── Aras-Product-Engineering-14-Users-Guide.pdf
├── Dockerfile
├── docker-compose.yml          # App + PostgreSQL 16
└── tests/                      # Jest test suites
```

---

## Database Schema

All data lives in **PostgreSQL**. The schema is created automatically on first startup (`initPgDb()`).

```
users                 — user accounts, approval state, admin flag
audit_log             — every part/assembly/document view event
projects              — named containers for grouping documents
locations             — physical or logical location tags
groups                — named user groups
user_groups           — many-to-many: users ↔ groups (keyed by email)
group_projects        — many-to-many: groups ↔ projects
tech_docs             — parts and assemblies (type = 'part' | 'assembly')
tech_doc_projects     — many-to-many: tech_docs ↔ projects
tech_doc_locations    — many-to-many: tech_docs ↔ locations
project_locations     — many-to-many: projects ↔ locations
user_locations        — many-to-many: users ↔ locations
assembly_components   — parent tech_doc → child tech_doc with qty, ref-des, optional pinned revision
tech_doc_revisions    — historical revision snapshots (file path, notes, author)
```

### Access Control Model

```
User  ──belongs to──▶  Group(s)  ──has access to──▶  Project(s)  ──contains──▶  TechDoc(s)
```

- Regular users see only documents that belong to a project they have access to via their group membership.
- Admin users see all documents regardless of project/group assignment.
- The `getTechDocsForUser(email)` function enforces this by joining through `user_groups → group_projects → tech_doc_projects`.

---

## Application Logic — Module by Module

### `src/server.ts` — Application Bootstrap

1. **Helmet** sets security headers: Content-Security-Policy (CSP allows ReactFlow CDN assets), HSTS, X-Frame-Options, etc.
2. **Global rate limiter** — 300 requests per 15 minutes per IP address.
3. **Body parsers** — `express.urlencoded` and `express.json`.
4. **Cookie parser** — reads the signed `auth_token` cookie.
5. **CSRF protection** — double-submit cookie pattern via `csrf-csrf`:
   - A signed `_csrf` cookie is set on the first GET request.
   - Every `POST`/`PUT`/`DELETE` must include a matching `_csrf` token in the request body, query string or `x-csrf-token` header.
   - CSRF checks are skipped in `development` and `test` environments.
   - The CSRF token is made available to all EJS templates via `res.locals.csrfToken`.
6. **`optionalAuth` middleware** — populates `req.user` from the JWT cookie on every request without rejecting unauthenticated requests; used for showing the correct nav state.
7. **Route mounting** — auth, parts, assemblies, projects, locations, groups, admin.
8. **Legacy redirect** — `/drawings/*` → `/parts/*` (HTTP 301).
9. **404 and error handlers** — render the `error.ejs` template; CSRF failures receive a 403 with a helpful message.
10. **Startup** — calls `initPgDb()` to run the schema migrations and seed the default admin account, then starts listening.

---

### `src/config.ts` — Configuration

Reads environment variables with safe defaults for local development:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Controls CSRF skip and cookie security |
| `JWT_SECRET` | dev string | Signs/verifies JWT tokens |
| `SESSION_SECRET` | dev string | Signs CSRF cookies |
| `ADMIN_EMAIL` | `admin@example.com` | Email for the bootstrapped admin account |
| `ADMIN_PASSWORD` | `ChangeMe123!` | Password for the bootstrapped admin account |
| `DATABASE_URL` | local PG default | PostgreSQL connection string |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded PDF files |
| `SECURE_COOKIES` | `false` | Set to `true` when behind a TLS proxy |

---

### `src/middleware/auth.ts` — Authentication Middleware

- **`signToken(payload)`** — creates a JWT signed with `JWT_SECRET`; expiry 8 hours.
- **`requireAuth`** — extracts the JWT from the `auth_token` cookie (or `Authorization: Bearer` header), verifies it, then calls `findUserById` to confirm the user still exists and is approved. Unapproved or missing users are redirected to `/login` (or returned a 401 JSON response if the client sent `Accept: application/json`).
- **`requireAdmin`** — wraps `requireAuth` and additionally checks `req.user.isAdmin`; returns 403 if not admin.
- **`optionalAuth`** — same as `requireAuth` but never rejects; simply leaves `req.user` undefined if auth fails.

---

### `src/pgDb.ts` — Database Layer

The entire database access layer in one file. Key responsibilities:

#### Schema initialisation (`initPgDb`)
- Runs the full `CREATE TABLE IF NOT EXISTS` script.
- Calls `seedDefaultData()` which upserts the admin account using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from config.

#### User management
| Function | Description |
|---|---|
| `findUserByEmail` | Look up a user by email |
| `findUserById` | Look up a user by numeric ID |
| `createUser` | Insert a new unapproved user (from the access-request form) |
| `getAllUsers` | List all users |
| `getPendingUsers` | List users where `is_approved = false` and `approved_at IS NULL` |
| `approveUser` | Set `is_approved = true`, record approver email and notes |
| `rejectUser` | Set `approved_at` and `admin_notes` without setting `is_approved` |
| `revokeUser` | Set `is_approved = false` |
| `updatePassword` | Update `password_hash` for a given user ID |

#### TechDoc (parts + assemblies) CRUD
| Function | Description |
|---|---|
| `createTechDoc` | Insert a new document record; type = `'part'` or `'assembly'` |
| `getTechDoc` | Fetch a single document by UUID |
| `listTechDocs` | List documents with optional filters: `projectId`, `locationId`, `search`, `type`, `metadata` (JSONB containment) |
| `updateTechDoc` | Update name, number, description, revision, or metadata |
| `deleteTechDoc` | Delete by UUID (cascades to all junction tables) |
| `setTechDocFilePath` | Update the `file_path` after a PDF is uploaded |
| `getTechDocsForUser` | Returns documents the user is allowed to see via group → project membership |

#### Revision history
| Function | Description |
|---|---|
| `createRevisionSnapshot` | Saves current revision label + file path + notes into `tech_doc_revisions` |
| `listRevisions` | Returns all historical revisions for a document, newest first |
| `getRevision` | Fetch a single revision record by UUID |
| `deleteRevision` | Delete a revision record (caller is responsible for deleting the file) |

#### Project / Location / Group CRUD
Standard `create` / `get` / `list` / `update` / `delete` functions for each entity, plus join-table helpers to add/remove relationships between them.

#### Assembly components
| Function | Description |
|---|---|
| `listAssemblies` | Lists all tech_docs with `type = 'assembly'` |
| `getAssemblyComponents` | Joins `assembly_components` with `tech_docs` and `tech_doc_revisions` to return components with `pinnedRevision` label |
| `addComponentToAssembly` | Upserts a row in `assembly_components` (ON CONFLICT updates qty, ref-des, pinned revision) |
| `removeComponentFromAssembly` | Deletes the row by parent + child UUID |

#### Audit log
| Function | Description |
|---|---|
| `logAccess` | Inserts one row into `audit_log` |
| `getAuditLogFiltered` | Paginated query with optional filters: userEmail, partNumber, action, dateFrom, dateTo; sortable |
| `getAuditStats` | Returns aggregate counts for the dashboard analytics widget |

---

### `src/routes/auth.ts` — Authentication Routes

#### `GET /login`
- If already authenticated, redirects to `/parts`.
- Renders the login form with a CSRF token.
- Validates the `next` query parameter against a strict allowlist (`/parts`, `/drawings`, `/admin/*`); defaults to `/parts`.

#### `POST /login` _(rate-limited: 20/15 min)_
1. Validates that email and password are provided.
2. Looks up the user by email.
3. Compares the submitted password with the stored bcrypt hash.
4. If the user is unapproved, returns an appropriate message (pending vs. rejected).
5. On success, calls `signToken` and sets the `auth_token` HTTP-only cookie (8-hour expiry).
6. Redirects to the sanitised `next` destination.

#### `GET /logout`
- Clears the `auth_token` cookie and redirects to `/login`.

#### `GET /request-access`
- Renders the access-request form with a CSRF token.

#### `POST /request-access` _(rate-limited: 20/15 min)_
1. Validates all required fields (email, name, password, reason).
2. Enforces minimum password length (8 characters) and password confirmation match.
3. Rejects duplicate email addresses.
4. Hashes the password with bcrypt (cost factor 12).
5. Creates an unapproved user record in the database.
6. Renders a success confirmation — user must wait for admin approval.

---

### `src/routes/parts.ts` — Parts (TechDoc) Routes

All routes require authentication (`requireAuth`). Write operations additionally require `requireAdmin`.

#### `GET /parts`
- Accepts query parameters: `q` (search text), `project`, `location`, `type`.
- Admins: calls `listTechDocs` with all filters applied at the database level.
- Regular users: calls `getTechDocsForUser` then applies text/type filters in memory.
- Enriches each document with its associated projects via `getProjectsForTechDoc`.
- Renders `parts/index.ejs` with filter state for persistent filter UI.

#### `GET /parts/new` _(admin only)_
- Loads all projects and locations to populate the create form dropdowns.

#### `POST /parts` _(admin only)_
- Creates a new TechDoc record with `type = 'part'`.
- Redirects to the new part's detail page.

#### `GET /parts/:id`
- Loads the TechDoc record plus its assigned projects, locations, and full revision history.
- Renders `parts/detail.ejs` with inline PDF viewer (if a file is attached), admin edit controls, and the revision history table.

#### `PUT /parts/:id` _(admin only)_
- JSON API to update name, number, description, revision, or metadata.

#### `DELETE /parts/:id` / `POST /parts/:id/delete` _(admin only)_
- Deletes the TechDoc. The `POST` form variant redirects to `/parts`.

#### `POST /parts/:id/upload` _(admin only)_
- Accepts a PDF via `multipart/form-data` (field name `pdf`; max 50 MB; PDF only).
- Saves the file to `<UPLOAD_DIR>/parts/<id>.pdf`.
- Stores the relative path in `tech_docs.file_path`.

#### `GET /parts/:id/download` _(rate-limited: 30/hour)_
- Streams the attached PDF inline (`Content-Disposition: inline`).
- Returns 404 if no file is attached or the file is missing from disk.

#### `POST /parts/:id/revisions` _(admin only)_
1. Fetches the current document state.
2. Snapshots the current revision + file path into `tech_doc_revisions` via `createRevisionSnapshot`.
3. Computes the next revision label using `incrementRevision` (A→B, Z→AA, AA→AB, ZZ→AAA, …).
4. If a new PDF was uploaded, moves it to the canonical `<id>.pdf` path.
5. Updates the main `tech_docs` record with the new revision label (and optionally new file path).

#### `GET /parts/:id/revisions/:revId/download` _(rate-limited: 30/hour)_
- Serves a historical revision PDF inline.
- Validates that the revision belongs to the requested part.

#### `DELETE /parts/:id/revisions/:revId` _(admin only)_
- Deletes the revision record.
- If the file path contains `/revisions/` (i.e. it is not the live PDF), the physical file is also deleted.

#### `POST /parts/:id/projects` / `DELETE /parts/:id/projects/:projectId` _(admin only)_
- Add or remove a project assignment for the document.

#### `POST /parts/:id/locations` / `DELETE /parts/:id/locations/:locationId` _(admin only)_
- Add or remove a location assignment for the document.

---

### `src/routes/assemblies.ts` — Assembly Routes

All routes require authentication. Write operations require admin.

#### `GET /assemblies`
- Lists all tech_docs with `type = 'assembly'`; supports `?q=` text search.

#### `GET /assemblies/new` _(admin only)_
- Shows the create-assembly form; loads all existing parts for the component picker.

#### `POST /assemblies` _(admin only)_
- Creates a new TechDoc with `type = 'assembly'`.

#### `GET /assemblies/:id`
- Loads the assembly record and its component list (with pinned revision labels).
- For admin users also loads all documents (with their revision histories) to power the "add component" form.
- Logs a `view_assembly` event to the audit log.
- Renders `assemblies/detail.ejs` with the ReactFlow BOM tree placeholder and the component management table.

#### `GET /assemblies/:id/bom.json`
- Builds and returns the ReactFlow node/edge graph as JSON.
- **Root node** — represents the assembly itself (name + current revision).
- **Component nodes** — one per component; label shows name, pinned or current revision, and a 📌 indicator if the revision is pinned.
- **Edges** — source = root, target = component node; label shows reference designator and quantity (e.g. `SB1 × 2`).

#### `POST /assemblies/:id/components` _(admin only)_
- Adds a part as a component of the assembly with qty, reference designator, and optional pinned revision.

#### `POST /assemblies/:id/components/:childId/pin` _(admin only)_
- Updates the pinned revision for a component (empty = unpin, use current revision).

#### `DELETE /assemblies/:id/components/:childId` / `POST /assemblies/:id/components/:childId/delete` _(admin only)_
- Removes a component from the assembly.

#### `PUT /assemblies/:id` _(admin only)_
- JSON API to update assembly name, number, description, or revision.

---

### `src/routes/projects.ts` — Project Routes

Admin-only except `GET /projects/:id` (any authenticated user can view a project detail to see its documents).

| Route | Description |
|---|---|
| `GET /projects` | List all projects |
| `GET /projects/new` | Create form |
| `POST /projects` | Create a new project |
| `GET /projects/:id` | Project detail: shows assigned groups, locations, and documents |
| `GET /projects/:id/edit` | Edit form |
| `POST /projects/:id` | Update name/description (form submission) |
| `PUT /projects/:id` | Update (JSON API) |
| `DELETE /projects/:id` / `POST /projects/:id/delete` | Delete project |
| `POST /projects/:id/groups` | Assign a group to the project |
| `DELETE /projects/:id/groups/:groupId` | Remove group assignment |
| `POST /projects/:id/locations` | Assign a location to the project |
| `DELETE /projects/:id/locations/:locationId` | Remove location assignment |

---

### `src/routes/locations.ts` — Location Routes

Admin-only CRUD:

| Route | Description |
|---|---|
| `GET /locations` | List all locations |
| `GET /locations/new` | Create form |
| `POST /locations` | Create location |
| `GET /locations/:id/edit` | Edit form |
| `POST /locations/:id` | Update name |
| `PUT /locations/:id` | Update (JSON API) |
| `DELETE /locations/:id` / `POST /locations/:id/delete` | Delete location |

---

### `src/routes/groups.ts` — Group Routes

Admin-only CRUD plus membership management:

| Route | Description |
|---|---|
| `GET /groups` | List all groups with member and project counts |
| `GET /groups/new` | Create form |
| `POST /groups` | Create group |
| `GET /groups/:id` | Group detail: members, assigned projects |
| `PUT /groups/:id` | Update name (JSON API) |
| `DELETE /groups/:id` / `POST /groups/:id/delete` | Delete group |
| `POST /groups/:id/users` | Add a user to the group (by email) |
| `DELETE /groups/:id/users/:email` | Remove user from group |
| `POST /groups/:id/projects` | Assign a project to the group |
| `DELETE /groups/:id/projects/:projectId` | Remove project from group |

---

### `src/routes/admin.ts` — Admin Panel Routes

All routes require `requireAdmin`. An additional rate limiter of 100 req/15 min is applied to the entire admin namespace.

#### `GET /admin/dashboard`
- Loads pending users, all non-admin users, document/project/group counts, and audit statistics.
- Renders the dashboard with quick-action buttons.

#### `POST /admin/users/:id/approve`
- Approves a user (sets `is_approved = true`), records the approving admin's email and optional notes.

#### `POST /admin/users/:id/reject`
- Records rejection notes without setting `is_approved`; the user receives a "not approved" message on their next login attempt.

#### `POST /admin/users/:id/revoke`
- Revokes an approved user (sets `is_approved = false`). Cannot be used on admin accounts.

#### `GET /admin/users`
- Lists all non-admin users enriched with their primary group and location assignment.

#### `POST /admin/users/:id/assign`
- Replaces a user's group and location assignments in a single operation.

#### `GET /admin/audit`
- Paginated (50 rows/page) and filterable audit log: filter by user email, part number, action type, and date range; sortable by any column.

#### `GET /admin/audit/export.csv`
- Exports the current filter result set (up to 10,000 rows) as a CSV file download.

#### `GET /admin/analytics.json`
- Returns aggregate audit statistics as JSON (used by the dashboard's live-refresh widget).

#### `GET /admin/profile` / `POST /admin/profile`
- Allows the logged-in admin to change their own password (verifies current password, enforces min 8 chars, confirms match).

---

## Complete Route Reference

### Public / Unauthenticated

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirect to `/parts` (authenticated) or `/login` |
| `GET` | `/login` | Sign-in form |
| `POST` | `/login` | Authenticate; sets `auth_token` cookie |
| `GET` | `/logout` | Clear cookie, redirect to `/login` |
| `GET` | `/request-access` | Access-request form |
| `POST` | `/request-access` | Submit access request |

### Parts (authenticated users)

| Method | Path | Description |
|---|---|---|
| `GET` | `/parts` | List documents (`?q=`, `?project=`, `?location=`, `?type=`) |
| `GET` | `/parts/new` | Create form _(admin)_ |
| `POST` | `/parts` | Create document _(admin)_ |
| `GET` | `/parts/:id` | Document detail + inline PDF + revision history |
| `PUT` | `/parts/:id` | Update metadata _(admin, JSON)_ |
| `DELETE` | `/parts/:id` | Delete document _(admin, JSON)_ |
| `POST` | `/parts/:id/delete` | Delete document _(admin, form)_ |
| `POST` | `/parts/:id/upload` | Upload PDF _(admin)_ |
| `GET` | `/parts/:id/download` | Stream PDF inline |
| `POST` | `/parts/:id/revisions` | Bump to next revision _(admin)_ |
| `GET` | `/parts/:id/revisions/:revId/download` | Stream historical revision PDF inline |
| `DELETE` | `/parts/:id/revisions/:revId` | Delete historical revision _(admin)_ |
| `POST` | `/parts/:id/projects` | Assign project _(admin)_ |
| `DELETE` | `/parts/:id/projects/:projectId` | Remove project assignment _(admin)_ |
| `POST` | `/parts/:id/locations` | Assign location _(admin)_ |
| `DELETE` | `/parts/:id/locations/:locationId` | Remove location assignment _(admin)_ |

### Assemblies (authenticated users)

| Method | Path | Description |
|---|---|---|
| `GET` | `/assemblies` | List assemblies (`?q=`) |
| `GET` | `/assemblies/new` | Create form _(admin)_ |
| `POST` | `/assemblies` | Create assembly _(admin)_ |
| `GET` | `/assemblies/:id` | Assembly detail + BOM tree |
| `GET` | `/assemblies/:id/bom.json` | ReactFlow JSON (`nodes` + `edges`) |
| `PUT` | `/assemblies/:id` | Update assembly _(admin, JSON)_ |
| `POST` | `/assemblies/:id/components` | Add component _(admin)_ |
| `POST` | `/assemblies/:id/components/:childId/pin` | Update pinned revision _(admin)_ |
| `DELETE` | `/assemblies/:id/components/:childId` | Remove component _(admin, JSON)_ |
| `POST` | `/assemblies/:id/components/:childId/delete` | Remove component _(admin, form)_ |

### Projects, Locations, Groups (admin)

| Method | Path |
|---|---|
| `GET/POST` | `/projects`, `/projects/new`, `/projects/:id`, `/projects/:id/edit` |
| `POST/PUT/DELETE` | `/projects/:id`, `/projects/:id/delete`, `/projects/:id/groups`, `/projects/:id/locations` |
| `GET/POST` | `/locations`, `/locations/new`, `/locations/:id/edit` |
| `POST/PUT/DELETE` | `/locations/:id`, `/locations/:id/delete` |
| `GET/POST` | `/groups`, `/groups/new`, `/groups/:id` |
| `PUT/DELETE` | `/groups/:id`, `/groups/:id/delete`, `/groups/:id/users`, `/groups/:id/projects` |

### Admin Panel (admin)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/dashboard` | Overview dashboard |
| `GET` | `/admin/users` | User management table |
| `POST` | `/admin/users/:id/approve` | Approve user |
| `POST` | `/admin/users/:id/reject` | Reject user |
| `POST` | `/admin/users/:id/revoke` | Revoke user access |
| `POST` | `/admin/users/:id/assign` | Assign group / location |
| `GET` | `/admin/audit` | Filterable audit log |
| `GET` | `/admin/audit/export.csv` | CSV export |
| `GET` | `/admin/analytics.json` | Live analytics JSON |
| `GET/POST` | `/admin/profile` | Change admin password |

### Legacy

| Method | Path | Description |
|---|---|---|
| `GET` | `/drawings/*` | 301 redirect → `/parts/*` |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- PostgreSQL ≥ 14 (or use Docker Compose)

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SESSION_SECRET=<long random string>
JWT_SECRET=<long random string>
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=<strong password>
DATABASE_URL=postgresql://user:password@localhost:5432/plm_sharepoint
UPLOAD_DIR=./uploads
```

### 3 — Start PostgreSQL

```bash
# Option A: Docker Compose (starts both Postgres and the app)
docker-compose up

# Option B: local Postgres
createdb plm_sharepoint
```

### 4 — Build and start

```bash
npm run build   # TypeScript → JavaScript (dist/)
npm start       # production

# or for development (ts-node, no build step):
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first startup the schema is created and the admin account is bootstrapped:

| Field    | Value                              |
|----------|------------------------------------|
| Email    | value of `ADMIN_EMAIL` in `.env`   |
| Password | value of `ADMIN_PASSWORD` in `.env` (default: `ChangeMe123!`) |

**Change the admin password immediately** via `/admin/profile`.

### 5 — (Optional) Seed sample data

```bash
npm run seed
```

Populates the database with sample projects, locations, groups, and documents.

---

## Security Measures

- **JWT in HTTP-only cookies** — 8-hour expiry; tokens cannot be read by JavaScript.
- **bcrypt password hashing** — cost factor 12.
- **Double-submit CSRF protection** — every state-changing request must include a signed CSRF token.
- **Redirect allowlist** — post-login `next` parameter is validated against a hard-coded allowlist; arbitrary open-redirect is impossible.
- **Rate limiting** — global 300/15 min; auth endpoints 20/15 min; document downloads 30/hour per IP.
- **Inline document serving** — `Content-Disposition: inline` prevents forced downloads; no direct download links exposed to non-admin users.
- **Audit log** — every document view and assembly view recorded with timestamp and user identity.
- **Helmet** — Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
- **Access control** — regular users can only see documents that belong to projects their group has access to.
- **Admin operations only** — document creation, deletion, revision management, and user management require admin rights.

---

## Running Tests

```bash
npm test
```

Tests use an in-memory/test database and do not require a live PostgreSQL instance.

---

## Deployment

### Docker Compose (recommended)

```bash
docker-compose up --build
```

- Starts PostgreSQL 16 and the Node.js application.
- Application available on port 3000.
- PDF uploads persisted in the `uploads` Docker volume.
- Database persisted in the `pgdata` Docker volume.

Update `SESSION_SECRET`, `JWT_SECRET`, and `ADMIN_PASSWORD` in `docker-compose.yml` before deploying to production.

### Manual / systemd

```bash
npm run build
NODE_ENV=production node dist/server.js
```

Run as a non-root service user. Suggested systemd unit:

```ini
[Service]
User=plm
WorkingDirectory=/opt/plm-share-point
EnvironmentFile=/opt/plm-share-point/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
```

Use **nginx** or **IIS ARR** as a TLS-terminating reverse proxy in front of port 3000. Set `SECURE_COOKIES=true` and `NODE_ENV=production` when behind a TLS proxy.

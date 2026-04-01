# PLM SharePoint

> **On-premise read-only web portal** that lets approved employees view
> Released part specifications and assembly Bills of Materials from Aras PLM —
> without requiring a PLM "editor" licence.

---

## Features

| Requirement | Implementation |
|---|---|
| ✅ View Released part specifications without a PLM user account | Web portal with its own user accounts |
| ✅ Restricted access controlled by data owner (explicit approval) | Admin approval workflow |
| ✅ Only Released data is shared | PLM service filters by `lifecycleState = Released` |
| ✅ Latest released revision shown | `latestRevision` displayed prominently |
| ✅ Previous released revision shown | `previousRevision` on both part and assembly detail pages |
| ✅ Assembly BOM visualization | Interactive ReactFlow tree for every assembly; click a part node to jump to its spec |
| ✅ Revision switcher on assembly BOM | Toggle between current and previous assembly revision to compare component lists |
| ✅ Inline PDF viewer for every part | Each part revision renders its specification PDF directly in the browser (no download) |
| ✅ No bulk download / harvest feature | No "download all" endpoint; individual inline viewer only; rate limiting |
| ✅ Lifecycle state visible to end user | `lifecycleState` badge on every card and detail page |
| ✅ Read-only (no PLM editing) | All routes are GET / inline-view only; no write-back to PLM |
| ✅ Leverages existing PLM REST API | Configurable HTTP client; mock mode for development |

---

## Architecture

```
plm-share-point/
├── src/
│   ├── server.ts               # Express application entry point
│   ├── config.ts               # Environment-based configuration
│   ├── types.ts                # Shared TypeScript interfaces (Part, Assembly, …)
│   ├── db.ts                   # SQLite user/access/audit layer (better-sqlite3)
│   ├── middleware/
│   │   └── auth.ts             # JWT authentication middleware
│   ├── routes/
│   │   ├── auth.ts             # /login  /logout  /request-access
│   │   ├── parts.ts            # /parts  /parts/:id  /parts/:id/documents/:docId
│   │   ├── assemblies.ts       # /assemblies  /assemblies/:id  /assemblies/:id/bom.json
│   │   └── admin.ts            # /admin/*  (admin-only)
│   └── services/
│       └── plmService.ts       # PLM adapters (Aras, Generic REST, Mock) + buildMockPdf
├── views/                      # EJS templates
│   ├── partials/               # header.ejs / footer.ejs
│   ├── login.ejs
│   ├── request-access.ejs
│   ├── error.ejs
│   ├── parts/
│   │   ├── index.ejs           # Parts list with search
│   │   └── detail.ejs          # Part detail + inline PDF viewer (latest & previous revision)
│   ├── assemblies/
│   │   ├── index.ejs           # Assembly list with search
│   │   └── detail.ejs          # BOM tree (ReactFlow) + components table + revision switcher
│   └── admin/
│       ├── dashboard.ejs       # Pending requests + approved users
│       ├── audit.ejs           # Access audit log
│       └── profile.ejs         # Admin password change
├── public/
│   ├── css/style.css
│   └── js/app.js
├── data/                       # SQLite DB created here at runtime
├── docs/
│   └── Aras-Product-Engineering-14-Users-Guide.pdf
└── tests/                      # Jest test suites (91 tests)
```

---

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirects to `/parts` |
| `GET` | `/login` | Sign-in form |
| `POST` | `/login` | Authenticate |
| `GET` | `/logout` | Clear cookie and redirect |
| `GET` | `/request-access` | New-user request form |
| `POST` | `/request-access` | Submit access request |
| `GET` | `/parts` | List all Released parts (search supported via `?q=`) |
| `GET` | `/parts/:id` | Part detail — latest & previous revision with inline PDF viewer |
| `GET` | `/parts/:id/documents/:docId` | Stream specification PDF inline |
| `GET` | `/assemblies` | List all Released assemblies (search supported via `?q=`) |
| `GET` | `/assemblies/:id` | Assembly detail — BOM tree, components table, revision switcher |
| `GET` | `/assemblies/:id/bom.json` | ReactFlow JSON payload (`nodes` + `edges`); `?rev=` selects a previous revision |
| `GET` | `/admin/dashboard` | Pending & approved users (admin only) |
| `POST` | `/admin/users/:id/approve` | Approve a pending user (admin only) |
| `POST` | `/admin/users/:id/revoke` | Revoke an approved user (admin only) |
| `GET` | `/admin/audit` | Access audit log (admin only) |
| `GET` | `/admin/profile` | Admin password-change form (admin only) |
| `POST` | `/admin/profile` | Save new admin password (admin only) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
# Edit .env:
#   SESSION_SECRET and JWT_SECRET   → long random strings
#   ADMIN_EMAIL                     → data owner's email address
#   PLM_TYPE                        → mock | aras | generic
#   PLM_BASE_URL                    → Aras instance URL or generic REST base URL
#   PLM_USERNAME / PLM_PASSWORD     → PLM credentials
```

### 3 — Build (TypeScript → JavaScript)

```bash
npm run build
```

### 4 — Start the server

```bash
npm start          # production (uses dist/)
# or
npm run dev        # development with ts-node (hot-reload friendly)
```

Open [http://localhost:3000](http://localhost:3000).

The first time the server starts it creates a default admin account:

| Field    | Value                              |
|----------|------------------------------------|
| Email    | value of `ADMIN_EMAIL` in `.env`   |
| Password | `ChangeMe123!`                     |

**Change the admin password immediately** via `/admin/profile`.

---

## PLM Integration

### Mock mode (default for development)

Set `PLM_TYPE=mock` in `.env` (or the legacy `PLM_USE_MOCK=true`).  The
application uses built-in sample data with no live PLM server required:

**Parts (7 released parts, all with inline PDF specs):**

| Part Number | Name | Latest Rev | Previous Rev |
|---|---|---|---|
| PN-10001 | Titanium Scanning Body – Standard | C | B |
| PN-10002 | Zirconia Crown Blank – HT 98mm | B | A |
| PN-10003 | IOS Scanner Calibration Block | A | — |
| PN-10004 | Abutment Screw – Hex 1.2mm | D | C |
| PN-10005 | Impression Coping – Open Tray | A | — |
| PN-10006 | Healing Abutment – Regular Platform | B | A |
| PN-10007 | PEEK Temporary Crown – Universal | C | B |

**Assemblies (3 released assemblies, all with previous revisions for testing the revision switcher):**

| Assembly Number | Name | Latest Rev | Previous Rev | Components (latest) |
|---|---|---|---|---|
| ASM-20001 | Standard Implant Kit | B | A | 4 |
| ASM-20002 | Zirconia Restoration Set | B | A | 3 |
| ASM-20003 | Full Arch Immediate Loading Kit | C | B | 5 |

In mock mode, every part's specification document is returned as a valid PDF
rendered inline in the browser.

### Aras Innovator PLM (recommended for production)

Set `PLM_TYPE=aras` and configure the instance URL and credentials:

```
PLM_TYPE=aras
PLM_BASE_URL=http://localhost/UA-LPT-MYBO-Aras3Shape-development
# PLM_ARAS_DATABASE is optional – defaults to the last URL path segment
PLM_USERNAME=admin
PLM_PASSWORD=<your-aras-password>
```

The `ArasPlmService` uses:
* **SOAP/AML** (`POST {baseUrl}/Server/InnovatorServer.aspx`) for part queries.
  The password is hashed with MD5 (upper-case hex) as required by all Aras
  Innovator versions.
* **Aras REST file endpoint** (`GET {baseUrl}/api/v1/File/{id}/content`) for
  document downloads with HTTP Basic auth (username:MD5(password)).

Parts are queried with `<state>Released</state>` filter over the `Part`
ItemType.  Adjust `parseArasPartList()` in `src/services/plmService.ts` if your
Aras instance uses custom ItemType names or a different state vocabulary.

### Generic REST PLM

Set `PLM_TYPE=generic` for any PLM exposing a standard REST API:

```
PLM_TYPE=generic
PLM_BASE_URL=http://your-plm-server/api
PLM_API_KEY=<read-only api key>     # preferred
# or
PLM_USERNAME=<readonly user>
PLM_PASSWORD=<password>
```

The `RealPlmService` expects:

| Endpoint | Purpose |
|---|---|
| `GET /parts?lifecycleState=Released` | List released parts |
| `GET /parts/:id` | Single part |
| `GET /documents/:docId/content` | File bytes |

Adapt `mapApiPart()` / `mapApiRevision()` in `src/services/plmService.ts` if
your PLM uses different field names.

---

## Assembly BOM Visualization

Each assembly detail page (`/assemblies/:id`) renders an interactive Bill of
Materials tree powered by **[ReactFlow](https://reactflow.dev/)**:

- The **root node** (blue) represents the assembly with its number, name and
  current revision.
- Each **child node** represents a component part.  Clicking a part node
  navigates to its specification page.
- Edge labels show the reference designator and quantity (e.g. `SB1 × 1`).
- The **revision switcher** at the top of the page lets you toggle between the
  current and previous assembly revision to compare which parts changed.
- The **components table** below the graph lists all parts with part number,
  revision, quantity and a direct link to the part's PDF specification.

The ReactFlow graph data is served as JSON at `/assemblies/:id/bom.json`
(optional `?rev=<revision>` query parameter to request a previous revision).

---

## Access Control Flow

```
Visitor → /request-access → fills form → account created (unapproved)
                                           ↓
                                   Admin receives pending notification
                                           ↓
                              Admin → /admin/dashboard → Approve / Reject
                                           ↓
                              User can now sign in at /login
                                           ↓
                          User views Released parts and assemblies (read-only)
                                           ↓
                              All views recorded in audit log
```

An admin can **revoke** access at any time from the dashboard.

---

## Security Measures

- **JWT in HTTP-only cookies** — tokens cannot be read by JavaScript.
- **bcrypt password hashing** (cost factor 12).
- **Rate limiting** — 100 page views / 15 min; 30 document views / hour per IP.
- **Inline document serving** — `Content-Disposition: inline` prevents forced
  downloads; no direct file download links exposed to the browser.
- **Audit log** — every part view, document view and assembly view is recorded
  with timestamp and user identity.
- **No bulk export** — no `/parts/export`, no "download all" endpoint.
- **Helmet** security headers (CSP, HSTS, X-Frame-Options, etc.).
- **Released-only filter** — the PLM service rejects any non-Released item
  before it reaches the user.

---

## Running Tests

```bash
npm test
```

91 tests across three suites; use an in-memory SQLite database and the
`MockPlmService` — no external services required.

| Suite | Coverage |
|---|---|
| `tests/plmService.test.ts` | `MockPlmService`, PDF format, `ArasPlmService` config, `parseArasPartList`, `findAllFileItems`, factory |
| `tests/server.test.ts` | All HTTP routes (parts, assemblies, admin, auth) including BOM JSON endpoint and revision switching |
| `tests/db.test.ts` | SQLite user/audit helpers |

---

## On-Premise Deployment

The application is a standard Node.js process.  Suggested options:

| Option | Notes |
|---|---|
| **systemd service** | Simplest; run `node dist/server.js` as a service user |
| **Docker container** | `EXPOSE 3000`; mount `./data` as a volume |
| **IIS ARR / nginx reverse proxy** | Proxy `localhost:3000`; terminate TLS at the proxy |

Set `NODE_ENV=production` in production and use a reverse proxy for TLS.
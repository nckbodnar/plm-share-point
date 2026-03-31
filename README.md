# PLM SharePoint

> **On-premise read-only web portal** that lets approved 3Shape employees view
> Released part specifications from Aas PLM — without requiring a PLM "editor"
> licence.

---

## Features

| Requirement | Implementation |
|---|---|
| ✅ Access to Released part specifications without a PLM user account | Web portal with own user accounts |
| ✅ Restricted access controlled by data owner (explicit approval) | Admin approval workflow |
| ✅ Only Released data is shared | PLM service filters by `lifecycleState = Released` |
| ✅ Latest released revision shown | `latestRevision` displayed prominently |
| ✅ Previous released revision shown | `previousRevision` section on part detail page |
| ✅ No bulk download / harvest feature | No "download all" endpoint; individual inline viewer only; rate limiting |
| ✅ Lifecycle state visible to end user | `lifecycleState` badge on every part card and detail page |
| ✅ Read-only (no PLM editing) | All routes are GET/inline-view only; no write-back to PLM |
| ✅ Leverages existing PLM REST API | Configurable HTTP client; mock mode for development |

---

## Architecture

```
plm-share-point/
├── src/
│   ├── server.ts           # Express application entry point
│   ├── config.ts           # Environment-based configuration
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── db.ts               # SQLite user/access/audit layer (better-sqlite3)
│   ├── middleware/
│   │   └── auth.ts         # JWT authentication middleware
│   ├── routes/
│   │   ├── auth.ts         # /login  /logout  /request-access
│   │   ├── parts.ts        # /parts  /parts/:id  /parts/:id/documents/:docId
│   │   └── admin.ts        # /admin/*  (admin-only)
│   └── services/
│       └── plmService.ts   # PLM REST API integration + MockPlmService
├── views/                  # EJS templates
│   ├── partials/           # header.ejs / footer.ejs
│   ├── login.ejs
│   ├── request-access.ejs
│   ├── error.ejs
│   ├── parts/
│   │   ├── index.ejs       # Parts list with search
│   │   └── detail.ejs      # Part detail + inline document viewer
│   └── admin/
│       ├── dashboard.ejs   # Pending requests + approved users
│       ├── audit.ejs       # Access audit log
│       └── profile.ejs     # Admin password change
├── public/
│   ├── css/style.css
│   └── js/app.js
├── data/                   # SQLite DB created here at runtime
└── tests/                  # Jest test suites
```

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
#   PLM_BASE_URL                    → http://your-plm-server/api
#   PLM_USE_MOCK=false              → once you have a real PLM server
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

Set `PLM_USE_MOCK=true` in `.env`.  The application uses built-in sample data
(5 released parts with realistic revisions).

### Real PLM server

Set `PLM_USE_MOCK=false` and configure:

```
PLM_BASE_URL=http://your-plm-server/api
PLM_API_KEY=<read-only api key>     # preferred
# or
PLM_USERNAME=<readonly user>
PLM_PASSWORD=<password>
```

The `RealPlmService` expects the PLM to expose:

| Endpoint | Purpose |
|---|---|
| `GET /parts?lifecycleState=Released` | List released parts |
| `GET /parts/:id` | Single part |
| `GET /documents/:docId/content` | File bytes |

Adapt `mapApiPart()` / `mapApiRevision()` in `src/services/plmService.ts` if
your PLM uses different field names.

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
                              User views Released parts (read-only)
                                           ↓
                              All views recorded in audit log
```

An admin can **revoke** access at any time from the dashboard.

---

## Security Measures

- **JWT in HTTP-only cookies** — tokens cannot be read by JavaScript.
- **bcrypt password hashing** (cost factor 12).
- **Rate limiting** — 100 part views / 15 min; 30 document views / hour per IP.
- **Inline document serving** — `Content-Disposition: inline` prevents forced
  downloads; no direct file download links exposed to the browser.
- **Audit log** — every part view and document view is recorded with timestamp
  and user identity.
- **No bulk export** — no `/parts/export`, no "download all" endpoint.
- **Helmet** security headers (CSP, HSTS, X-Frame-Options, etc.).
- **Released-only filter** — the PLM service rejects any non-Released part before
  it reaches the user.

---

## Running Tests

```bash
npm test
```

Tests use an in-memory SQLite database and the `MockPlmService`; no external
services are required.

---

## On-Premise Deployment

The application is a standard Node.js process.  Suggested options:

| Option | Notes |
|---|---|
| **systemd service** | Simplest; run `node dist/server.js` as a service user |
| **Docker container** | `EXPOSE 3000`; mount `./data` as a volume |
| **IIS ARR / nginx reverse proxy** | Proxy `localhost:3000`; terminate TLS at the proxy |

Set `NODE_ENV=production` in production and use a reverse proxy for TLS.
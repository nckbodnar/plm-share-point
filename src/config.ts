import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Environment variable "${name}" is required but not set. See .env.example.`);
  }
  return val;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  /** Secret used to sign JWT tokens – must be changed in production */
  jwtSecret: optional('JWT_SECRET', 'dev-jwt-secret-change-in-production'),

  /** Secret used to sign express-session cookies */
  sessionSecret: optional('SESSION_SECRET', 'dev-session-secret-change-in-production'),

  /** Email address of the initial admin / data-owner account */
  adminEmail: optional('ADMIN_EMAIL', 'admin@example.com'),

  /** SQLite database file path */
  dbPath: optional('DB_PATH', path.join(process.cwd(), 'data', 'plm-sharepoint.db')),

  /** PostgreSQL connection URL */
  databaseUrl: optional('DATABASE_URL', 'postgresql://plm_user:plm_password@localhost:5432/plm_sharepoint'),
  /** Directory for uploaded PDF files */
  uploadDir: optional('UPLOAD_DIR', './uploads'),

  plm: {
    /**
     * Which PLM adapter to use.
     *   'mock'    – built-in static data, no real server needed (default)
     *   'aras'    – Aras Innovator PLM via SOAP/AML
     *   'generic' – generic REST API (RealPlmService)
     *
     * When PLM_TYPE is not set the legacy PLM_USE_MOCK flag is honoured instead.
     */
    type: optional('PLM_TYPE', '') as 'mock' | 'aras' | 'generic' | '',

    /** Base URL of the PLM server.
     *  For Aras: the Innovator instance root, e.g. http://localhost/UA-LPT-MYBO-Aras3Shape-development
     *  For generic REST: the REST API base, e.g. http://your-plm-server/api
     */
    baseUrl: optional('PLM_BASE_URL', 'http://localhost:8080/api'),

    /**
     * Aras database / instance name.
     * If not set, defaults to the last non-empty path segment of PLM_BASE_URL.
     * Example: UA-LPT-MYBO-Aras3Shape-development
     */
    arasDatabase: optional('PLM_ARAS_DATABASE', ''),

    /** Optional API key sent as a Bearer token (generic adapter only) */
    apiKey: process.env['PLM_API_KEY'],

    /** PLM username (Aras login name or generic basic-auth user) */
    username: process.env['PLM_USERNAME'],

    /** PLM password (plain-text; the Aras adapter hashes it with MD5 before sending) */
    password: process.env['PLM_PASSWORD'],

    /** Request timeout in milliseconds */
    timeoutMs: parseInt(optional('PLM_TIMEOUT_MS', '10000'), 10),

    /** @deprecated Use PLM_TYPE=mock instead. Kept for backward compatibility. */
    useMock: optional('PLM_USE_MOCK', 'true').toLowerCase() === 'true',
  },
} as const;

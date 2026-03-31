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

  plm: {
    /** Base URL of the PLM REST API */
    baseUrl: optional('PLM_BASE_URL', 'http://localhost:8080/api'),
    /** Optional API key sent as a Bearer token */
    apiKey: process.env['PLM_API_KEY'],
    /** Optional basic-auth credentials */
    username: process.env['PLM_USERNAME'],
    password: process.env['PLM_PASSWORD'],
    /** Request timeout in milliseconds */
    timeoutMs: parseInt(optional('PLM_TIMEOUT_MS', '10000'), 10),
    /** When true, use mock PLM data (no real PLM server needed) */
    useMock: optional('PLM_USE_MOCK', 'true').toLowerCase() === 'true',
  },
} as const;

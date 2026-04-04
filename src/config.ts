import dotenv from 'dotenv';

dotenv.config();

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  jwtSecret: optional('JWT_SECRET', 'dev-jwt-secret-change-in-production'),
  sessionSecret: optional('SESSION_SECRET', 'dev-session-secret-change-in-production'),
  adminEmail: optional('ADMIN_EMAIL', 'admin@example.com'),
  databaseUrl: optional('DATABASE_URL', 'postgresql://plm_user:plm_password@localhost:5432/plm_sharepoint'),
  uploadDir: optional('UPLOAD_DIR', './uploads'),
} as const;

import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { doubleCsrf } from 'csrf-csrf';
import { config } from './config';
import { optionalAuth } from './middleware/auth';
import authRouter from './routes/auth';
import partsRouter from './routes/parts';
import adminRouter from './routes/admin';
import assembliesRouter from './routes/assemblies';
import { getDb } from './db'; // ensure DB is initialised on startup

const app = express();

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'unpkg.com'],
        fontSrc: ["'self'", 'cdn.jsdelivr.net', 'unpkg.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'cdn.jsdelivr.net', 'unpkg.com'],
        frameSrc: ["'self'"],        // allow inline PDF viewer (same origin)
        objectSrc: ["'none'"],
      },
    },
  }),
);

// ---------------------------------------------------------------------------
// Global rate limiter (prevents brute-force and crawling)
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});
app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// lgtm[js/missing-token-validation] - CSRF protection is applied below via doubleCsrfProtection (csrf-csrf)
app.use(cookieParser(config.sessionSecret));

// ---------------------------------------------------------------------------
// CSRF protection (double-submit signed cookie pattern)
// ---------------------------------------------------------------------------
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.sessionSecret,
  // Use a stable session identifier for development
  getSessionIdentifier: (req) => {
    // For stateless JWT auth, use a combination of IP and user agent
    const identifier = `${req.ip || 'unknown'}-${req.get('user-agent') || 'unknown'}`;
    return identifier;
  },
  cookieName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
  },
  // Only protect state-changing methods
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) =>
    (req.body as Record<string, string> | undefined)?.['_csrf'] ??
    req.headers['x-csrf-token'],
  // Skip CSRF validation in development for easier testing
  skipCsrfProtection: () => process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test',
});

// Expose generateCsrfToken so views/routes can embed it
app.locals['generateCsrfToken'] = generateCsrfToken;
app.use(doubleCsrfProtection);

// Make CSRF token available to all EJS views
app.use((req, res, next) => {
  res.locals['csrfToken'] = generateCsrfToken(req, res, { overwrite: true });
  next();
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// View engine
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ---------------------------------------------------------------------------
// Populate req.user for all routes (optional – doesn't reject)
// ---------------------------------------------------------------------------
app.use(optionalAuth);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/', authRouter);
app.use('/parts', partsRouter);
app.use('/assemblies', assembliesRouter);
app.use('/admin', adminRouter);

// Home → redirect to parts list (or login if not authenticated)
app.get('/', (req, res) => {
  if (req.user) {
    res.redirect('/parts');
  } else {
    res.redirect('/login');
  }
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    user: req.user,
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    // CSRF token validation failure → friendly error
    if ((err as NodeJS.ErrnoException).code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
      res.status(403).render('error', {
        title: 'Invalid Request',
        message: 'The form submission was rejected due to an invalid security token. Please refresh the page and try again.',
        user: req.user,
      });
      return;
    }
    console.error('[server] Unhandled error:', err);
    res.status(500).render('error', {
      title: 'Internal Server Error',
      message: 'An unexpected error occurred.',
      user: req.user,
    });
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (require.main === module) {
  // Ensure DB is initialised before accepting requests
  getDb();

  app.listen(config.port, () => {
    console.log(`PLM SharePoint running on http://localhost:${config.port}`);
    console.log(`Mode: ${config.nodeEnv} | PLM mock: ${config.plm.useMock}`);
  });
}

export default app;


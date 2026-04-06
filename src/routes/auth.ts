import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { findUserByEmail, createUser } from '../pgDb';
import { signToken } from '../middleware/auth';
import { config } from '../config';

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiting for authentication endpoints
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                    // at most 20 auth attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

/** Validate and resolve a post-login redirect target to a fixed safe destination. */
function sanitizeRedirect(value: unknown): string {
  // Use a strict allowlist to completely break taint flow from user-supplied input.
  // Any path not in the allowlist falls back to the default.
  const ALLOWED: ReadonlySet<string> = new Set([
    '/parts',
    '/drawings',
    '/admin/dashboard',
    '/admin/audit',
    '/admin/profile',
  ]);
  if (typeof value === 'string' && ALLOWED.has(value)) {
    return value;
  }
  return '/parts';
}

// ---------------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.user) {
    res.redirect('/parts');
    return;
  }
  const next = sanitizeRedirect(req.query['next']);
  res.render('login', { 
    title: 'Sign In', 
    error: null, 
    next, 
    user: null,
    csrfToken: res.locals['csrfToken']
  });
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
  const { email, password, next } = req.body as {
    email?: string;
    password?: string;
    next?: string;
  };

  const redirectTo = sanitizeRedirect(next);

  if (!email || !password) {
    res.render('login', {
      title: 'Sign In',
      error: 'Please provide your email and password.',
      next: redirectTo,
      user: null,
      csrfToken: res.locals['csrfToken']
    });
    return;
  }

  const user = await findUserByEmail(email.trim());

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.render('login', {
      title: 'Sign In',
      error: 'Invalid email or password.',
      next: redirectTo,
      user: null,
      csrfToken: res.locals['csrfToken']
    });
    return;
  }

  if (!user.isApproved) {
    res.render('login', {
      title: 'Sign In',
      error:
        user.adminNotes && !user.isApproved && user.approvedAt
          ? 'Your access request was not approved. Please contact the data owner.'
          : 'Your access request is pending approval. You will be notified once it has been reviewed.',
      next: redirectTo,
      user: null,
      csrfToken: res.locals['csrfToken']
    });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });

  res.redirect(redirectTo);
});

// ---------------------------------------------------------------------------
// GET /logout
// ---------------------------------------------------------------------------
router.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login');
});

// ---------------------------------------------------------------------------
// GET /request-access
// ---------------------------------------------------------------------------
router.get('/request-access', (req, res) => {
  if (req.user) {
    res.redirect('/parts');
    return;
  }
  res.render('request-access', { 
    title: 'Request Access', 
    error: null, 
    success: false, 
    user: null,
    csrfToken: res.locals['csrfToken']
  });
});

// ---------------------------------------------------------------------------
// POST /request-access
// ---------------------------------------------------------------------------
router.post('/request-access', authLimiter, async (req, res) => {
  const { email, name, company, reason, password, passwordConfirm } = req.body as {
    email?: string;
    name?: string;
    company?: string;
    reason?: string;
    password?: string;
    passwordConfirm?: string;
  };

  const renderError = (error: string): void => {
    res.render('request-access', {
      title: 'Request Access',
      error,
      success: false,
      user: null,
      prefill: { email, name, company, reason },
      csrfToken: res.locals['csrfToken']
    });
  };

  if (!email || !name || !password || !reason) {
    renderError('Please fill in all required fields.');
    return;
  }

  if (password.length < 8) {
    renderError('Password must be at least 8 characters.');
    return;
  }

  if (password !== passwordConfirm) {
    renderError('Passwords do not match.');
    return;
  }

  const existing = await findUserByEmail(email.trim());
  if (existing) {
    renderError('An account with this email address already exists.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await createUser({
    email: email.trim(),
    name: name.trim(),
    company: company?.trim(),
    passwordHash,
    reason: reason.trim(),
  });

  res.render('request-access', {
    title: 'Request Access',
    error: null,
    success: true,
    user: null,
    csrfToken: res.locals['csrfToken']
  });
});

export default router;

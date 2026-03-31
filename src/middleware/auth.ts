import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { findUserById } from '../db';
import type { JwtPayload } from '../types';

/**
 * Extend the Express Request interface so downstream handlers can access the
 * authenticated user without type-casting.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present after `requireAuth` middleware has run. */
      user?: JwtPayload;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });
}

function extractToken(req: Request): string | null {
  // 1. HTTP-only cookie (preferred)
  const cookie = req.cookies?.['auth_token'] as string | undefined;
  if (cookie) return cookie;

  // 2. Authorization header (API clients)
  const header = req.headers['authorization'];
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Require the request to carry a valid JWT for an approved, non-admin user
 * (or an admin).  Redirects to `/login` for browser requests.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    redirectOrUnauthorized(req, res);
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    redirectOrUnauthorized(req, res);
    return;
  }

  // Re-check approval status from the database on every request
  const user = findUserById(payload.userId);
  if (!user || !user.isApproved) {
    redirectOrUnauthorized(req, res);
    return;
  }

  req.user = { userId: user.id, email: user.email, isAdmin: user.isAdmin };
  next();
}

/**
 * Require the request to carry a valid JWT for an *admin* user.
 * Redirects to `/login` for browser requests.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.user,
      });
      return;
    }
    next();
  });
}

/**
 * Optional authentication – populates `req.user` if a valid token is present
 * but does not reject the request if it is absent.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    const user = findUserById(payload.userId);
    if (user?.isApproved) {
      req.user = { userId: user.id, email: user.email, isAdmin: user.isAdmin };
    }
  } catch {
    // Ignore invalid tokens in optional mode
  }

  next();
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function redirectOrUnauthorized(req: Request, res: Response): void {
  const wantsJson =
    req.headers['accept']?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json');

  if (wantsJson) {
    res.status(401).json({ error: 'Authentication required.' });
  } else {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}

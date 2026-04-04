import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { findUserById } from '../pgDb';
import type { JwtPayload } from '../types';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });
}

function extractToken(req: Request): string | null {
  const cookie = req.cookies?.['auth_token'] as string | undefined;
  if (cookie) return cookie;
  const header = req.headers['authorization'];
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) { redirectOrUnauthorized(req, res); return; }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    redirectOrUnauthorized(req, res);
    return;
  }

  findUserById(payload.userId)
    .then((user) => {
      if (!user || !user.isApproved) { redirectOrUnauthorized(req, res); return; }
      req.user = { userId: user.id, email: user.email, isAdmin: user.isAdmin };
      next();
    })
    .catch(next);
}

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

export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) { next(); return; }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    next();
    return;
  }

  findUserById(payload.userId)
    .then((user) => {
      if (user?.isApproved) {
        req.user = { userId: user.id, email: user.email, isAdmin: user.isAdmin };
      }
      next();
    })
    .catch(() => next());
}

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

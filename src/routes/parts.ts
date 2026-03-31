import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { getPlmService } from '../services/plmService';
import { logAccess } from '../db';

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiting – prevents bulk / automated harvesting
// ---------------------------------------------------------------------------
const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                   // at most 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});

const docLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,                    // at most 30 document views per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Document view limit reached. Please try again later.',
});

// All parts routes require an authenticated, approved user.
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /parts – list all released parts
// ---------------------------------------------------------------------------
router.get('/', viewLimiter, async (req, res) => {
  try {
    const parts = await getPlmService().getReleasedParts();
    const search = typeof req.query['q'] === 'string' ? req.query['q'].toLowerCase() : '';

    const filtered = search
      ? parts.filter(
          (p) =>
            p.partNumber.toLowerCase().includes(search) ||
            p.name.toLowerCase().includes(search) ||
            (p.description ?? '').toLowerCase().includes(search),
        )
      : parts;

    res.render('parts/index', {
      title: 'Released Parts',
      parts: filtered,
      search,
      user: req.user,
    });
  } catch (err) {
    console.error('[parts] Error fetching parts list:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not retrieve parts from the PLM system. Please try again later.',
      user: req.user,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /parts/:id – view a single released part
// ---------------------------------------------------------------------------
router.get('/:id', viewLimiter, async (req, res) => {
  try {
    const part = await getPlmService().getReleasedPartById(req.params['id']!);

    // Audit log
    logAccess({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      partId: part.id,
      partNumber: part.partNumber,
      revision: part.latestRevision.revision,
      action: 'view_part',
      accessedAt: new Date().toISOString(),
    });

    res.render('parts/detail', {
      title: `${part.partNumber} – ${part.name}`,
      part,
      user: req.user,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).render('error', {
        title: 'Not Found',
        message: 'The requested part was not found or is not in a Released state.',
        user: req.user,
      });
      return;
    }
    console.error('[parts] Error fetching part detail:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not retrieve part data from the PLM system. Please try again later.',
      user: req.user,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /parts/:id/documents/:docId – inline document viewer (no download)
// ---------------------------------------------------------------------------
router.get('/:id/documents/:docId', docLimiter, async (req, res) => {
  try {
    // First verify the part is released and the document belongs to it
    const part = await getPlmService().getReleasedPartById(req.params['id']!);
    const docId = req.params['docId']!;

    const validDocIds = [
      part.latestRevision.documentId,
      part.previousRevision?.documentId,
    ].filter(Boolean);

    if (!validDocIds.includes(docId)) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'This document is not associated with the requested part.',
        user: req.user,
      });
      return;
    }

    const { data, contentType, fileName } = await getPlmService().getDocumentContent(docId);

    // Audit log
    logAccess({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      partId: part.id,
      partNumber: part.partNumber,
      revision:
        part.latestRevision.documentId === docId
          ? part.latestRevision.revision
          : (part.previousRevision?.revision ?? ''),
      action: 'view_document',
      accessedAt: new Date().toISOString(),
    });

    // Set headers so the document is displayed inline (not downloaded).
    // Content-Disposition: inline prevents the browser from triggering a download.
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(fileName)}"`);
    res.setHeader('Content-Length', data.length);
    // Prevent caching of sensitive documents in shared environments
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).render('error', {
        title: 'Not Found',
        message: 'The requested document was not found.',
        user: req.user,
      });
      return;
    }
    console.error('[parts] Error fetching document:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not retrieve the document. Please try again later.',
      user: req.user,
    });
  }
});

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_');
}

export default router;

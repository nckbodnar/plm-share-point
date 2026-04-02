import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
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
    const part = await getPlmService().getReleasedPartById(String(req.params['id']));

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
    const part = await getPlmService().getReleasedPartById(String(req.params['id']));
    const docId = String(req.params['docId']);

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

// ---------------------------------------------------------------------------
// PUT /parts – add a new part to the mock data store (admin-only, JSON API)
// ---------------------------------------------------------------------------

const PART_TOP_LEVEL_FIELDS = ['id', 'partNumber', 'name', 'lifecycleState', 'latestRevision', 'updatedAt'] as const;
const LATEST_REVISION_FIELDS = ['revision', 'releaseDate', 'lifecycleState'] as const;

router.put('/', requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;

  // Validate top-level required fields
  const missing: string[] = PART_TOP_LEVEL_FIELDS.filter((f) => !body[f]);
  if (missing.length > 0) {
    res.status(400).json({ error: 'Missing required fields.', missing });
    return;
  }

  // Validate latestRevision sub-object
  const latestRevision = body['latestRevision'] as Record<string, unknown>;
  const missingRevFields = LATEST_REVISION_FIELDS.filter((f) => !latestRevision[f]);
  if (missingRevFields.length > 0) {
    res.status(400).json({
      error: 'Missing required fields in latestRevision.',
      missing: missingRevFields.map((f) => `latestRevision.${f}`),
    });
    return;
  }

  const part: import('../types').Part = {
    id: String(body['id']),
    partNumber: String(body['partNumber']),
    name: String(body['name']),
    description: body['description'] != null ? String(body['description']) : undefined,
    lifecycleState: body['lifecycleState'] as import('../types').LifecycleState,
    latestRevision: {
      revision: String(latestRevision['revision']),
      releaseDate: String(latestRevision['releaseDate']),
      releasedBy: latestRevision['releasedBy'] != null ? String(latestRevision['releasedBy']) : undefined,
      lifecycleState: latestRevision['lifecycleState'] as import('../types').LifecycleState,
      documentId: latestRevision['documentId'] != null ? String(latestRevision['documentId']) : undefined,
      specificationFileName: latestRevision['specificationFileName'] != null ? String(latestRevision['specificationFileName']) : undefined,
    },
    updatedAt: String(body['updatedAt']),
  };

  try {
    const created = await getPlmService().addPart(part);
    res.status(201).json({ part: created });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'CONFLICT') {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    if (code === 'NOT_SUPPORTED') {
      res.status(501).json({ error: 'addPart is not supported by the active PLM adapter.' });
      return;
    }
    console.error('[parts] Error adding part:', err);
    res.status(500).json({ error: 'Could not add part.' });
  }
});

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_');
}

export default router;

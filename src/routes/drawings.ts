import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { config } from '../config';
import {
  createDrawing,
  getDrawing,
  listDrawings,
  updateDrawing,
  deleteDrawing,
  setDrawingFilePath,
  getDrawingsForUser,
  addDrawingToProject,
  removeDrawingFromProject,
  getProjectsForDrawing,
  addDrawingToLocation,
  removeDrawingFromLocation,
  getLocationsForDrawing,
} from '../pgDb';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.uploadDir, 'drawings');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const drawingId = req.params['id'];
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${drawingId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      path.extname(file.originalname).toLowerCase() === '.pdf'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /drawings - list drawings
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { q, project, location } = req.query as Record<string, string | undefined>;

    let drawings;
    if (req.user!.isAdmin) {
      drawings = await listDrawings({ search: q, projectId: project, locationId: location });
    } else {
      const all = await getDrawingsForUser(req.user!.email);
      drawings = all.filter((d) => {
        if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      });
    }

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ drawings });
      return;
    }
    res.render('drawings/index', { title: 'Drawings', drawings, user: req.user, q, project, location });
  } catch (err) {
    console.error('[drawings] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load drawings.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// GET /drawings/new - create form (admin only)
// ---------------------------------------------------------------------------
router.get('/new', requireAdmin, (req, res) => {
  res.render('drawings/new', { title: 'New Drawing', user: req.user, error: null });
});

// ---------------------------------------------------------------------------
// POST /drawings - create drawing (admin only)
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, revision, metadata } = req.body as {
      name?: string;
      description?: string;
      revision?: string;
      metadata?: string | Record<string, unknown>;
    };

    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }

    let parsedMetadata: Record<string, unknown> = {};
    if (typeof metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        // ignore invalid metadata JSON
      }
    } else if (typeof metadata === 'object' && metadata !== null) {
      parsedMetadata = metadata;
    }

    const drawing = await createDrawing({ name, description, revision, metadata: parsedMetadata });

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.status(201).json({ drawing });
      return;
    }
    res.redirect(`/drawings/${drawing.id}`);
  } catch (err) {
    console.error('[drawings] POST / error:', err);
    res.status(500).json({ error: 'Failed to create drawing.' });
  }
});

// ---------------------------------------------------------------------------
// GET /drawings/:id - drawing detail
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const drawing = await getDrawing(String(req.params['id']));
    if (!drawing) {
      res.status(404).render('error', { title: 'Not Found', message: 'Drawing not found.', user: req.user });
      return;
    }

    const [projects, locations] = await Promise.all([
      getProjectsForDrawing(drawing.id),
      getLocationsForDrawing(drawing.id),
    ]);
    drawing.projects = projects;
    drawing.locations = locations;

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ drawing });
      return;
    }
    res.render('drawings/detail', { title: drawing.name, drawing, user: req.user });
  } catch (err) {
    console.error('[drawings] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load drawing.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// PUT /drawings/:id - update drawing (admin only)
// ---------------------------------------------------------------------------
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, revision, metadata } = req.body as {
      name?: string;
      description?: string;
      revision?: string;
      metadata?: Record<string, unknown>;
    };

    const drawing = await updateDrawing(String(req.params['id']), { name, description, revision, metadata });
    if (!drawing) {
      res.status(404).json({ error: 'Drawing not found.' });
      return;
    }
    res.json({ drawing });
  } catch (err) {
    console.error('[drawings] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update drawing.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /drawings/:id - delete drawing (admin only)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteDrawing(String(req.params['id']));
    if (!deleted) {
      res.status(404).json({ error: 'Drawing not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete drawing.' });
  }
});

// ---------------------------------------------------------------------------
// POST /drawings/:id/upload - upload PDF (admin only)
// ---------------------------------------------------------------------------
router.post('/:id/upload', requireAdmin, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No PDF file provided.' });
      return;
    }

    await setDrawingFilePath(String(req.params['id']), req.file.path);

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ success: true, filePath: req.file.path });
      return;
    }
    res.redirect(`/drawings/${req.params['id']}`);
  } catch (err) {
    console.error('[drawings] POST /:id/upload error:', err);
    res.status(500).json({ error: 'Failed to upload PDF.' });
  }
});

// ---------------------------------------------------------------------------
// GET /drawings/:id/download - download/view PDF
// ---------------------------------------------------------------------------
router.get('/:id/download', async (req, res) => {
  try {
    const drawing = await getDrawing(String(req.params['id']));
    if (!drawing) {
      res.status(404).render('error', { title: 'Not Found', message: 'Drawing not found.', user: req.user });
      return;
    }

    if (!drawing.filePath) {
      res.status(404).render('error', { title: 'Not Found', message: 'No PDF file available for this drawing.', user: req.user });
      return;
    }

    const absPath = path.isAbsolute(drawing.filePath)
      ? drawing.filePath
      : path.join(process.cwd(), drawing.filePath);

    if (!fs.existsSync(absPath)) {
      res.status(404).render('error', { title: 'Not Found', message: 'PDF file not found on disk.', user: req.user });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('[drawings] GET /:id/download error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to download PDF.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// POST /drawings/:id/projects - assign to project (admin)
// ---------------------------------------------------------------------------
router.post('/:id/projects', requireAdmin, async (req, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required.' });
      return;
    }
    await addDrawingToProject(String(req.params['id']), projectId);
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] POST /:id/projects error:', err);
    res.status(500).json({ error: 'Failed to assign project.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /drawings/:id/projects/:projectId - remove project assignment (admin)
// ---------------------------------------------------------------------------
router.delete('/:id/projects/:projectId', requireAdmin, async (req, res) => {
  try {
    await removeDrawingFromProject(String(req.params['id']), String(req.params['projectId']));
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] DELETE /:id/projects/:projectId error:', err);
    res.status(500).json({ error: 'Failed to remove project assignment.' });
  }
});

// ---------------------------------------------------------------------------
// POST /drawings/:id/locations - assign to location (admin)
// ---------------------------------------------------------------------------
router.post('/:id/locations', requireAdmin, async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId) {
      res.status(400).json({ error: 'locationId is required.' });
      return;
    }
    await addDrawingToLocation(String(req.params['id']), locationId);
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] POST /:id/locations error:', err);
    res.status(500).json({ error: 'Failed to assign location.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /drawings/:id/locations/:locationId - remove location assignment (admin)
// ---------------------------------------------------------------------------
router.delete('/:id/locations/:locationId', requireAdmin, async (req, res) => {
  try {
    await removeDrawingFromLocation(String(req.params['id']), String(req.params['locationId']));
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] DELETE /:id/locations/:locationId error:', err);
    res.status(500).json({ error: 'Failed to remove location assignment.' });
  }
});

export default router;

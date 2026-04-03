import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { config } from '../config';
import {
  createDrawing, getDrawing, listDrawings, updateDrawing, deleteDrawing,
  setDrawingFilePath, getDrawingsForUser,
  getProjectsForDrawing, addDrawingToProject, removeDrawingFromProject,
  getLocationsForDrawing, addDrawingToLocation, removeDrawingFromLocation,
  listProjects, listLocations,
} from '../pgDb';
import type { DrawingMetadata } from '../types';

const router = Router();

const docLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(config.uploadDir, 'drawings');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => {
    cb(null, `${req.params['id']}.pdf`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

router.use(requireAuth);

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const q = (req.query['q'] as string) || '';
    const projectFilter = (req.query['project'] as string) || '';
    const locationFilter = (req.query['location'] as string) || '';
    const userEmail = req.user!.email;

    let drawings = req.user!.isAdmin
      ? await listDrawings({ search: q || undefined, projectId: projectFilter || undefined, locationId: locationFilter || undefined })
      : await getDrawingsForUser(userEmail);

    if (q && !req.user!.isAdmin) {
      drawings = drawings.filter(d => d.name.toLowerCase().includes(q.toLowerCase()) || (d.description ?? '').toLowerCase().includes(q.toLowerCase()));
    }

    const drawingsWithProjects = await Promise.all(
      drawings.map(async (d) => ({ ...d, projects: await getProjectsForDrawing(d.id) }))
    );

    const [projects, locations] = await Promise.all([listProjects(), listLocations()]);

    res.render('drawings/index', {
      title: 'Drawings',
      user: req.user,
      drawings: drawingsWithProjects,
      projects,
      locations,
      search: q,
      selectedProject: projectFilter,
      selectedLocation: locationFilter,
    });
  } catch (err) {
    console.error('[drawings] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load drawings.', user: req.user });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', requireAdmin, async (req, res) => {
  try {
    const [projects, locations] = await Promise.all([listProjects(), listLocations()]);
    res.render('drawings/new', { title: 'New Drawing', user: req.user, projects, locations, error: null });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form.', user: req.user });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, revision } = req.body as Record<string, string>;
    let metadata: DrawingMetadata = {};
    try { metadata = JSON.parse((req.body as Record<string, string>)['metadata'] || '{}'); } catch { metadata = {}; }

    if (!name?.trim()) {
      const [projects, locations] = await Promise.all([listProjects(), listLocations()]);
      res.status(400).render('drawings/new', { title: 'New Drawing', user: req.user, projects, locations, error: 'Name is required.' });
      return;
    }

    const drawing = await createDrawing({ name: name.trim(), description: description?.trim(), revision: revision?.trim() || 'A', metadata });
    res.redirect(`/drawings/${drawing.id}`);
  } catch (err) {
    console.error('[drawings] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create drawing.', user: req.user });
  }
});

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const drawing = await getDrawing((req.params['id'] as string));
    if (!drawing) {
      res.status(404).render('error', { title: 'Not Found', message: 'Drawing not found.', user: req.user });
      return;
    }

    const [projectsAssigned, locationsAssigned, allProjects, allLocations] = await Promise.all([
      getProjectsForDrawing(drawing.id),
      getLocationsForDrawing(drawing.id),
      listProjects(),
      listLocations(),
    ]);

    res.render('drawings/detail', {
      title: `Drawing: ${drawing.name}`,
      user: req.user,
      drawing: { ...drawing, projects: projectsAssigned, locations: locationsAssigned },
      allProjects,
      allLocations,
    });
  } catch (err) {
    console.error('[drawings] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load drawing.', user: req.user });
  }
});

// ── Update (PUT JSON) ─────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    let metadata: DrawingMetadata | undefined;
    if (body['metadata']) {
      try { metadata = typeof body['metadata'] === 'string' ? JSON.parse(body['metadata']) : body['metadata'] as DrawingMetadata; }
      catch { res.status(400).json({ error: 'Invalid metadata JSON' }); return; }
    }
    const updated = await updateDrawing((req.params['id'] as string), {
      name: body['name'] as string | undefined,
      description: body['description'] as string | undefined,
      revision: body['revision'] as string | undefined,
      metadata,
    });
    if (!updated) { res.status(404).json({ error: 'Drawing not found' }); return; }
    res.json({ drawing: updated });
  } catch (err) {
    console.error('[drawings] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update drawing' });
  }
});

// ── Delete (DELETE JSON) ──────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteDrawing((req.params['id'] as string));
    if (!ok) { res.status(404).json({ error: 'Drawing not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[drawings] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete drawing' });
  }
});

// ── Delete (form POST fallback) ───────────────────────────────────────────────
router.post('/:id/delete', requireAdmin, async (req, res) => {
  await deleteDrawing((req.params['id'] as string));
  res.redirect('/drawings');
});

// ── PDF Upload ────────────────────────────────────────────────────────────────
router.post('/:id/upload', requireAdmin, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).render('error', { title: 'Error', message: 'No PDF file provided.', user: req.user }); return; }
    const relPath = path.relative(process.cwd(), req.file.path);
    await setDrawingFilePath((req.params['id'] as string), relPath);
    res.redirect(`/drawings/${req.params['id']}`);
  } catch (err) {
    console.error('[drawings] POST /:id/upload error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Upload failed.', user: req.user });
  }
});

// ── PDF Download/View ─────────────────────────────────────────────────────────
router.get('/:id/download', docLimiter, async (req, res) => {
  try {
    const drawing = await getDrawing((req.params['id'] as string));
    if (!drawing?.filePath) { res.status(404).render('error', { title: 'Not Found', message: 'No PDF attached to this drawing.', user: req.user }); return; }
    const absPath = path.isAbsolute(drawing.filePath) ? drawing.filePath : path.join(process.cwd(), drawing.filePath);
    if (!fs.existsSync(absPath)) { res.status(404).render('error', { title: 'Not Found', message: 'PDF file not found on server.', user: req.user }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(drawing.name)}.pdf"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('[drawings] GET /:id/download error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to serve PDF.', user: req.user });
  }
});

// ── Assign project ────────────────────────────────────────────────────────────
router.post('/:id/projects', requireAdmin, async (req, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) { res.status(400).redirect(`/drawings/${req.params['id']}`); return; }
    await addDrawingToProject((req.params['id'] as string), projectId);
    res.redirect(`/drawings/${req.params['id']}`);
  } catch (err) {
    console.error('[drawings] POST /:id/projects error:', err);
    res.status(500).json({ error: 'Failed to assign project' });
  }
});

// ── Remove project ────────────────────────────────────────────────────────────
router.delete('/:id/projects/:projectId', requireAdmin, async (req, res) => {
  try {
    await removeDrawingFromProject((req.params['id'] as string), (req.params['projectId'] as string));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove project assignment' });
  }
});

// ── Assign location ───────────────────────────────────────────────────────────
router.post('/:id/locations', requireAdmin, async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId) { res.status(400).redirect(`/drawings/${req.params['id']}`); return; }
    await addDrawingToLocation((req.params['id'] as string), locationId);
    res.redirect(`/drawings/${req.params['id']}`);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign location' });
  }
});

// ── Remove location ───────────────────────────────────────────────────────────
router.delete('/:id/locations/:locationId', requireAdmin, async (req, res) => {
  try {
    await removeDrawingFromLocation((req.params['id'] as string), (req.params['locationId'] as string));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove location assignment' });
  }
});

export default router;

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { config } from '../config';
import {
  createTechDoc, getTechDoc, listTechDocs, updateTechDoc, deleteTechDoc,
  setTechDocFilePath, getTechDocsForUser,
  getProjectsForTechDoc, addTechDocToProject, removeTechDocFromProject,
  getLocationsForTechDoc, addTechDocToLocation, removeTechDocFromLocation,
  listProjects, listLocations,
} from '../pgDb';
import type { TechDocMetadata } from '../types';

const router = Router();

const docLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(config.uploadDir, 'parts');
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

    let docs = req.user!.isAdmin
      ? await listTechDocs({ search: q || undefined, projectId: projectFilter || undefined, locationId: locationFilter || undefined })
      : await getTechDocsForUser(userEmail);

    if (q && !req.user!.isAdmin) {
      docs = docs.filter(d => d.name.toLowerCase().includes(q.toLowerCase()) || (d.description ?? '').toLowerCase().includes(q.toLowerCase()));
    }

    const docsWithProjects = await Promise.all(
      docs.map(async (d) => ({ ...d, projects: await getProjectsForTechDoc(d.id) }))
    );

    const [projects, locations] = await Promise.all([listProjects(), listLocations()]);

    res.render('parts/index', {
      title: 'Parts',
      user: req.user,
      drawings: docsWithProjects,
      projects,
      locations,
      search: q,
      selectedProject: projectFilter,
      selectedLocation: locationFilter,
    });
  } catch (err) {
    console.error('[parts] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load parts.', user: req.user });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', requireAdmin, async (req, res) => {
  try {
    const [projects, locations] = await Promise.all([listProjects(), listLocations()]);
    res.render('parts/new', { title: 'New Part', user: req.user, projects, locations, error: null });
  } catch (_err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form.', user: req.user });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, revision } = req.body as Record<string, string>;
    let metadata: TechDocMetadata = {};
    try { metadata = JSON.parse((req.body as Record<string, string>)['metadata'] || '{}'); } catch { metadata = {}; }

    if (!name?.trim()) {
      const [projects, locations] = await Promise.all([listProjects(), listLocations()]);
      res.status(400).render('parts/new', { title: 'New Part', user: req.user, projects, locations, error: 'Name is required.' });
      return;
    }

    const doc = await createTechDoc({ name: name.trim(), description: description?.trim(), revision: revision?.trim() || 'A', metadata });
    res.redirect(`/parts/${doc.id}`);
  } catch (err) {
    console.error('[parts] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create part.', user: req.user });
  }
});

// ── Edit (redirect to detail) ──────────────────────────────────────────────
router.get('/:id/edit', requireAdmin, (req, res) => {
  res.redirect(`/parts/${req.params['id']}`);
});

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await getTechDoc((req.params['id'] as string));
    if (!doc) {
      res.status(404).render('error', { title: 'Not Found', message: 'Part not found.', user: req.user });
      return;
    }
    const [projectsAssigned, locationsAssigned, allProjects, allLocations] = await Promise.all([
      getProjectsForTechDoc(doc.id),
      getLocationsForTechDoc(doc.id),
      listProjects(),
      listLocations(),
    ]);
    res.render('parts/detail', {
      title: `Part: ${doc.name}`,
      user: req.user,
      drawing: { ...doc, projects: projectsAssigned, locations: locationsAssigned },
      allProjects,
      allLocations,
    });
  } catch (err) {
    console.error('[parts] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load part.', user: req.user });
  }
});

// ── Update (PUT JSON) ──────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    let metadata: TechDocMetadata | undefined;
    if (body['metadata']) {
      try { metadata = typeof body['metadata'] === 'string' ? JSON.parse(body['metadata']) : body['metadata'] as TechDocMetadata; }
      catch { res.status(400).json({ error: 'Invalid metadata JSON' }); return; }
    }
    const updated = await updateTechDoc((req.params['id'] as string), {
      name: body['name'] as string | undefined,
      description: body['description'] as string | undefined,
      revision: body['revision'] as string | undefined,
      metadata,
    });
    if (!updated) { res.status(404).json({ error: 'Part not found' }); return; }
    res.json({ drawing: updated });
  } catch (err) {
    console.error('[parts] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update part' });
  }
});

// ── Delete (DELETE JSON) ───────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteTechDoc((req.params['id'] as string));
    if (!ok) { res.status(404).json({ error: 'Part not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[parts] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete part' });
  }
});

// ── Delete (form POST fallback) ────────────────────────────────────────────────
router.post('/:id/delete', requireAdmin, async (req, res) => {
  await deleteTechDoc((req.params['id'] as string));
  res.redirect('/parts');
});

// ── PDF Upload ─────────────────────────────────────────────────────────────────
router.post('/:id/upload', requireAdmin, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).render('error', { title: 'Error', message: 'No PDF file provided.', user: req.user }); return; }
    const relPath = path.relative(process.cwd(), req.file.path);
    await setTechDocFilePath((req.params['id'] as string), relPath);
    res.redirect(`/parts/${req.params['id']}`);
  } catch (err) {
    console.error('[parts] POST /:id/upload error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Upload failed.', user: req.user });
  }
});

// ── PDF Download/View ──────────────────────────────────────────────────────────
router.get('/:id/download', docLimiter, async (req, res) => {
  try {
    const doc = await getTechDoc((req.params['id'] as string));
    if (!doc?.filePath) { res.status(404).render('error', { title: 'Not Found', message: 'No PDF attached.', user: req.user }); return; }
    const absPath = path.isAbsolute(doc.filePath) ? doc.filePath : path.join(process.cwd(), doc.filePath);
    if (!fs.existsSync(absPath)) { res.status(404).render('error', { title: 'Not Found', message: 'PDF file not found on server.', user: req.user }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}.pdf"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('[parts] GET /:id/download error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to serve PDF.', user: req.user });
  }
});

// ── Assign project ─────────────────────────────────────────────────────────────
router.post('/:id/projects', requireAdmin, async (req, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) { res.status(400).redirect(`/parts/${req.params['id']}`); return; }
    await addTechDocToProject((req.params['id'] as string), projectId);
    res.redirect(`/parts/${req.params['id']}`);
  } catch (err) {
    console.error('[parts] POST /:id/projects error:', err);
    res.status(500).json({ error: 'Failed to assign project' });
  }
});

// ── Remove project ─────────────────────────────────────────────────────────────
router.delete('/:id/projects/:projectId', requireAdmin, async (req, res) => {
  try {
    await removeTechDocFromProject((req.params['id'] as string), (req.params['projectId'] as string));
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to remove project assignment' });
  }
});

// ── Assign location ────────────────────────────────────────────────────────────
router.post('/:id/locations', requireAdmin, async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId) { res.status(400).redirect(`/parts/${req.params['id']}`); return; }
    await addTechDocToLocation((req.params['id'] as string), locationId);
    res.redirect(`/parts/${req.params['id']}`);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to assign location' });
  }
});

// ── Remove location ────────────────────────────────────────────────────────────
router.delete('/:id/locations/:locationId', requireAdmin, async (req, res) => {
  try {
    await removeTechDocFromLocation((req.params['id'] as string), (req.params['locationId'] as string));
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to remove location assignment' });
  }
});

export default router;

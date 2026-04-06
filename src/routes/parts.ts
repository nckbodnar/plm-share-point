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
  createRevisionSnapshot, listRevisions, getRevision, deleteRevision,
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

// Separate storage for revision history PDFs (named by partId_revisionId.pdf)
const revisionStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(config.uploadDir, 'parts', 'revisions');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => {
    // revisionId not known yet at this stage; use partId + timestamp
    cb(null, `${req.params['id']}_${Date.now()}.pdf`);
  },
});
const uploadRevision = multer({
  storage: revisionStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
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
    const [projectsAssigned, locationsAssigned, allProjects, allLocations, revisions] = await Promise.all([
      getProjectsForTechDoc(doc.id),
      getLocationsForTechDoc(doc.id),
      listProjects(),
      listLocations(),
      listRevisions(doc.id),
    ]);
    res.render('parts/detail', {
      title: `Part: ${doc.name}`,
      user: req.user,
      drawing: { ...doc, projects: projectsAssigned, locations: locationsAssigned },
      allProjects,
      allLocations,
      revisions,
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

// ── Bump to new revision ───────────────────────────────────────────────────────
// POST /parts/:id/revisions
// Body (multipart): notes?, pdf?
// 1. Snapshots the current revision + file into history
// 2. Increments the revision label (A→B, Z→AA, AA→AB, …)
// 3. Optionally replaces the current PDF with the uploaded file
router.post('/:id/revisions', requireAdmin, uploadRevision.single('pdf'), async (req, res) => {
  try {
    const id = req.params['id'] as string;
    const doc = await getTechDoc(id);
    if (!doc) { res.status(404).render('error', { title: 'Not Found', message: 'Part not found.', user: req.user }); return; }

    const notes = ((req.body as Record<string, string>)['notes'] || '').trim() || undefined;

    // 1. Save snapshot of current state into history
    await createRevisionSnapshot({
      techDocId: id,
      revision: doc.revision,
      filePath: doc.filePath,
      notes,
      createdBy: req.user!.email,
    });

    // 2. Compute next revision label
    const nextRevision = incrementRevision(doc.revision);

    // 3. Determine new file path (uploaded file, or keep current)
    let newFilePath = doc.filePath;
    if (req.file) {
      // Move uploaded file to the canonical <id>.pdf location
      const canonicalPath = path.join(config.uploadDir, 'parts', `${id}.pdf`);
      fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
      fs.renameSync(req.file.path, canonicalPath);
      newFilePath = path.relative(process.cwd(), canonicalPath);
    }

    // 4. Update the main record
    await updateTechDoc(id, { revision: nextRevision });
    if (newFilePath !== doc.filePath) {
      await setTechDocFilePath(id, newFilePath!);
    }

    res.redirect(`/parts/${id}`);
  } catch (err) {
    console.error('[parts] POST /:id/revisions error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to bump revision.', user: req.user });
  }
});

// ── Download a historical revision PDF ────────────────────────────────────────
router.get('/:id/revisions/:revId/download', docLimiter, async (req, res) => {
  try {
    const rev = await getRevision(req.params['revId'] as string);
    if (!rev || rev.techDocId !== (req.params['id'] as string)) {
      res.status(404).render('error', { title: 'Not Found', message: 'Revision not found.', user: req.user }); return;
    }
    if (!rev.filePath) {
      res.status(404).render('error', { title: 'Not Found', message: 'No PDF for this revision.', user: req.user }); return;
    }
    const absPath = path.isAbsolute(rev.filePath) ? rev.filePath : path.join(process.cwd(), rev.filePath);
    if (!fs.existsSync(absPath)) {
      res.status(404).render('error', { title: 'Not Found', message: 'PDF file not found on server.', user: req.user }); return;
    }
    const doc = await getTechDoc(req.params['id'] as string);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent((doc?.name ?? 'part'))}_rev${rev.revision}.pdf"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('[parts] GET /:id/revisions/:revId/download error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to serve PDF.', user: req.user });
  }
});

// ── Delete a historical revision ───────────────────────────────────────────────
router.delete('/:id/revisions/:revId', requireAdmin, async (req, res) => {
  try {
    const rev = await getRevision(req.params['revId'] as string);
    if (!rev || rev.techDocId !== (req.params['id'] as string)) {
      res.status(404).json({ error: 'Revision not found' }); return;
    }
    // Delete the stored file if it exists and is not the same as the current doc's file
    if (rev.filePath) {
      const absPath = path.isAbsolute(rev.filePath) ? rev.filePath : path.join(process.cwd(), rev.filePath);
      // Only delete if it looks like a revisions/ path (don't nuke the live PDF)
      if (absPath.includes(`${path.sep}revisions${path.sep}`) && fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    }
    await deleteRevision(req.params['revId'] as string);
    res.json({ success: true });
  } catch (err) {
    console.error('[parts] DELETE /:id/revisions/:revId error:', err);
    res.status(500).json({ error: 'Failed to delete revision' });
  }
});

// ── Helper: increment revision label ──────────────────────────────────────────
// A→B, B→C, …Z→AA, AA→AB, …AZ→BA, …ZZ→AAA
function incrementRevision(rev: string): string {
  const upper = rev.toUpperCase();
  const chars = upper.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i]! < 'Z') {
      chars[i] = String.fromCharCode(chars[i]!.charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }
  // All chars were Z → prepend A
  return 'A' + chars.join('');
}

export default router;

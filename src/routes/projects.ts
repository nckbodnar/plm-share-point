import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  createProject, getProject, listProjects, updateProject, deleteProject,
  getGroupsForProject, addGroupToProject, removeGroupFromProject,
  getLocationsForProject, addLocationToProject, removeLocationFromProject,
  listDrawings, listGroups, listLocations,
} from '../pgDb';

const router = Router();
router.use(requireAuth);

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const projects = await listProjects();
    res.render('projects/index', { title: 'Projects', user: req.user, projects });
  } catch (err) {
    console.error('[projects] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load projects.', user: req.user });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', requireAdmin, (_req, res) => {
  res.render('projects/new', { title: 'New Project', user: _req.user, error: null });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body as Record<string, string>;
    if (!name?.trim()) {
      res.status(400).render('projects/new', { title: 'New Project', user: req.user, error: 'Name is required.' });
      return;
    }
    const project = await createProject({ name: name.trim(), description: description?.trim() });
    res.redirect(`/projects/${project.id}`);
  } catch (err) {
    console.error('[projects] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create project.', user: req.user });
  }
});

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const project = await getProject((req.params['id'] as string));
    if (!project) {
      res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user });
      return;
    }
    const [groups, locations, allGroups, allLocations, allDrawings] = await Promise.all([
      getGroupsForProject(project.id),
      getLocationsForProject(project.id),
      listGroups(),
      listLocations(),
      listDrawings({ projectId: project.id }),
    ]);
    res.render('projects/detail', {
      title: `Project: ${project.name}`,
      user: req.user,
      project,
      groups,
      locations,
      allGroups,
      allLocations,
      drawings: allDrawings,
    });
  } catch (err) {
    console.error('[projects] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load project.', user: req.user });
  }
});

// ── Update (PUT JSON) ─────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body as Record<string, string>;
    const updated = await updateProject((req.params['id'] as string), { name, description });
    if (!updated) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteProject((req.params['id'] as string));
    if (!ok) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

router.post('/:id/delete', requireAdmin, async (req, res) => {
  await deleteProject((req.params['id'] as string));
  res.redirect('/projects');
});

// ── Group access ──────────────────────────────────────────────────────────────
router.post('/:id/groups', requireAdmin, async (req, res) => {
  try {
    const { groupId } = req.body as { groupId?: string };
    if (!groupId) { res.redirect(`/projects/${req.params['id']}`); return; }
    await addGroupToProject(groupId, (req.params['id'] as string));
    res.redirect(`/projects/${req.params['id']}`);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add group' });
  }
});

router.delete('/:id/groups/:groupId', requireAdmin, async (req, res) => {
  try {
    await removeGroupFromProject((req.params['groupId'] as string), (req.params['id'] as string));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove group' });
  }
});

// ── Location access ───────────────────────────────────────────────────────────
router.post('/:id/locations', requireAdmin, async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId) { res.redirect(`/projects/${req.params['id']}`); return; }
    await addLocationToProject((req.params['id'] as string), locationId);
    res.redirect(`/projects/${req.params['id']}`);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add location' });
  }
});

router.delete('/:id/locations/:locationId', requireAdmin, async (req, res) => {
  try {
    await removeLocationFromProject((req.params['id'] as string), (req.params['locationId'] as string));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove location' });
  }
});

export default router;

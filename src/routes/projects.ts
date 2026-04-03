import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  getProjectsForDrawing,
  addGroupToProject,
  removeGroupFromProject,
  getProjectsForGroup,
  getGroupsForProject,
  listDrawings,
  listGroups,
} from '../pgDb';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /projects - list all projects
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const projects = await listProjects();
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ projects });
      return;
    }
    res.render('projects/index', { title: 'Projects', projects, user: req.user });
  } catch (err) {
    console.error('[projects] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load projects.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// GET /projects/new - create form (admin only)
// ---------------------------------------------------------------------------
router.get('/new', requireAdmin, (req, res) => {
  res.render('projects/new', { title: 'New Project', user: req.user, error: null });
});

// ---------------------------------------------------------------------------
// POST /projects - create project (admin only)
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }
    const project = await createProject({ name, description });
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.status(201).json({ project });
      return;
    }
    res.redirect('/projects');
  } catch (err) {
    console.error('[projects] POST / error:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

// ---------------------------------------------------------------------------
// GET /projects/:id - project detail
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const project = await getProject(String(req.params['id']));
    if (!project) {
      res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user });
      return;
    }
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ project });
      return;
    }
    const [drawings, groups, allGroups] = await Promise.all([
      listDrawings({ projectId: String(req.params['id']) }),
      getGroupsForProject(String(req.params['id'])),
      listGroups(),
    ]);
    res.render('projects/detail', { title: project.name, project, drawings, groups, allGroups, user: req.user });
  } catch (err) {
    console.error('[projects] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load project.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// PUT /projects/:id - update project (admin only)
// ---------------------------------------------------------------------------
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    const project = await updateProject(String(req.params['id']), { name, description });
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project });
  } catch (err) {
    console.error('[projects] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update project.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id - delete project (admin only)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteProject(String(req.params['id']));
    if (!deleted) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete project.' });
  }
});

// ---------------------------------------------------------------------------
// POST /projects/:id/groups - assign group to project (admin)
// ---------------------------------------------------------------------------
router.post('/:id/groups', requireAdmin, async (req, res) => {
  try {
    const { groupId } = req.body as { groupId?: string };
    if (!groupId) {
      res.status(400).json({ error: 'groupId is required.' });
      return;
    }
    await addGroupToProject(groupId, String(req.params['id']));
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] POST /:id/groups error:', err);
    res.status(500).json({ error: 'Failed to assign group.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id/groups/:groupId - remove group from project (admin)
// ---------------------------------------------------------------------------
router.delete('/:id/groups/:groupId', requireAdmin, async (req, res) => {
  try {
    await removeGroupFromProject(String(req.params['groupId']), String(req.params['id']));
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] DELETE /:id/groups/:groupId error:', err);
    res.status(500).json({ error: 'Failed to remove group from project.' });
  }
});

export default router;

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import {
  createGroup,
  getGroup,
  listGroups,
  deleteGroup,
  addUserToGroup,
  removeUserFromGroup,
  addGroupToProject,
  removeGroupFromProject,
  getUsersInGroup,
  getProjectsForGroup,
  listProjects,
} from '../pgDb';

const router = Router();

router.use(requireAdmin);

// ---------------------------------------------------------------------------
// GET /groups - list all groups with members and projects
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const groups = await listGroups();

    const enriched = await Promise.all(
      groups.map(async (g) => {
        const [users, projects] = await Promise.all([getUsersInGroup(g.id), getProjectsForGroup(g.id)]);
        return { ...g, users, projects, memberCount: users.length, projectCount: projects.length };
      }),
    );

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ groups: enriched });
      return;
    }
    res.render('groups/index', { title: 'Groups', groups: enriched, user: req.user });
  } catch (err) {
    console.error('[groups] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load groups.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// GET /groups/new - create form
// ---------------------------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('groups/new', { title: 'New Group', user: req.user, error: null });
});

// ---------------------------------------------------------------------------
// POST /groups - create group
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }
    const group = await createGroup(name);
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.status(201).json({ group });
      return;
    }
    res.redirect('/groups');
  } catch (err) {
    console.error('[groups] POST / error:', err);
    res.status(500).json({ error: 'Failed to create group.' });
  }
});

// ---------------------------------------------------------------------------
// GET /groups/:id - group detail
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const group = await getGroup(String(req.params['id']));
    if (!group) {
      res.status(404).render('error', { title: 'Not Found', message: 'Group not found.', user: req.user });
      return;
    }
    const [members, projectsInGroup, allProjects] = await Promise.all([
      getUsersInGroup(group.id),
      getProjectsForGroup(group.id),
      listProjects(),
    ]);

    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ group: { ...group, users: members, projects: projectsInGroup } });
      return;
    }
    res.render('groups/detail', { title: group.name, group, members, projectsInGroup, allProjects, user: req.user });
  } catch (err) {
    console.error('[groups] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load group.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// DELETE /groups/:id - delete group
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteGroup(String(req.params['id']));
    if (!deleted) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[groups] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete group.' });
  }
});

// ---------------------------------------------------------------------------
// POST /groups/:id/users - add user to group
// ---------------------------------------------------------------------------
router.post('/:id/users', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'email is required.' });
      return;
    }
    await addUserToGroup(email, String(req.params['id']));
    res.json({ success: true });
  } catch (err) {
    console.error('[groups] POST /:id/users error:', err);
    res.status(500).json({ error: 'Failed to add user to group.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /groups/:id/users/:email - remove user from group
// ---------------------------------------------------------------------------
router.delete('/:id/users/:email', async (req, res) => {
  try {
    await removeUserFromGroup(String(req.params['email']), String(req.params['id']));
    res.json({ success: true });
  } catch (err) {
    console.error('[groups] DELETE /:id/users/:email error:', err);
    res.status(500).json({ error: 'Failed to remove user from group.' });
  }
});

// ---------------------------------------------------------------------------
// POST /groups/:id/projects - add project to group
// ---------------------------------------------------------------------------
router.post('/:id/projects', async (req, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required.' });
      return;
    }
    await addGroupToProject(String(req.params['id']), projectId);
    res.json({ success: true });
  } catch (err) {
    console.error('[groups] POST /:id/projects error:', err);
    res.status(500).json({ error: 'Failed to add project to group.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /groups/:id/projects/:projectId - remove project from group
// ---------------------------------------------------------------------------
router.delete('/:id/projects/:projectId', async (req, res) => {
  try {
    await removeGroupFromProject(String(req.params['id']), String(req.params['projectId']));
    res.json({ success: true });
  } catch (err) {
    console.error('[groups] DELETE /:id/projects/:projectId error:', err);
    res.status(500).json({ error: 'Failed to remove project from group.' });
  }
});

export default router;

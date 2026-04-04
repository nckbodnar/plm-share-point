import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  createGroup, getGroup, listGroupsWithCounts, updateGroup, deleteGroup,
  getUsersInGroup, addUserToGroup, removeUserFromGroup,
  getProjectsForGroup, addGroupToProject, removeGroupFromProject,
  listProjects,
} from '../pgDb';

const router = Router();
router.use(requireAuth);

// ── List ──────────────────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const groups = await listGroupsWithCounts();
    res.render('groups/index', { title: 'Groups', user: req.user, groups });
  } catch (err) {
    console.error('[groups] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load groups.', user: req.user });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', requireAdmin, (_req, res) => {
  res.render('groups/new', { title: 'New Group', user: _req.user, error: null });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as Record<string, string>;
    if (!name?.trim()) {
      res.status(400).render('groups/new', { title: 'New Group', user: req.user, error: 'Name is required.' });
      return;
    }
    const group = await createGroup(name.trim());
    res.redirect(`/groups/${group.id}`);
  } catch (err) {
    console.error('[groups] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create group.', user: req.user });
  }
});

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const group = await getGroup((req.params['id'] as string));
    if (!group) {
      res.status(404).render('error', { title: 'Not Found', message: 'Group not found.', user: req.user });
      return;
    }
    const [members, projectsInGroup, allProjects] = await Promise.all([
      getUsersInGroup(group.id),
      getProjectsForGroup(group.id),
      listProjects(),
    ]);
    res.render('groups/detail', {
      title: `Group: ${group.name}`,
      user: req.user,
      group,
      members,
      projectsInGroup,
      allProjects,
    });
  } catch (err) {
    console.error('[groups] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load group.', user: req.user });
  }
});

// ── Update (PUT JSON) ─────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as Record<string, string>;
    const updated = await updateGroup((req.params['id'] as string), name);
    if (!updated) { res.status(404).json({ error: 'Group not found' }); return; }
    res.json({ group: updated });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteGroup((req.params['id'] as string));
    if (!ok) { res.status(404).json({ error: 'Group not found' }); return; }
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

router.post('/:id/delete', requireAdmin, async (req, res) => {
  await deleteGroup((req.params['id'] as string));
  res.redirect('/groups');
});

// ── User membership ───────────────────────────────────────────────────────────
router.post('/:id/users', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) { res.redirect(`/groups/${req.params['id']}`); return; }
    await addUserToGroup(email.trim().toLowerCase(), (req.params['id'] as string));
    res.redirect(`/groups/${req.params['id']}`);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to add user' });
  }
});

router.delete('/:id/users/:email', requireAdmin, async (req, res) => {
  try {
    await removeUserFromGroup(decodeURIComponent((req.params['email'] as string)), (req.params['id'] as string));
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

// ── Project assignment ────────────────────────────────────────────────────────
router.post('/:id/projects', requireAdmin, async (req, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) { res.redirect(`/groups/${req.params['id']}`); return; }
    await addGroupToProject((req.params['id'] as string), projectId);
    res.redirect(`/groups/${req.params['id']}`);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to add project' });
  }
});

router.delete('/:id/projects/:projectId', requireAdmin, async (req, res) => {
  try {
    await removeGroupFromProject((req.params['id'] as string), (req.params['projectId'] as string));
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to remove project' });
  }
});

export default router;

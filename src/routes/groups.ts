import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getAllGroups, getGroupById, getUsersByGroupId } from '../db';

const router = Router();

// Apply authentication to all routes
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /groups - list groups
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const q = (req.query['q'] as string) || '';
    let groups = getAllGroups();
    
    if (q) {
      groups = groups.filter(group => 
        group.name.toLowerCase().includes(q.toLowerCase()) ||
        group.type.toLowerCase().includes(q.toLowerCase()) ||
        (group.description && group.description.toLowerCase().includes(q.toLowerCase()))
      );
    }

    res.render('groups/index', {
      title: 'Manage Groups',
      user: req.user,
      groups,
      search: q
    });
  } catch (err) {
    console.error('[groups] GET / error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load groups.', 
      user: req.user 
    });
  }
});

// ---------------------------------------------------------------------------
// GET /groups/:id - group detail
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = getGroupById(groupId);
    
    if (!group) {
      res.status(404).render('error', {
        title: 'Group Not Found',
        message: 'The requested group does not exist.',
        user: req.user
      });
      return;
    }

    const members = getUsersByGroupId(groupId);

    res.render('groups/detail', {
      title: `Group: ${group.name}`,
      user: req.user,
      group,
      members
    });
  } catch (err) {
    console.error('[groups] GET /:id error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load group.', 
      user: req.user 
    });
  }
});

export default router;
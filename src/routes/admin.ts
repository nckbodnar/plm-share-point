import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '../middleware/auth';
import {
  getAllUsers,
  getPendingUsers,
  approveUser,
  rejectUser,
  revokeUser,
  findUserById,
  getAuditLog,
  updatePassword,
} from '../db';
import {
  listGroups, listLocations, getGroupsForUser, getLocationsForUser,
  removeAllGroupsFromUser, addUserToGroup,
  removeAllLocationsFromUser, addLocationToUser,
} from '../pgDb';

const router = Router();

// Rate limit for admin actions to prevent brute force / automation
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});

// All admin routes require an admin token.
router.use(requireAdmin);
router.use(adminLimiter);

// ---------------------------------------------------------------------------
// GET /admin – redirect to dashboard
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

// ---------------------------------------------------------------------------
// GET /admin/dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  const pendingUsers = getPendingUsers();
  const allUsers = getAllUsers().filter((u) => !u.isAdmin);

  let drawingsCount = 0;
  let projectsCount = 0;
  let groupsCount = 0;

  try {
    const { listDrawings, listProjects, listGroups: pgListGroups } = await import('../pgDb');
    const [drawings, projects, groups] = await Promise.all([listDrawings(), listProjects(), pgListGroups()]);
    drawingsCount = drawings.length;
    projectsCount = projects.length;
    groupsCount = groups.length;
  } catch (err) {
    console.error('Error getting counts:', err);
  }

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    pendingUsers,
    allUsers,
    drawingsCount,
    projectsCount,
    groupsCount,
    user: req.user,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/approve
// ---------------------------------------------------------------------------
router.post('/users/:id/approve', (req, res) => {
  const userId = parseInt((req.params['id'] as string), 10);
  const notes = typeof req.body['notes'] === 'string' ? req.body['notes'].trim() : undefined;

  const target = findUserById(userId);
  if (!target) {
    res.status(404).render('error', {
      title: 'Not Found',
      message: 'User not found.',
      user: req.user,
    });
    return;
  }

  approveUser(userId, req.user!.email, notes);
  res.redirect('/admin/dashboard');
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/reject
// ---------------------------------------------------------------------------
router.post('/users/:id/reject', (req, res) => {
  const userId = parseInt((req.params['id'] as string), 10);
  const notes = typeof req.body['notes'] === 'string' ? req.body['notes'].trim() : undefined;

  const target = findUserById(userId);
  if (!target) {
    res.status(404).render('error', {
      title: 'Not Found',
      message: 'User not found.',
      user: req.user,
    });
    return;
  }

  rejectUser(userId, req.user!.email, notes);
  res.redirect('/admin/dashboard');
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/revoke
// ---------------------------------------------------------------------------
router.post('/users/:id/revoke', (req, res) => {
  const userId = parseInt((req.params['id'] as string), 10);

  const target = findUserById(userId);
  if (!target || target.isAdmin) {
    res.status(400).render('error', {
      title: 'Error',
      message: 'Cannot revoke access for this user.',
      user: req.user,
    });
    return;
  }

  revokeUser(userId);
  res.redirect('/admin/dashboard');
});

// ---------------------------------------------------------------------------
// GET /admin/audit
// ---------------------------------------------------------------------------
router.get('/audit', (req, res) => {
  const entries = getAuditLog(500);
  res.render('admin/audit', {
    title: 'Audit Log',
    entries,
    user: req.user,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/profile – admin password change
// ---------------------------------------------------------------------------
router.get('/profile', (req, res) => {
  res.render('admin/profile', {
    title: 'Change Password',
    error: null,
    success: false,
    user: req.user,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users - manage users
// ---------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const allUsers = getAllUsers().filter((u) => !u.isAdmin);
    const [groups, locations] = await Promise.all([listGroups(), listLocations()]);

    const usersWithDetails = await Promise.all(
      allUsers.map(async (user) => {
        const [userGroups, userLocations] = await Promise.all([
          getGroupsForUser(user.email),
          getLocationsForUser(user.email),
        ]);
        return {
          ...user,
          groupName: userGroups[0]?.name || null,
          groupId: userGroups[0]?.id || null,
          locationName: userLocations[0]?.name || null,
          locationId: userLocations[0]?.id || null,
        };
      }),
    );

    res.render('admin/users', {
      title: 'Manage Users',
      users: usersWithDetails,
      groups,
      locations,
      user: req.user,
    });
  } catch (err) {
    console.error('[admin] GET /users error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load users.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/assign - assign group/location to user
// ---------------------------------------------------------------------------
router.post('/users/:id/assign', async (req, res) => {
  try {
    const userId = parseInt((req.params['id'] as string), 10);
    const groupId = typeof req.body['groupId'] === 'string' && req.body['groupId'] ? req.body['groupId'] : null;
    const locationId = typeof req.body['locationId'] === 'string' && req.body['locationId'] ? req.body['locationId'] : null;

    const target = findUserById(userId);
    if (!target) {
      res.status(404).render('error', { title: 'Not Found', message: 'User not found.', user: req.user });
      return;
    }

    await removeAllGroupsFromUser(target.email);
    if (groupId) await addUserToGroup(target.email, groupId);

    await removeAllLocationsFromUser(target.email);
    if (locationId) await addLocationToUser(target.email, locationId);

    res.redirect('/admin/users');
  } catch (err) {
    console.error('[admin] POST /users/:id/assign error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to assign user.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/profile
// ---------------------------------------------------------------------------
router.post('/profile', async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  const renderError = (error: string): void => {
    res.render('admin/profile', {
      title: 'Change Password',
      error,
      success: false,
      user: req.user,
    });
  };

  if (!currentPassword || !newPassword || !confirmPassword) {
    renderError('All fields are required.');
    return;
  }

  const dbUser = findUserById(req.user!.userId)!;
  const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
  if (!valid) {
    renderError('Current password is incorrect.');
    return;
  }

  if (newPassword.length < 8) {
    renderError('New password must be at least 8 characters.');
    return;
  }

  if (newPassword !== confirmPassword) {
    renderError('New passwords do not match.');
    return;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  updatePassword(req.user!.userId, hash);

  res.render('admin/profile', {
    title: 'Change Password',
    error: null,
    success: true,
    user: req.user,
  });
});

export default router;

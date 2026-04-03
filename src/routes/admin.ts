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
  getAllGroups,
  getAllLocations,
  getAllProjects,
  getAllDrawings,
  updateUserGroupAndLocation,
  getUserWithGroupAndLocation,
} from '../db';

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
    const drawings = getAllDrawings();
    const projects = getAllProjects();
    const groups = getAllGroups();
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
  const userId = parseInt(req.params['id']!, 10);
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
  const userId = parseInt(req.params['id']!, 10);
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
  const userId = parseInt(req.params['id']!, 10);

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
router.get('/users', (req, res) => {
  const allUsers = getAllUsers().filter((u) => !u.isAdmin);
  const groups = getAllGroups();
  const locations = getAllLocations();

  // Get extended user info with group and location names
  const usersWithDetails = allUsers.map(user => {
    const details = getUserWithGroupAndLocation(user.id);
    return {
      ...user,
      groupName: details?.group_name || null,
      locationName: details?.location_name || null,
      groupId: details?.group_id || null,
      locationId: details?.location_id || null
    };
  });

  res.render('admin/users', {
    title: 'Manage Users',
    users: usersWithDetails,
    groups,
    locations,
    user: req.user,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/assign - assign group/location to user
// ---------------------------------------------------------------------------
router.post('/users/:id/assign', (req, res) => {
  const userId = parseInt(req.params['id']!, 10);
  const groupId = req.body['groupId'] ? parseInt(req.body['groupId']) : undefined;
  const locationId = req.body['locationId'] ? parseInt(req.body['locationId']) : undefined;

  const target = findUserById(userId);
  if (!target) {
    res.status(404).render('error', {
      title: 'Not Found',
      message: 'User not found.',
      user: req.user,
    });
    return;
  }

  updateUserGroupAndLocation(userId, groupId, locationId);
  res.redirect('/admin/users');
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

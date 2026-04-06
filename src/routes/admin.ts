import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '../middleware/auth';
import {
  getAllUsers, getPendingUsers, approveUser, rejectUser, revokeUser,
  findUserById, getAuditLog, getAuditLogFiltered, getAuditStats, updatePassword,
  listGroups, listLocations, getGroupsForUser, getLocationsForUser,
  removeAllGroupsFromUser, addUserToGroup,
  removeAllLocationsFromUser, addLocationToUser,
  listTechDocs, listProjects,
} from '../pgDb';

const router = Router();

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});

router.use(requireAdmin);
router.use(adminLimiter);

router.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', async (req, res) => {
  try {
    const [pendingUsers, allUsersRaw, drawings, projects, groups, stats] = await Promise.all([
      getPendingUsers(),
      getAllUsers(),
      listTechDocs(),
      listProjects(),
      listGroups(),
      getAuditStats(),
    ]);
    const allUsers = allUsersRaw.filter((u) => !u.isAdmin);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      pendingUsers,
      allUsers,
      drawingsCount: drawings.length,
      projectsCount: projects.length,
      groupsCount: groups.length,
      stats,
      user: req.user,
    });
  } catch (err) {
    console.error('[admin] GET /dashboard error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard.', user: req.user });
  }
});

router.post('/users/:id/approve', async (req, res) => {
  try {
    const userId = parseInt((req.params['id'] as string), 10);
    const notes = typeof req.body['notes'] === 'string' ? req.body['notes'].trim() : undefined;

    const target = await findUserById(userId);
    if (!target) {
      res.status(404).render('error', { title: 'Not Found', message: 'User not found.', user: req.user });
      return;
    }

    await approveUser(userId, req.user!.email, notes);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] POST /users/:id/approve error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to approve user.', user: req.user });
  }
});

router.post('/users/:id/reject', async (req, res) => {
  try {
    const userId = parseInt((req.params['id'] as string), 10);
    const notes = typeof req.body['notes'] === 'string' ? req.body['notes'].trim() : undefined;

    const target = await findUserById(userId);
    if (!target) {
      res.status(404).render('error', { title: 'Not Found', message: 'User not found.', user: req.user });
      return;
    }

    await rejectUser(userId, req.user!.email, notes);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] POST /users/:id/reject error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to reject user.', user: req.user });
  }
});

router.post('/users/:id/revoke', async (req, res) => {
  try {
    const userId = parseInt((req.params['id'] as string), 10);

    const target = await findUserById(userId);
    if (!target || target.isAdmin) {
      res.status(400).render('error', { title: 'Error', message: 'Cannot revoke access for this user.', user: req.user });
      return;
    }

    await revokeUser(userId);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] POST /users/:id/revoke error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to revoke user.', user: req.user });
  }
});

router.get('/audit', async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q['page'] || '1', 10));
    const pageSize = 50;
    const result = await getAuditLogFiltered({
      userEmail:  q['user']   || undefined,
      partNumber: q['part']   || undefined,
      action:     q['action'] || undefined,
      dateFrom:   q['from']   || undefined,
      dateTo:     q['to']     || undefined,
      sortBy:     (q['sort'] as 'accessed_at'|'user_email'|'part_number'|'action') || 'accessed_at',
      sortDir:    (q['dir'] as 'asc'|'desc') || 'desc',
      page,
      pageSize,
    });
    res.render('admin/audit', {
      title: 'Audit Log',
      ...result,
      filters: { user: q['user']||'', part: q['part']||'', action: q['action']||'', from: q['from']||'', to: q['to']||'' },
      sort: q['sort'] || 'accessed_at',
      dir:  q['dir']  || 'desc',
      user: req.user,
    });
  } catch (err) {
    console.error('[admin] GET /audit error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load audit log.', user: req.user });
  }
});

// CSV export – no pagination, returns all matching rows
router.get('/audit/export.csv', async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const result = await getAuditLogFiltered({
      userEmail:  q['user']   || undefined,
      partNumber: q['part']   || undefined,
      action:     q['action'] || undefined,
      dateFrom:   q['from']   || undefined,
      dateTo:     q['to']     || undefined,
      sortBy:     'accessed_at',
      sortDir:    'desc',
      page: 1,
      pageSize: 10000,
    });
    const lines = [
      'Timestamp,User,Part Number,Revision,Action',
      ...result.entries.map((e) =>
        `"${e.accessedAt}","${e.userEmail}","${e.partNumber}","${e.revision}","${e.action}"`
      ),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[admin] GET /audit/export.csv error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Stats JSON endpoint for live refresh
router.get('/analytics.json', async (_req, res) => {
  try {
    const stats = await getAuditStats();
    res.json(stats);
  } catch (err) {
    console.error('[admin] GET /analytics.json error:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

router.get('/profile', (req, res) => {
  res.render('admin/profile', { title: 'Change Password', error: null, success: false, user: req.user });
});

router.get('/users', async (req, res) => {
  try {
    const [allUsersRaw, groups, locations] = await Promise.all([getAllUsers(), listGroups(), listLocations()]);
    const allUsers = allUsersRaw.filter((u) => !u.isAdmin);

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

    res.render('admin/users', { title: 'Manage Users', users: usersWithDetails, groups, locations, user: req.user });
  } catch (err) {
    console.error('[admin] GET /users error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load users.', user: req.user });
  }
});

router.post('/users/:id/assign', async (req, res) => {
  try {
    const userId = parseInt((req.params['id'] as string), 10);
    const groupId = typeof req.body['groupId'] === 'string' && req.body['groupId'] ? req.body['groupId'] : null;
    const locationId = typeof req.body['locationId'] === 'string' && req.body['locationId'] ? req.body['locationId'] : null;

    const target = await findUserById(userId);
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

router.post('/profile', async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  const renderError = (error: string): void => {
    res.render('admin/profile', { title: 'Change Password', error, success: false, user: req.user });
  };

  if (!currentPassword || !newPassword || !confirmPassword) {
    renderError('All fields are required.');
    return;
  }

  try {
    const dbUser = await findUserById(req.user!.userId);
    if (!dbUser) { renderError('User not found.'); return; }

    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!valid) { renderError('Current password is incorrect.'); return; }

    if (newPassword.length < 8) { renderError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { renderError('New passwords do not match.'); return; }

    const hash = await bcrypt.hash(newPassword, 12);
    await updatePassword(req.user!.userId, hash);

    res.render('admin/profile', { title: 'Change Password', error: null, success: true, user: req.user });
  } catch (err) {
    console.error('[admin] POST /profile error:', err);
    renderError('An error occurred. Please try again.');
  }
});

export default router;

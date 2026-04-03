import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getAllProjects, getProjectById, getProjectPermissions, getAllGroups, getAllLocations, addProjectPermission, removeProjectPermission, getAllDrawings, type Drawing } from '../db';

const router = Router();

// Apply authentication to all routes
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /projects - list projects
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const q = (req.query['q'] as string) || '';
    let projects = getAllProjects();
    
    if (q) {
      projects = projects.filter(project => 
        project.name.toLowerCase().includes(q.toLowerCase()) ||
        (project.description && project.description.toLowerCase().includes(q.toLowerCase()))
      );
    }

    res.render('projects/index', {
      title: 'Manage Projects',
      user: req.user,
      projects,
      search: q
    });
  } catch (err) {
    console.error('[projects] GET / error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load projects.', 
      user: req.user 
    });
  }
});

// ---------------------------------------------------------------------------
// GET /projects/:id - project detail
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const projectId = parseInt(req.params.id as string);
    const project = getProjectById(projectId);
    
    if (!project) {
      res.status(404).render('error', {
        title: 'Project Not Found',
        message: 'The requested project does not exist.',
        user: req.user
      });
      return;
    }

    const permissions = getProjectPermissions(projectId);
    const groups = getAllGroups();
    const locations = getAllLocations();
    
    // Get drawings for this project
    const allDrawings = getAllDrawings();
    const projectDrawings = allDrawings.filter((d: Drawing) => d.projectId === projectId);

    res.render('projects/detail', {
      title: `Project: ${project.name}`,
      user: req.user,
      project,
      permissions,
      groups,
      locations,
      drawings: projectDrawings
    });
  } catch (err) {
    console.error('[projects] GET /:id error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load project.', 
      user: req.user 
    });
  }
});

// ---------------------------------------------------------------------------
// POST /projects/:id/permissions - add permission (admin only)
// ---------------------------------------------------------------------------
router.post('/:id/permissions', requireAdmin, (req, res) => {
  try {
    const projectId = parseInt(req.params.id as string);
    const { groupId, locationId, permissionType } = req.body as {
      groupId?: string;
      locationId?: string;
      permissionType?: string;
    };

    if (!groupId && !locationId) {
      res.status(400).json({ error: 'Either group or location must be specified' });
      return;
    }

    addProjectPermission(
      projectId, 
      groupId ? parseInt(groupId) : undefined, 
      locationId ? parseInt(locationId) : undefined, 
      permissionType || 'view'
    );

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error('[projects] POST /:id/permissions error:', err);
    res.status(500).json({ error: 'Failed to add permission.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id/permissions/:permissionId - remove permission (admin only)
// ---------------------------------------------------------------------------
router.delete('/:id/permissions/:permissionId', requireAdmin, (req, res) => {
  try {
    const permissionId = parseInt(req.params.permissionId as string);
    removeProjectPermission(permissionId);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[projects] DELETE /:id/permissions/:permissionId error:', err);
    res.status(500).json({ error: 'Failed to remove permission.' });
  }
});

export default router;
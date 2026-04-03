import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getAllProjects, getAllLocations, getAccessibleDrawings, getDrawingById, canUserAccessProject } from '../db';

const router = Router();

// Apply authentication to all routes
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /drawings - list drawings
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const q = (req.query['q'] as string) || '';
    let drawings = getAccessibleDrawings((req.user as any).userId);
    
    if (q) {
      drawings = drawings.filter(drawing => 
        drawing.name.toLowerCase().includes(q.toLowerCase()) ||
        (drawing.description && drawing.description.toLowerCase().includes(q.toLowerCase()))
      );
    }

    const projects = getAllProjects();
    const locations = getAllLocations();

    res.render('drawings/index', {
      title: 'Manage Drawings',
      user: req.user,
      drawings,
      search: q,
      projects,
      locations,
      selectedProject: '',
      selectedLocation: ''
    });
  } catch (err) {
    console.error('[drawings] GET / error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load drawings.', 
      user: req.user 
    });
  }
});

// ---------------------------------------------------------------------------
// GET /drawings/:id - drawing detail
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const drawingId = parseInt(req.params.id);
    const drawing = getDrawingById(drawingId);
    
    if (!drawing) {
      res.status(404).render('error', {
        title: 'Drawing Not Found',
        message: 'The requested drawing does not exist.',
        user: req.user
      });
      return;
    }

    // Check if user can access this drawing's project
    if (drawing.projectId && !canUserAccessProject((req.user as any).userId, drawing.projectId)) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to view this drawing.',
        user: req.user
      });
      return;
    }

    res.render('drawings/detail', {
      title: `Drawing: ${drawing.name}`,
      user: req.user,
      drawing,
      allProjects: getAllProjects()
    });
  } catch (err) {
    console.error('[drawings] GET /:id error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load drawing.', 
      user: req.user 
    });
  }
});

export default router;
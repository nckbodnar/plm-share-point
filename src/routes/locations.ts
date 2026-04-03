import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getAllLocations, getLocationById } from '../db';

const router = Router();

// Apply authentication to all routes
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /locations - list locations
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const q = (req.query['q'] as string) || '';
    let locations = getAllLocations();
    
    if (q) {
      locations = locations.filter(location => 
        location.name.toLowerCase().includes(q.toLowerCase()) ||
        location.type.toLowerCase().includes(q.toLowerCase()) ||
        (location.address && location.address.toLowerCase().includes(q.toLowerCase()))
      );
    }

    res.render('locations/index', {
      title: 'Manage Locations',
      user: req.user,
      locations,
      search: q
    });
  } catch (err) {
    console.error('[locations] GET / error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load locations.', 
      user: req.user 
    });
  }
});

// ---------------------------------------------------------------------------
// GET /locations/:id - location detail
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const location = getLocationById(locationId);
    
    if (!location) {
      res.status(404).render('error', {
        title: 'Location Not Found',
        message: 'The requested location does not exist.',
        user: req.user
      });
      return;
    }

    res.render('locations/detail', {
      title: `Location: ${location.name}`,
      user: req.user,
      location
    });
  } catch (err) {
    console.error('[locations] GET /:id error:', err);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Failed to load location.', 
      user: req.user 
    });
  }
});

export default router;
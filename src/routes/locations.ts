import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  createLocation,
  getLocation,
  listLocations,
  updateLocation,
  deleteLocation,
} from '../pgDb';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /locations - list all locations
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const locations = await listLocations();
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ locations });
      return;
    }
    res.render('locations/index', { title: 'Locations', locations, user: req.user });
  } catch (err) {
    console.error('[locations] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load locations.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// GET /locations/new - create form (admin only)
// ---------------------------------------------------------------------------
router.get('/new', requireAdmin, (req, res) => {
  res.render('locations/new', { title: 'New Location', user: req.user, error: null });
});

// ---------------------------------------------------------------------------
// POST /locations - create location (admin only)
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }
    const location = await createLocation({ name });
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.status(201).json({ location });
      return;
    }
    res.redirect('/locations');
  } catch (err) {
    console.error('[locations] POST / error:', err);
    res.status(500).json({ error: 'Failed to create location.' });
  }
});

// ---------------------------------------------------------------------------
// GET /locations/:id - location detail
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const location = await getLocation(String(req.params['id']));
    if (!location) {
      res.status(404).render('error', { title: 'Not Found', message: 'Location not found.', user: req.user });
      return;
    }
    const wantsJson = req.headers['accept']?.includes('application/json');
    if (wantsJson) {
      res.json({ location });
      return;
    }
    res.render('locations/detail', { title: location.name, location, user: req.user });
  } catch (err) {
    console.error('[locations] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load location.', user: req.user });
  }
});

// ---------------------------------------------------------------------------
// PUT /locations/:id - update location (admin only)
// ---------------------------------------------------------------------------
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }
    const location = await updateLocation(String(req.params['id']), name);
    if (!location) {
      res.status(404).json({ error: 'Location not found.' });
      return;
    }
    res.json({ location });
  } catch (err) {
    console.error('[locations] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update location.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /locations/:id - delete location (admin only)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteLocation(String(req.params['id']));
    if (!deleted) {
      res.status(404).json({ error: 'Location not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[locations] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete location.' });
  }
});

export default router;

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createLocation, getLocation, listLocations, updateLocation, deleteLocation } from '../pgDb';

const router = Router();
router.use(requireAuth);

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const locations = await listLocations();
    res.render('locations/index', { title: 'Locations', user: req.user, locations });
  } catch (err) {
    console.error('[locations] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load locations.', user: req.user });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', requireAdmin, (_req, res) => {
  res.render('locations/new', { title: 'New Location', user: _req.user, error: null });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as Record<string, string>;
    if (!name?.trim()) {
      res.status(400).render('locations/new', { title: 'New Location', user: req.user, error: 'Name is required.' });
      return;
    }
    await createLocation({ name: name.trim() });
    res.redirect('/locations');
  } catch (err) {
    console.error('[locations] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create location.', user: req.user });
  }
});

// ── Edit form ─────────────────────────────────────────────────────────────────
router.get('/:id/edit', requireAdmin, async (req, res) => {
  try {
    const location = await getLocation((req.params['id'] as string));
    if (!location) {
      res.status(404).render('error', { title: 'Not Found', message: 'Location not found.', user: req.user });
      return;
    }
    res.render('locations/edit', { title: 'Edit Location', user: req.user, location, error: null });
  } catch (_err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load location.', user: req.user });
  }
});

// ── Update (form POST) ────────────────────────────────────────────────────────
router.post('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as Record<string, string>;
    if (!name?.trim()) {
      const location = await getLocation((req.params['id'] as string));
      res.status(400).render('locations/edit', { title: 'Edit Location', user: req.user, location, error: 'Name is required.' });
      return;
    }
    await updateLocation((req.params['id'] as string), name.trim());
    res.redirect('/locations');
  } catch (_err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to update location.', user: req.user });
  }
});

// ── Update (PUT JSON) ─────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body as Record<string, string>;
    const updated = await updateLocation((req.params['id'] as string), name);
    if (!updated) { res.status(404).json({ error: 'Location not found' }); return; }
    res.json({ location: updated });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteLocation((req.params['id'] as string));
    if (!ok) { res.status(404).json({ error: 'Location not found' }); return; }
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

router.post('/:id/delete', requireAdmin, async (req, res) => {
  await deleteLocation((req.params['id'] as string));
  res.redirect('/locations');
});

export default router;

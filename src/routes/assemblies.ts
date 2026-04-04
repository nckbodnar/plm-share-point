import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listAssemblies, getDrawing, getAssemblyComponents,
  addComponentToAssembly, removeComponentFromAssembly,
  listDrawings, createDrawing, logAccess,
} from '../pgDb';

const router = Router();

const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});

router.use(requireAuth);

router.get('/', viewLimiter, async (req, res) => {
  try {
    const search = typeof req.query['q'] === 'string' ? req.query['q'].toLowerCase() : '';
    let assemblies = await listAssemblies();
    if (search) {
      assemblies = assemblies.filter(
        (a) => a.name.toLowerCase().includes(search) || (a.description ?? '').toLowerCase().includes(search),
      );
    }
    res.render('assemblies/index', { title: 'Assemblies', assemblies, search, user: req.user });
  } catch (err) {
    console.error('[assemblies] GET / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Could not retrieve assemblies.', user: req.user });
  }
});

router.get('/new', requireAdmin, async (req, res) => {
  try {
    const allDrawings = await listDrawings();
    res.render('assemblies/new', { title: 'New Assembly', user: req.user, allDrawings, error: null });
  } catch (_err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form.', user: req.user });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, revision } = req.body as Record<string, string>;
    if (!name?.trim()) {
      const allDrawings = await listDrawings();
      res.status(400).render('assemblies/new', { title: 'New Assembly', user: req.user, allDrawings, error: 'Name is required.' });
      return;
    }
    const drawing = await createDrawing({ name: name.trim(), description: description?.trim(), revision: revision?.trim() || 'A' });
    res.redirect(`/assemblies/${drawing.id}`);
  } catch (err) {
    console.error('[assemblies] POST / error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to create assembly.', user: req.user });
  }
});

router.get('/:id', viewLimiter, async (req, res) => {
  try {
    const assembly = await getDrawing((req.params['id'] as string));
    if (!assembly) {
      res.status(404).render('error', { title: 'Not Found', message: 'Assembly not found.', user: req.user });
      return;
    }

    const components = await getAssemblyComponents(assembly.id);
    const allDrawings = req.user!.isAdmin ? await listDrawings() : [];

    await logAccess({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      partId: assembly.id,
      partNumber: assembly.name,
      revision: assembly.revision,
      action: 'view_assembly',
      accessedAt: new Date().toISOString(),
    });

    res.render('assemblies/detail', {
      title: `Assembly: ${assembly.name}`,
      assembly,
      components,
      allDrawings,
      user: req.user,
    });
  } catch (err) {
    console.error('[assemblies] GET /:id error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Could not retrieve assembly.', user: req.user });
  }
});

router.post('/:id/components', requireAdmin, async (req, res) => {
  try {
    const { childId, quantity, referenceDesignator } = req.body as Record<string, string>;
    if (!childId) { res.redirect(`/assemblies/${req.params['id']}`); return; }
    await addComponentToAssembly(
      (req.params['id'] as string),
      childId,
      parseInt(quantity || '1', 10),
      referenceDesignator?.trim() || undefined,
    );
    res.redirect(`/assemblies/${req.params['id']}`);
  } catch (err) {
    console.error('[assemblies] POST /:id/components error:', err);
    res.status(500).json({ error: 'Failed to add component.' });
  }
});

router.delete('/:id/components/:childId', requireAdmin, async (req, res) => {
  try {
    await removeComponentFromAssembly((req.params['id'] as string), (req.params['childId'] as string));
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to remove component.' });
  }
});

router.post('/:id/components/:childId/delete', requireAdmin, async (req, res) => {
  await removeComponentFromAssembly((req.params['id'] as string), (req.params['childId'] as string));
  res.redirect(`/assemblies/${req.params['id']}`);
});

router.get('/:id/bom.json', viewLimiter, async (req, res) => {
  try {
    const assembly = await getDrawing((req.params['id'] as string));
    if (!assembly) { res.status(404).json({ error: 'Assembly not found.' }); return; }
    const components = await getAssemblyComponents(assembly.id);

    const nodes = [
      {
        id: 'root',
        type: 'default',
        position: { x: 400, y: 20 },
        data: {
          label: `${assembly.name}\nRev ${assembly.revision}`,
          name: assembly.name,
          revision: assembly.revision,
          isRoot: true,
        },
      },
      ...components.map((c, i) => ({
        id: `part-${c.id}`,
        type: 'default',
        position: { x: i * 220, y: 160 },
        data: {
          label: `${c.name}\nRev ${c.revision}`,
          name: c.name,
          partId: c.id,
          revision: c.revision,
          quantity: c.quantity,
          referenceDesignator: c.referenceDesignator,
          isRoot: false,
        },
      })),
    ];

    const edges = components.map((c) => ({
      id: `e-root-${c.id}`,
      source: 'root',
      target: `part-${c.id}`,
      label: c.referenceDesignator ? `${c.referenceDesignator} × ${c.quantity}` : `× ${c.quantity}`,
    }));

    res.json({ nodes, edges });
  } catch (err) {
    console.error('[assemblies] GET /:id/bom.json error:', err);
    res.status(500).json({ error: 'Could not build BOM data.' });
  }
});

export default router;

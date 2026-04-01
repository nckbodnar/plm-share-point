import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { getPlmService } from '../services/plmService';
import { logAccess } from '../db';

const router = Router();

const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.',
});

router.use(requireAuth);

// GET /assemblies – list all released assemblies
router.get('/', viewLimiter, async (req, res) => {
  try {
    const assemblies = await getPlmService().getAssemblies();
    const search = typeof req.query['q'] === 'string' ? req.query['q'].toLowerCase() : '';

    const filtered = search
      ? assemblies.filter(
          (a) =>
            a.assemblyNumber.toLowerCase().includes(search) ||
            a.name.toLowerCase().includes(search) ||
            (a.description ?? '').toLowerCase().includes(search),
        )
      : assemblies;

    res.render('assemblies/index', {
      title: 'Assemblies',
      assemblies: filtered,
      search,
      user: req.user,
    });
  } catch (err) {
    console.error('[assemblies] Error fetching assemblies:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not retrieve assemblies from the PLM system.',
      user: req.user,
    });
  }
});

// GET /assemblies/:id – BOM tree view for a single assembly
router.get('/:id', viewLimiter, async (req, res) => {
  try {
    const assembly = await getPlmService().getAssemblyById(String(req.params['id']));

    logAccess({
      userId: req.user!.userId,
      userEmail: req.user!.email,
      partId: assembly.id,
      partNumber: assembly.assemblyNumber,
      revision: assembly.latestRevision.revision,
      action: 'view_assembly',
      accessedAt: new Date().toISOString(),
    });

    res.render('assemblies/detail', {
      title: `${assembly.assemblyNumber} – ${assembly.name}`,
      assembly,
      user: req.user,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).render('error', {
        title: 'Not Found',
        message: 'The requested assembly was not found or is not in a Released state.',
        user: req.user,
      });
      return;
    }
    console.error('[assemblies] Error fetching assembly detail:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not retrieve assembly data from the PLM system.',
      user: req.user,
    });
  }
});

// GET /assemblies/:id/bom.json – JSON BOM data for ReactFlow
router.get('/:id/bom.json', viewLimiter, async (req, res) => {
  try {
    const assembly = await getPlmService().getAssemblyById(String(req.params['id']));

    const revisionParam = typeof req.query['rev'] === 'string' ? req.query['rev'] : null;
    const revision =
      revisionParam && assembly.previousRevision?.revision === revisionParam
        ? assembly.previousRevision
        : assembly.latestRevision;

    // Build ReactFlow nodes + edges
    const nodes = [
      {
        id: 'root',
        type: 'default',
        position: { x: 400, y: 20 },
        data: {
          label: `${assembly.assemblyNumber}\n${assembly.name}\nRev ${revision.revision}`,
          assemblyNumber: assembly.assemblyNumber,
          name: assembly.name,
          revision: revision.revision,
          lifecycleState: assembly.lifecycleState,
          isRoot: true,
        },
      },
      ...revision.components.map((c, i) => ({
        id: `part-${c.part.id}`,
        type: 'default',
        position: { x: i * 220, y: 160 },
        data: {
          label: `${c.part.partNumber}\n${c.part.name}\nRev ${c.part.latestRevision.revision}`,
          partNumber: c.part.partNumber,
          name: c.part.name,
          partId: c.part.id,
          revision: c.part.latestRevision.revision,
          lifecycleState: c.part.lifecycleState,
          quantity: c.quantity,
          referenceDesignator: c.referenceDesignator,
          documentId: c.part.latestRevision.documentId,
          isRoot: false,
        },
      })),
    ];

    const edges = revision.components.map((c) => ({
      id: `e-root-${c.part.id}`,
      source: 'root',
      target: `part-${c.part.id}`,
      label: c.referenceDesignator
        ? `${c.referenceDesignator} × ${c.quantity}`
        : `× ${c.quantity}`,
    }));

    res.json({ nodes, edges });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).json({ error: 'Assembly not found.' });
      return;
    }
    console.error('[assemblies] Error building BOM JSON:', err);
    res.status(500).json({ error: 'Could not build BOM data.' });
  }
});

export default router;

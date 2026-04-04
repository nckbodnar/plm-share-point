import { Router } from 'express';

const router = Router();

router.use('/', (req, res) => {
  const target = req.url === '/' ? '/drawings' : `/drawings${req.url}`;
  res.redirect(301, target);
});

export default router;

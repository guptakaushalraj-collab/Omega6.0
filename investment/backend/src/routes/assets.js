import { Router } from 'express';
import { latestPrices, listAssets, recordPrice, upsertAsset } from '../services/repository.js';
import { validateAsset, validatePrice } from '../services/validate.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ assets: listAssets(), prices: latestPrices() });
});

router.post('/', (req, res) => {
  const problem = validateAsset(req.body);
  if (problem) return res.status(400).json({ error: problem });
  return res.status(201).json({ asset: upsertAsset(req.body) });
});

router.post('/:id/prices', (req, res) => {
  const input = {
    asset_id: req.params.id,
    as_of: req.body?.as_of || new Date().toISOString().slice(0, 10),
    close: req.body?.close,
  };
  const problem = validatePrice(input);
  if (problem) return res.status(400).json({ error: problem });
  const price = recordPrice(input);
  return res.status(201).json({ price });
});

export default router;

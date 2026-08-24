import { Router } from 'express';
import {
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  upsertPortfolio,
} from '../services/repository.js';
import { validatePortfolio } from '../services/validate.js';
import { byAssetClass, holdingsFor, summarize } from '../services/valuation.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ portfolios: listPortfolios() });
});

router.post('/', (req, res) => {
  const problem = validatePortfolio(req.body);
  if (problem) return res.status(400).json({ error: problem });
  return res.status(201).json({ portfolio: upsertPortfolio(req.body) });
});

router.get('/:id', (req, res) => {
  const portfolio = getPortfolio(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'portfolio not found' });
  return res.json({ portfolio });
});

router.put('/:id', (req, res) => {
  if (!getPortfolio(req.params.id)) return res.status(404).json({ error: 'portfolio not found' });
  return res.json({ portfolio: upsertPortfolio({ ...req.body, id: req.params.id }) });
});

router.delete('/:id', (req, res) => {
  if (!deletePortfolio(req.params.id)) return res.status(404).json({ error: 'portfolio not found' });
  return res.status(204).end();
});

router.get('/:id/holdings', (req, res) => {
  if (!getPortfolio(req.params.id)) return res.status(404).json({ error: 'portfolio not found' });
  const positions = holdingsFor(req.params.id);
  return res.json({
    holdings: positions,
    summary: summarize(positions),
    allocation: byAssetClass(positions),
  });
});

export default router;

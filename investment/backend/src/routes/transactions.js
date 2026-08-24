import { Router } from 'express';
import {
  deleteTransaction,
  getTransaction,
  listTransactions,
  upsertTransaction,
} from '../services/repository.js';
import { validateTransaction } from '../services/validate.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    transactions: listTransactions({
      portfolioId: req.query.portfolio_id,
      limit: Math.min(Number(req.query.limit) || 500, 5000),
    }),
  });
});

router.post('/', (req, res) => {
  const problem = validateTransaction(req.body);
  if (problem) return res.status(400).json({ error: problem });
  return res.status(201).json({ transaction: upsertTransaction(req.body) });
});

router.put('/:id', (req, res) => {
  if (!getTransaction(req.params.id)) return res.status(404).json({ error: 'transaction not found' });
  const problem = validateTransaction(req.body);
  if (problem) return res.status(400).json({ error: problem });
  return res.json({ transaction: upsertTransaction({ ...req.body, id: req.params.id }) });
});

router.delete('/:id', (req, res) => {
  if (!deleteTransaction(req.params.id)) {
    return res.status(404).json({ error: 'transaction not found' });
  }
  return res.status(204).end();
});

export default router;

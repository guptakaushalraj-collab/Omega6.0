import { Router } from 'express';
import { SUPPORTED_OPERATIONS, SyncError, applyOperations, changes, snapshot } from '../services/sync.js';

const router = Router();

router.get('/snapshot', (req, res) => {
  res.json(snapshot());
});

router.get('/changes', (req, res) => {
  res.json(changes(req.query.since));
});

router.post('/', (req, res, next) => {
  const { operations, client_id: clientId } = req.body ?? {};
  try {
    const results = applyOperations(operations, clientId);
    const rejected = results.filter((result) => result.status === 'rejected').length;
    // 207 tells the client "read every result" — a partially applied queue is
    // the normal case after a long offline stretch, not an error.
    res.status(rejected ? 207 : 200).json({
      applied: results.filter((r) => r.status === 'applied' && !r.duplicate).length,
      duplicates: results.filter((r) => r.duplicate).length,
      rejected,
      seq: changes(0).seq,
      results,
    });
  } catch (error) {
    if (error instanceof SyncError) {
      return res.status(error.status).json({ error: error.message, supported: SUPPORTED_OPERATIONS });
    }
    return next(error);
  }
});

export default router;

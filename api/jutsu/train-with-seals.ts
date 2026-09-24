import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';

/**
 * RETIRED instant Honor Seal level (2026-09-24).
 *
 * This used to raise a jutsu one level (30→40) the moment Seals were paid,
 * gated only by a 1-per-30s rate limit. Seal levels are now TIMED LESSONS: the
 * same 30-minute lesson, the same one-active + one-queued slots, and the same
 * speed-up / finish-now paths as ryo training, bought through
 * POST /api/training/jutsu-ryo with `payWith: 'honorSeals'` (see
 * api/training/_jutsu-ryo.ts, startJutsuSealTraining).
 *
 * The route stays registered so a client from before the change gets a clear
 * refusal instead of a 404, and so nothing can take the instant path around the
 * lesson timer. It never touches the save.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    return res.status(410).json({
        error: 'Honor Seal training is now a timed lesson. Refresh the page, then start it from the Jutsu Training Hall.',
        code: 'SEAL_TRAINING_IS_A_LESSON',
    });
}

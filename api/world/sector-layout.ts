import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { sectorModelDisplayEnabled, sectorObstaclesEnabled, sectorPlayerGaitsEnabled } from '../_release-flags.js';
import { r2PublicUrl } from '../_r2.js';
import { modelCreationPolicy } from '../avatar-model/_admission.js';

/** Public presentation metadata. No saves, rewards, or account data. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    res.setHeader('Cache-Control', 'no-store');
    const modelArtBase = sectorModelDisplayEnabled() ? r2PublicUrl('sector-models') : null;
    return res.status(200).json({ obstaclesEnabled: sectorObstaclesEnabled(),
        modelArtBase,
        ...(process.env.AVATAR_MODEL_PROFILE_DETAIL_ENABLED === '1' ? {profileDetailUploads:true} : {}),
        ...(modelCreationPolicy().enabled ? { worldModelCreationAvailable: true } : {}),
        playerGaitsEnabled: modelArtBase !== null && sectorPlayerGaitsEnabled() });
}

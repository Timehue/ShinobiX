import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { normalizeTitleKey } from '../_titles-registry.js';
import { acknowledgePlayRewardPurchase, consumePlayRewardPurchase, verifyPlayRewardPurchase } from './_google-publisher.js';
import { claimPlayGamesReward, PlayRewardClaimError, type PlayRewardClaimDependencies, type PlayRewardReceipt } from './_rewards-core.js';

const defaultDependencies: PlayRewardClaimDependencies = {
    getReceipt: (key) => kv.get<PlayRewardReceipt>(key),
    setReceipt: (key, value) => kv.set(key, value),
    withLock: (key, action) => withKvLock(key, action, {
        ttlSec: 45,
        maxAttempts: 8,
        baseBackoffMs: 30,
        failClosed: true,
    }),
    verifyPurchase: verifyPlayRewardPurchase,
    acknowledgePurchase: acknowledgePlayRewardPurchase,
    consumePurchase: consumePlayRewardPurchase,
    grantTitle: async (playerName, title) => {
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const serverTitles = Array.isArray(character.serverTitles)
                ? character.serverTitles.filter((value): value is string => typeof value === 'string')
                : [];
            const alreadyOwned = serverTitles.some((owned) => normalizeTitleKey(owned) === normalizeTitleKey(title));
            if (alreadyOwned) {
                return { ok: true as const, character, value: { alreadyOwned: true }, write: false };
            }
            return {
                ok: true as const,
                character: { ...character, serverTitles: [...serverTitles, title] },
                value: { alreadyOwned: false },
            };
        });
        if (!result.ok) return result;
        return {
            ok: true,
            alreadyOwned: result.value.alreadyOwned,
            character: result.character,
            saveVersion: result._saveVersion,
        };
    },
    grantRyo: async (playerName, amount, purchaseDigest) => {
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.playRewardPurchaseReceipts)
                ? character.playRewardPurchaseReceipts.filter((value): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
                : [];
            if (receipts.includes(purchaseDigest)) {
                return { ok: true as const, character, value: { alreadyOwned: true }, write: false };
            }
            const balance = Math.max(0, Math.floor(Number(character.ryo) || 0));
            return {
                ok: true as const,
                character: {
                    ...character,
                    ryo: Math.min(Number.MAX_SAFE_INTEGER, balance + amount),
                    // Permanent hash receipts stay co-written with the credit.
                    // Play Console limits this repeatable offer to one per week.
                    playRewardPurchaseReceipts: [...receipts, purchaseDigest],
                },
                value: { alreadyOwned: false },
            };
        });
        if (!result.ok) return result;
        return {
            ok: true,
            alreadyOwned: result.value.alreadyOwned,
            character: result.character,
            saveVersion: result._saveVersion,
        };
    },
};

export function createPlayRewardClaimHandler(
    dependencies: PlayRewardClaimDependencies = defaultDependencies,
    authenticate: (req: VercelRequest, name: string) => Promise<string | null> = authedPlayer,
    rateLimit: (req: VercelRequest, res: VercelResponse, name: string) => Promise<boolean> =
        (req, res, name) => enforceRateLimitKv(req, res, 'play-reward-claim', 12, 60_000, name),
) {
    return async function playRewardClaimHandler(req: VercelRequest, res: VercelResponse) {
        cors(res, req);
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).end();
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
            const playerName = safeName(String(body.playerName ?? ''));
            if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
            const identity = await authenticate(req, playerName);
            if (!identity) return res.status(401).json({ error: 'Sign in to claim this Play reward.' });
            if (identity !== playerName) return res.status(403).json({ error: 'Claim the reward for the currently signed-in shinobi.' });
            if (!(await rateLimit(req, res, identity))) return;
            if (!String(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? '').trim()) {
                return res.status(503).json({ error: 'Play reward delivery is not configured yet.' });
            }

            const result = await claimPlayGamesReward({
                playerName: identity,
                productId: String(body.productId ?? ''),
                purchaseToken: String(body.purchaseToken ?? ''),
            }, dependencies);
            return res.status(200).json({ ok: true, ...result });
        } catch (error) {
            if (error instanceof PlayRewardClaimError) return res.status(error.status).json({ error: error.message });
            console.error('[play/reward-claim]', safeLogValue(error));
            return res.status(503).json({ error: 'Play reward delivery is temporarily unavailable. Please retry.' });
        }
    };
}

export default createPlayRewardClaimHandler();

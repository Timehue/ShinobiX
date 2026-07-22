import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { aiFightTokenKey, cleanAiFightToken, type AiFightToken } from '../missions/_ai-fight-token.js';
import { cashOutEndless, recordEndlessWin, startEndlessRun, type EndlessRun } from './_run.js';

const cleanToken = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9]{16,96}$/.test(v) ? v : '';
const dayKey = () => new Date().toISOString().slice(0, 10);
type EndlessReceipt = { key: string; action: 'win' | 'cashout' | 'abandon'; reward?: { ryo: number; xp: number }; milestone?: { boneCharms: number; fateShards: number }; creditedXp?: number; creditedRyo?: number };
type EndlessAction = 'start' | EndlessReceipt['action'];
const receiptsOf = (character: Record<string, unknown>): EndlessReceipt[] => Array.isArray(character.redeemedEndlessActions)
    ? (character.redeemedEndlessActions as EndlessReceipt[]).filter((entry) => entry && typeof entry.key === 'string').slice(-128)
    : [];
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const actionRaw = String(body.action ?? '');
        if (!playerName || !['start', 'win', 'cashout', 'abandon'].includes(actionRaw)) return res.status(400).json({ error: 'Invalid Endless Tower request.' });
        const action = actionRaw as EndlessAction;
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your tower run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'endless-run', 40, 60_000, identity.name))) return;
        let spentAiToken = '';
        const result = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ character }) => {
            if (action === 'start') {
                const started = startEndlessRun(character, randomUUID().replace(/-/g, ''), dayKey());
                if (!started.ok) return { ok: false as const, status: 409, error: started.reason };
                return { ok: true as const, character: started.character, value: { run: started.run, resumed: started.resumed, cost: started.cost } };
            }
            const runToken = cleanToken(body.runToken);
            const receipts = receiptsOf(character);
            const requestedKey = action === 'win' ? cleanAiFightToken(body.aiFightToken) : runToken;
            const replay = requestedKey ? receipts.find((entry) => entry.key === requestedKey && entry.action === action) : undefined;
            if (replay) {
                const replayRun = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun as Record<string, unknown> : undefined;
                return { ok: true as const, character, value: action === 'win'
                    ? { reward: replay.reward, milestone: replay.milestone, run: replayRun, replayed: true }
                    : { creditedXp: replay.creditedXp, creditedRyo: replay.creditedRyo, abandoned: action === 'abandon', replayed: true } };
            }
            const run = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun as EndlessRun : null;
            if (!run || !runToken || run.runToken !== runToken) return { ok: false as const, status: 409, error: 'invalid-or-spent-endless-run' };
            if (action === 'cashout') {
                const paid = cashOutEndless(character, run, dayKey());
                const receipt: EndlessReceipt = { key: runToken, action, creditedXp: paid.creditedXp, creditedRyo: paid.creditedRyo };
                return { ok: true as const, character: { ...paid.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) }, value: { creditedXp: paid.creditedXp, creditedRyo: paid.creditedRyo } };
            }
            if (action === 'abandon') {
                const receipt: EndlessReceipt = { key: runToken, action };
                return { ok: true as const, character: { ...character, endlessTowerRun: null, redeemedEndlessActions: [...receipts, receipt].slice(-128), ...(body.death === true ? { hp: 0, hospitalized: true } : {}) }, value: { abandoned: true } };
            }
            const aiFightToken = cleanAiFightToken(body.aiFightToken); if (!aiFightToken) return { ok: false as const, status: 409, error: 'missing-ai-fight-token' };
            const proof = await kv.get<AiFightToken>(aiFightTokenKey(playerName, aiFightToken));
            const wave = Math.max(0, Math.floor(Number(body.wave) || 0));
            if (!proof || proof.playerName.toLowerCase() !== playerName.toLowerCase() || proof.battleKind !== 'endless'
                || !String(proof.opponentId ?? '').endsWith(`-w${wave}`)) return { ok: false as const, status: 409, error: 'invalid-endless-win-proof' };
            const won = recordEndlessWin(character, run, wave, { hp: body.hp, chakra: body.chakra, stamina: body.stamina });
            if (!won) return { ok: false as const, status: 409, error: 'unexpected-endless-wave' };
            spentAiToken = aiFightToken;
            const receipt: EndlessReceipt = { key: aiFightToken, action, reward: won.reward, milestone: won.milestone };
            const committed = { ...won.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) };
            return { ok: true as const, character: committed, value: { reward: won.reward, milestone: won.milestone, run: committed.endlessTowerRun as Record<string, unknown> } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (spentAiToken) await kv.del(aiFightTokenKey(playerName, spentAiToken)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[endless/run]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}

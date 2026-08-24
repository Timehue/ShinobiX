import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    villageWarSlug,
    STRUCTURE_KEYS,
} from '../_war-state.js';
import { applyStructureUpgrade, applyPerWarStructureUpgrade, isPerWarStructure, STRUCTURE_DEFS } from '../_war-structures.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';
import { villageWarMapEnabled, villageStoresEnabled } from '../_release-flags.js';
import { appendStoresLedger, readStores, structureMaterialsCost, STRUCTURE_HERALD_MIN_LEVEL } from '../_village-stores.js';
import { announce } from '../_announce.js';
import { completeEconomyTx, failEconomyTx, makeEconomyTxId, markEconomyTx, reserveEconomyTx, type EconomyTxState } from '../_economy-tx.js';

/*
 * /api/village/war-structure — POST only
 *
 * Server-authoritative upgrade of a SHARED village-level war structure (§7, §17.4).
 * Only the seated Kage (or admin) may upgrade; the cost is Honor Seals taken from
 * the village TREASURY (not the player), recomputed server-side from the sealed
 * cost curve. The treasury debit and the structure level-up happen together under
 * locks (treasury outer, war-record inner, both failClosed), and the debit is
 * COMMITTED FIRST behind an _economy-tx journal row, so a failure between the two
 * writes can never grant a free structure — only leave a payment the reconciler
 * can see (api/admin/economy-reconcile.ts).
 *
 * Server-gated: returns 404 when the default-on Sector Map campaign is disabled.
 *
 * Body: { playerName, village, structure }.
 *
 * Village Stores materials gate: raising a PERMANENT structure to L6..L10
 * additionally debits treasury.materialPoints (400 / 700 / 1,100 / 1,600 /
 * 2,400); short → 402 { error: 'materials-required', need, have }. Seal cost
 * unchanged; levels ≤ 5 unchanged. L8+ heralds 'high'. Off with the stores switch.
 *
 * Every refusal carries BOTH `error` (the machine code, unchanged) and `message`
 * (the sentence the clients render) — see structureUpgradeErrorMessage.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village: string): string {
    return `${VILLAGE_STATE_PREFIX}${villageWarSlug(village)}`;
}
// Kage seat key — note the seat uses a DIFFERENT slug (spaces→dashes), matching
// api/village/kage.ts.
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Player-facing sentence for an upgrade refusal.
 *
 * The `error` field stays the MACHINE CODE (callers and the endpoint contract
 * tests key off it); `message` is what a Kage actually reads. Before this, the
 * War Map and the Town Hall both printed the raw code, so a short treasury
 * literally said "insufficient-seals".
 *
 * CANONICAL TERMINOLOGY: Materials, counted in "materials" — never "material
 * points", "craft points" or "pts".
 */
export function structureUpgradeErrorMessage(
    code: string,
    opts: { structure?: string; cost?: number; need?: number; have?: number } = {},
): string {
    const amount = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0)).toLocaleString('en-US');
    const structureName = STRUCTURE_DEFS[opts.structure as keyof typeof STRUCTURE_DEFS]?.name ?? 'That structure';
    switch (code) {
        case 'insufficient-seals':
            return `The treasury is short — ${amount(opts.cost)} Honor Seals needed.`;
        case 'insufficient-wr':
            return `The war pool is short — ${amount(opts.cost)} War Resources needed.`;
        case 'materials-required':
            return `The stores are short — ${amount(opts.need)} materials needed, and ${amount(opts.have)} are stocked.`;
        case 'max-level':
            return `${structureName} is already at its maximum level.`;
        case 'unknown-structure':
        case 'not-per-war':
            return `${structureName} cannot be raised here.`;
        default:
            return `${structureName} could not be raised right now — try again in a moment.`;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

    // Journal for the seals path (see the debit-before-grant note below).
    let txId = '';
    let txState: EconomyTxState | '' = '';
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const structure = String(body.structure ?? '');
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
        if (!(STRUCTURE_KEYS as readonly string[]).includes(structure)) return res.status(400).json({ error: 'Unknown structure.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-structure', 20, 60_000, identity.name))) return;

        // Only the seated Kage (or admin) may upgrade.
        if (!identity.admin) {
            const kageState = await kv.get<{ seatedKage?: string }>(kageKey(village));
            if (safeName(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can upgrade village structures.' });
            }
        }

        const stateKey = villageStateKey(village);
        const warKey = villageWarKey(village);

        // Two funding paths: PER-WAR structures (Ramparts/Watchtower) are bought with
        // WR from the war pool (under the war-record lock only — WR lives on the
        // record); PERMANENT structures are bought with treasury Honor Seals (treasury
        // lock outer, war-record inner, debit-before-credit). Both failClosed.
        const result = isPerWarStructure(structure)
            ? await withKvLock(warKey, async () => {
                const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
                const up = applyPerWarStructureUpgrade(record, structure);
                if (!up.ok) return { ok: false as const, error: up.error, cost: up.cost };
                await kv.set(warKey, up.record);
                return { ok: true as const, structure, newLevel: up.newLevel, cost: up.cost, currency: 'wr' as const, remainingWr: up.record!.warResources };
            }, { failClosed: true })
            : await withKvLock(stateKey, async () => {
                const state = (await kv.get<Record<string, unknown>>(stateKey)) ?? {};
                const treasury = (state.treasury ?? {}) as Record<string, unknown>;
                const seals = num(treasury.honorSeals);
                return await withKvLock(warKey, async () => {
                    const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
                    const up = applyStructureUpgrade(record, seals, structure);
                    if (!up.ok) return { ok: false as const, error: up.error, cost: up.cost };
                    // Village Stores materials gate (L6..L10).
                    const storesOn = villageStoresEnabled();
                    const need = storesOn ? structureMaterialsCost(up.newLevel!) : 0;
                    const { materialPoints: have } = readStores(treasury);
                    if (need > have) return { ok: false as const, error: 'materials-required' as const, cost: up.cost, need, have };
                    const nextRecord = need > 0
                        ? { ...up.record!, storesLedger: appendStoresLedger(up.record!.storesLedger, [{ at: Date.now(), kind: 'structure' as const, amount: need, by: playerName, ref: `${structure}:${up.newLevel}` }]) }
                        : up.record!;
                    // DEBIT BEFORE GRANT, journalled (the shape api/village/treasury/donate.ts
                    // uses). The treasury write used to come SECOND, so a failure between the
                    // two writes minted a free L6..L10 structure — up to 2,400 materials plus
                    // its seal cost — out of nothing. Now the only thing a mid-way failure can
                    // cost is the payment (recoverable, and visible to the economy reconciler
                    // as a `needs-reconcile` row), never a free structure.
                    txId = makeEconomyTxId('village-war-structure');
                    await reserveEconomyTx({
                        id: txId,
                        kind: 'village-war-structure',
                        debitKey: stateKey,
                        creditKey: warKey,
                        resource: 'honorSeals',
                        amount: up.cost ?? 0,
                        meta: { village, structure, level: up.newLevel, materials: need, by: playerName },
                    });
                    txState = 'reserved';
                    await kv.set(stateKey, { ...state, treasury: { ...treasury, honorSeals: up.nextSeals, ...(need > 0 ? { materialPoints: have - need } : {}) } });
                    await markEconomyTx(txId, 'debit-applied');
                    txState = 'debit-applied';
                    await kv.set(warKey, nextRecord);
                    await completeEconomyTx(txId);
                    txState = 'complete';
                    return { ok: true as const, structure, newLevel: up.newLevel, cost: up.cost, currency: 'seals' as const, remainingSeals: up.nextSeals, materialsSpent: need, remainingMaterialPoints: have - need };
                }, { failClosed: true });
            }, { failClosed: true });

        if (!result.ok) {
            const status = (result.error === 'insufficient-seals' || result.error === 'insufficient-wr' || result.error === 'materials-required') ? 402 : result.error === 'max-level' ? 409 : 400;
            const need = 'need' in result ? result.need : undefined;
            const have = 'have' in result ? result.have : undefined;
            return res.status(status).json({
                error: result.error,
                // Humanised twin of `error` — the clients render this, so a refusal
                // never surfaces a machine code to the Kage. `error` is unchanged so
                // machine callers and the endpoint contract tests keep working.
                message: structureUpgradeErrorMessage(String(result.error ?? ''), { structure, cost: result.cost, need, have }),
                cost: result.cost,
                ...('need' in result ? { need: result.need, have: result.have } : {}),
            });
        }
        // World Herald for a major (L8+) permanent structure. Receipt = village/structure/level.
        if (!isPerWarStructure(structure) && (result.newLevel ?? 0) >= STRUCTURE_HERALD_MIN_LEVEL) {
            const name = STRUCTURE_DEFS[structure as keyof typeof STRUCTURE_DEFS]?.name ?? structure;
            void announce({
                type: 'village_structure_raised', importance: 'high',
                title: `${village} raised its ${name} to level ${result.newLevel}`,
                message: `${village}'s quartermasters finished the ${name} at level ${result.newLevel}.`,
                village, meta: { structure, level: result.newLevel },
            }, { receiptId: `structure-raised:${villageWarSlug(village)}:${structure}:${result.newLevel}` });
        }
        // Telemetry (best-effort): the currency spent upgrading a war structure.
        void recordWarEcoEvent({ eventId: `structure:${villageWarSlug(village)}:${structure}:${result.newLevel}`, village, kind: isPerWarStructure(structure) ? 'wr.spend.structure' : 'seals.spend.structure', amount: result.cost ?? 0, meta: structure });
        return res.status(200).json(result);
    } catch (err) {
        // A reserved/debited-but-unfinished purchase is parked for the economy
        // reconciler rather than silently swallowed.
        if (txId && txState && txState !== 'complete') {
            await failEconomyTx(txId, err, { note: 'seals/materials debited; structure level NOT granted' }).catch(() => undefined);
        }
        console.error('[village/war-structure]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

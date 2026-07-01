"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
const _war_state_js_1 = require("../_war-state.js");
const _war_structures_js_1 = require("../_war-structures.js");
const _war_telemetry_js_1 = require("../_war-telemetry.js");
/*
 * /api/village/war-structure — POST only
 *
 * Server-authoritative upgrade of a SHARED village-level war structure (§7, §17.4).
 * Only the seated Kage (or admin) may upgrade; the cost is Honor Seals taken from
 * the village TREASURY (not the player), recomputed server-side from the sealed
 * cost curve. The treasury debit and the structure level-up happen together under
 * locks (treasury outer, war-record inner, both failClosed) so seals can't be
 * spent without the level applying, and vice-versa.
 *
 * Server-gated: returns 404 unless ENABLE_VILLAGE_WAR=1 — the whole feature is OFF
 * by default, so this endpoint is inert until launch.
 *
 * Body: { playerName, village, structure }.
 */
const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village) {
    return `${VILLAGE_STATE_PREFIX}${(0, _war_state_js_1.villageWarSlug)(village)}`;
}
// Kage seat key — note the seat uses a DIFFERENT slug (spaces→dashes), matching
// api/village/kage.ts.
function kageKey(village) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return res.status(404).json({ error: 'Not found.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const structure = String(body.structure ?? '');
        if (!playerName || !village)
            return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
            return res.status(400).json({ error: 'Not a war village.' });
        if (!_war_state_js_1.STRUCTURE_KEYS.includes(structure))
            return res.status(400).json({ error: 'Unknown structure.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-war-structure', 20, 60_000, identity.name)))
            return;
        // Only the seated Kage (or admin) may upgrade.
        if (!identity.admin) {
            const kageState = await _storage_js_1.kv.get(kageKey(village));
            if ((0, _utils_js_1.safeName)(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can upgrade village structures.' });
            }
        }
        const stateKey = villageStateKey(village);
        const warKey = (0, _war_state_js_1.villageWarKey)(village);
        // Two funding paths: PER-WAR structures (Ramparts/Watchtower) are bought with
        // WR from the war pool (under the war-record lock only — WR lives on the
        // record); PERMANENT structures are bought with treasury Honor Seals (treasury
        // lock outer, war-record inner, debit-before-credit). Both failClosed.
        const result = (0, _war_structures_js_1.isPerWarStructure)(structure)
            ? await (0, _lock_js_1.withKvLock)(warKey, async () => {
                const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(warKey)) ?? undefined);
                const up = (0, _war_structures_js_1.applyPerWarStructureUpgrade)(record, structure);
                if (!up.ok)
                    return { ok: false, error: up.error, cost: up.cost };
                await _storage_js_1.kv.set(warKey, up.record);
                return { ok: true, structure, newLevel: up.newLevel, cost: up.cost, currency: 'wr', remainingWr: up.record.warResources };
            }, { failClosed: true })
            : await (0, _lock_js_1.withKvLock)(stateKey, async () => {
                const state = (await _storage_js_1.kv.get(stateKey)) ?? {};
                const treasury = (state.treasury ?? {});
                const seals = num(treasury.honorSeals);
                return await (0, _lock_js_1.withKvLock)(warKey, async () => {
                    const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(warKey)) ?? undefined);
                    const up = (0, _war_structures_js_1.applyStructureUpgrade)(record, seals, structure);
                    if (!up.ok)
                        return { ok: false, error: up.error, cost: up.cost };
                    await _storage_js_1.kv.set(warKey, up.record);
                    await _storage_js_1.kv.set(stateKey, { ...state, treasury: { ...treasury, honorSeals: up.nextSeals } });
                    return { ok: true, structure, newLevel: up.newLevel, cost: up.cost, currency: 'seals', remainingSeals: up.nextSeals };
                }, { failClosed: true });
            }, { failClosed: true });
        if (!result.ok) {
            const status = (result.error === 'insufficient-seals' || result.error === 'insufficient-wr') ? 402 : result.error === 'max-level' ? 409 : 400;
            return res.status(status).json({ error: result.error, cost: result.cost });
        }
        // Telemetry (best-effort): the currency spent upgrading a war structure.
        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `structure:${(0, _war_state_js_1.villageWarSlug)(village)}:${structure}:${result.newLevel}`, village, kind: (0, _war_structures_js_1.isPerWarStructure)(structure) ? 'wr.spend.structure' : 'seals.spend.structure', amount: result.cost ?? 0, meta: structure });
        return res.status(200).json(result);
    }
    catch (err) {
        console.error('[village/war-structure]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

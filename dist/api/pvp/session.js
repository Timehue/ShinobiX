"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const SESSION_TTL = 60 * 60;
// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;
function makeFighter(char, pos) {
    const maxHp = Number(char.maxHp ?? 100);
    const maxChakra = Number(char.maxChakra ?? 50);
    const maxStamina = Number(char.maxStamina ?? 50);
    return {
        name: char.name ?? 'Unknown',
        hp: Math.min(Number(char.hp ?? maxHp), maxHp),
        maxHp,
        chakra: Math.min(Number(char.chakra ?? maxChakra), maxChakra),
        maxChakra,
        stamina: Math.min(Number(char.stamina ?? maxStamina), maxStamina),
        maxStamina,
        shield: 0,
        statuses: [],
        character: char,
        pos,
    };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        const battleId = String(req.query.id ?? '');
        if (!battleId)
            return res.status(400).json({ error: 'Missing id' });
        const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
        if (!session)
            return res.status(404).json({ error: 'Session not found' });
        // Never cache battle state — both fighters poll every ~1s and need fresh data
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(session);
    }
    if (req.method === 'POST') {
        // Require a logged-in player. The creator must be one of the two
        // fighters (or admin) — otherwise anyone could fabricate a PvP session
        // with arbitrary stats (e.g. 999999 HP god mode).
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character } = body;
            if (!p1Character || !p2Character)
                return res.status(400).json({ error: 'Missing characters' });
            const p1Name = p1Character.name ?? 'Player 1';
            const p2Name = p2Character.name ?? 'Player 2';
            const p1Norm = String(p1Name).trim().toLowerCase();
            const p2Norm = String(p2Name).trim().toLowerCase();
            if (!identity.admin) {
                const me = identity.name;
                if (me !== p1Norm && me !== p2Norm) {
                    return res.status(403).json({ error: 'Can only create sessions you are a fighter in.' });
                }
            }
            // Fetch authoritative character data from KV to prevent client-side
            // stat inflation (e.g. sending 999999 HP in the request body).
            // We merge KV base stats onto the client payload so computed
            // combat fields (jutsu, pvpItems, bloodlineMult, armorFactor,
            // armorRawDR, itemDamagePct) survive — those are built client-side
            // from saved data and are not stored in the raw character save.
            // Keys the client computes and we must preserve:
            const COMBAT_FIELDS = ['jutsu', 'pvpItems', 'bloodlineMult', 'armorFactor', 'armorRawDR', 'itemDamagePct'];
            let finalP1Character = p1Character;
            let finalP2Character = p2Character;
            if (!identity.admin) {
                const myName = identity.name;
                const isP1 = myName === p1Norm;
                // Load our own save — always required.
                const mySave = await _storage_js_1.kv.get(`save:${myName}`);
                if (!mySave?.character) {
                    return res.status(400).json({ error: 'Your character save was not found on the server.' });
                }
                const myKvCharacter = mySave.character;
                // Merge: KV stats override client stats, but preserve client combat fields
                const myClientChar = isP1 ? p1Character : p2Character;
                const myMerged = { ...myClientChar };
                for (const [k, v] of Object.entries(myKvCharacter)) {
                    if (!COMBAT_FIELDS.includes(k))
                        myMerged[k] = v;
                }
                if (isP1)
                    finalP1Character = myMerged;
                else
                    finalP2Character = myMerged;
                // Try loading opponent from KV too (real player) — graceful fallback for NPCs.
                const oppNorm = isP1 ? p2Norm : p1Norm;
                if (oppNorm) {
                    const oppSave = await _storage_js_1.kv.get(`save:${oppNorm}`);
                    if (oppSave?.character) {
                        const oppKvChar = oppSave.character;
                        const oppClientChar = isP1 ? p2Character : p1Character;
                        const oppMerged = { ...oppClientChar };
                        for (const [k, v] of Object.entries(oppKvChar)) {
                            if (!COMBAT_FIELDS.includes(k))
                                oppMerged[k] = v;
                        }
                        if (isP1)
                            finalP2Character = oppMerged;
                        else
                            finalP1Character = oppMerged;
                    }
                }
            }
            const battleId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const session = {
                battleId,
                p1: makeFighter(finalP1Character, P1_START),
                p2: makeFighter(finalP2Character, P2_START),
                round: 1,
                activePlayer: 'p1',
                ap: { p1: 100, p2: 100 },
                actionsThisTurn: 0,
                cooldowns: { p1: {}, p2: {} },
                log: [`⚔️ ${p1Name} vs ${p2Name} — Battle begins! ${p1Name} goes first.`],
                status: 'active',
                winner: null,
                createdAt: Date.now(),
            };
            await _storage_js_1.kv.set(`pvp:${battleId}`, session, { ex: SESSION_TTL });
            return res.status(200).json({ battleId });
        }
        catch (err) {
            console.error('[pvp/session]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}

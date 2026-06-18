/*
 * Server-side mirror of the profession-mastery point RULES, used by the save
 * sanitizer (api/save/[name].ts) to anti-tamper a player's masterySpec: a forged
 * spec can't grant more points than the player's mastery LEVEL allows, can't
 * exceed node max-ranks, and can't unlock a capstone without the path gate.
 *
 * KEEP node ids / paths / costs / the XP wall in sync with
 * shinobij.client/src/lib/profession-mastery.ts (the canonical, fuller copy).
 * This mirror only needs the structural metadata, not the effect text — same
 * client/server duplication pattern as professionLogic.ts ↔ missions/_progress.ts.
 */

type Prof = 'healer' | 'vanguard' | 'petTamer';

const NODE_COST = 1;
const CAPSTONE_COST = 2;
const CAPSTONE_GATE = 4;
const MASTERY_MAX_LEVEL = 10;
const MASTERY_XP_PER_LEVEL = 15_000;

// Rank-10 XP wall = last finite profession-XP threshold. Baseline (Vanguard /
// Pet Tamer) = 32850; Healer = ×1.5 = 49275. Mirrors constants/profession.ts.
const RANK10_XP: Record<Prof, number> = { vanguard: 32_850, petTamer: 32_850, healer: 49_275 };

type NodeMeta = { id: string; path: string; capstone?: boolean };
const TREES: Record<Prof, NodeMeta[]> = {
    healer: [
        { id: 'heal-cooldown', path: 'triage' }, { id: 'heal-amount', path: 'triage' }, { id: 'mass-triage', path: 'triage', capstone: true },
        { id: 'heal-power', path: 'restoration' }, { id: 'heal-cost', path: 'restoration' }, { id: 'full-recovery', path: 'restoration', capstone: true },
        { id: 'heal-reach', path: 'outreach' }, { id: 'heal-support', path: 'outreach' }, { id: 'village-lifeline', path: 'outreach', capstone: true },
    ],
    vanguard: [
        { id: 'seal-gap', path: 'reaver' }, { id: 'seal-cap', path: 'reaver' }, { id: 'warmonger', path: 'reaver', capstone: true },
        { id: 'seal-train-cost', path: 'quartermaster' }, { id: 'seal-speedup', path: 'quartermaster' }, { id: 'logistician', path: 'quartermaster', capstone: true },
        { id: 'stamina', path: 'warden' }, { id: 'ai-damage', path: 'warden' }, { id: 'ironclad', path: 'warden', capstone: true },
    ],
    petTamer: [
        { id: 'exp-rewards', path: 'expeditioner' }, { id: 'exp-materials', path: 'expeditioner' }, { id: 'caravan-master', path: 'expeditioner', capstone: true },
        { id: 'pet-damage', path: 'beast-handler' }, { id: 'pet-hp', path: 'beast-handler' }, { id: 'alpha-bond', path: 'beast-handler', capstone: true },
        { id: 'train-time', path: 'trainer' }, { id: 'train-xp', path: 'trainer' }, { id: 'prodigy', path: 'trainer', capstone: true },
    ],
};

function num(v: unknown): number { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; }
function maxRank(n: NodeMeta): number { return n.capstone ? 1 : 3; }
function cost(n: NodeMeta): number { return n.capstone ? CAPSTONE_COST : NODE_COST; }

function isProf(p: unknown): p is Prof { return p === 'healer' || p === 'vanguard' || p === 'petTamer'; }

/** Mastery level (= point budget) from profession XP earned past the rank-10 wall. */
export function masteryBudget(profession: unknown, professionXp: unknown): number {
    if (!isProf(profession)) return 0;
    const over = num(professionXp) - RANK10_XP[profession];
    if (over <= 0) return 0;
    return Math.min(MASTERY_MAX_LEVEL, Math.floor(over / MASTERY_XP_PER_LEVEL));
}

/**
 * Clamp a (possibly forged) masterySpec to what `budget` allows: legal node ids,
 * ranks ≤ max, capstone gates satisfied, total spend ≤ budget. Greedy: normal
 * nodes first (in catalog order), then capstones whose path gate is met.
 */
export function sanitizeMasterySpec(profession: unknown, rawSpec: unknown, budget: number): Record<string, number> {
    if (!isProf(profession) || !rawSpec || typeof rawSpec !== 'object') return {};
    const raw = rawSpec as Record<string, unknown>;
    const tree = TREES[profession];
    const out: Record<string, number> = {};
    let spent = 0;

    for (const n of tree) {
        if (n.capstone) continue;
        const want = Math.max(0, Math.min(maxRank(n), num(raw[n.id])));
        const afford = Math.max(0, Math.min(want, Math.floor((budget - spent) / cost(n))));
        if (afford > 0) { out[n.id] = afford; spent += afford * cost(n); }
    }
    for (const n of tree) {
        if (!n.capstone) continue;
        if (num(raw[n.id]) < 1) continue;
        const pathPts = tree.reduce((s, m) => (m.path === n.path && !m.capstone ? s + (out[m.id] ?? 0) * cost(m) : s), 0);
        if (pathPts >= CAPSTONE_GATE && spent + cost(n) <= budget) { out[n.id] = 1; spent += cost(n); }
    }
    return out;
}

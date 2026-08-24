// Contract Hunters on a sector floor — ONE per bountied player standing in the
// sector, derived from the SHARED bounty record (shared/contract-hunter.ts, the
// same function the server settles the fight from) plus the target's roster
// facts, so every client in the sector renders the same hunter at the same
// level. Only the hunter's own TARGET can be engaged by it (verb "bountyHunter"
// → the Stand & Fight dialog); bystanders see it with a "hunting <name>" label
// and the passive "watch" verb (no action).
//
// Pure: WorldMap.tsx feeds it the board, the roster and its tile hasher and
// memoizes the result. (Drained from WorldMap.tsx to hold its line ratchet.)
import { bountyTargets, deriveContractHunter, type ContractHunterBounty } from "../../../shared/contract-hunter";
import { isWandererOnCooldown, type Wanderer } from "./wanderers";

export type ContractHunterRosterEntry = { name: string; level: number; currentSector?: number };

/*
 * Rendered-hunter cap per sector.
 *
 * This used to emit at most ONE hunter (the viewer's own). Extending it to every
 * bountied peer standing in the sector made the count unbounded, and a hunter is
 * not a cheap sprite: WorldMap renders each as a <SectorWanderer>, which owns its
 * own requestAnimationFrame walk loop AND a ResizeObserver. Twenty bountied
 * players in a hub sector meant twenty extra 60fps callbacks each writing
 * `style.transform` — roughly 1,200 layout-invalidating writes a second, on top
 * of the ambient wanderers already on the floor.
 *
 * Six is the cap: enough that a busy hub still reads as "the hunters are out"
 * (the ambient wanderer population in one sector is the same order), small enough
 * that the floor's rAF budget cannot be driven by how many people happen to have
 * a bounty. Slots are filled by HIGHEST bounty first — the pool is what makes a
 * hunter worth looking at — with the viewer's OWN hunter always taking a slot
 * regardless of rank, because that is the one a player can actually engage and
 * silently hiding it would look like the bounty had lapsed.
 */
export const MAX_CONTRACT_HUNTERS_PER_SECTOR = 6;

export function contractHunterWanderers(args: {
    sector: number;
    bountyBoard: readonly ContractHunterBounty[];
    self: { name: string; level: number; wandererCooldowns: Parameters<typeof isWandererOnCooldown>[0] };
    roster: readonly ContractHunterRosterEntry[];
    now: number;
    interiorTileFromKey: (key: string) => number;
}): Wanderer[] {
    const { sector, bountyBoard, self: me, roster, now, interiorTileFromKey } = args;
    if (bountyBoard.length === 0) return [];

    // Index the board ONCE. The per-target `bountyBoard.find()` this replaces was
    // O(peers x board) — ~10,000 comparisons per recompute at 200 players — and it
    // ran inside a memo that re-fires on every roster/presence frame. First entry
    // wins on a duplicate target, preserving what `find()` returned.
    const bountyByTarget = new Map<string, ContractHunterBounty>();
    for (const b of bountyBoard) {
        // Key through the same canonicalizer `bountyTargets` compares with, so the
        // map and the old predicate agree on casing/whitespace by construction.
        const key = String(b.target ?? "").trim().toLowerCase();
        if (!key || bountyByTarget.has(key)) continue;
        bountyByTarget.set(key, b);
    }
    const bountyFor = (name: string): ContractHunterBounty | undefined => {
        const hit = bountyByTarget.get(String(name ?? "").trim().toLowerCase());
        return hit && bountyTargets(hit, name) ? hit : undefined;
    };

    const selfKey = me.name.trim().toLowerCase();
    const self = { name: me.name, level: me.level, currentSector: sector };
    const peers = roster
        .filter((p) => p.name.trim().toLowerCase() !== selfKey && (p.currentSector ?? 0) === sector)
        .map((p) => ({ name: p.name, level: p.level, currentSector: sector }));

    const mine: Wanderer[] = [];
    const others: { wanderer: Wanderer; amount: number; sortName: string }[] = [];
    const seen = new Set<string>();
    for (const target of [self, ...peers]) {
        const bounty = bountyFor(target.name);
        if (!bounty) continue;
        const hunter = deriveContractHunter(bounty, target);
        if (!hunter || seen.has(hunter.id)) continue;
        seen.add(hunter.id);
        const isSelf = target === self;
        // A hunter you just fled / fought stays off YOUR floor for the cooldown;
        // a bystander's view of someone else's hunter is never cooled down.
        if (isSelf && isWandererOnCooldown(me.wandererCooldowns, hunter.id, now)) continue;
        const home = interiorTileFromKey(`${hunter.id}:${sector}`);
        const wanderer: Wanderer = {
            id: hunter.id,
            name: isSelf ? hunter.name : `${hunter.name} — hunting ${hunter.targetName}`,
            archetype: "bountyHunter",
            verb: isSelf ? "bountyHunter" : "watch",
            level: hunter.level,
            homeTile: home,
            waypoints: [home],
            greeting: isSelf
                ? `${hunter.targetName}, your bounty is worth ${hunter.bountyAmount.toLocaleString()} ryo. Stand still.`
                : `Not you. I'm hunting ${hunter.targetName} — ${hunter.bountyAmount.toLocaleString()} ryo on their head.`,
            tellTint: "var(--red-400)",
            avatarKey: "bountyHunter",
            targetName: hunter.targetName,
            bountyAmount: hunter.bountyAmount,
        };
        if (isSelf) mine.push(wanderer);
        else others.push({ wanderer, amount: hunter.bountyAmount, sortName: hunter.targetName.trim().toLowerCase() });
    }

    // Richest head first; target name breaks ties so that every client in the
    // sector trims to the SAME set no matter what order its roster arrived in.
    others.sort((a, b) => (b.amount - a.amount) || a.sortName.localeCompare(b.sortName));
    const slots = Math.max(0, MAX_CONTRACT_HUNTERS_PER_SECTOR - mine.length);
    return [...mine, ...others.slice(0, slots).map((o) => o.wanderer)];
}

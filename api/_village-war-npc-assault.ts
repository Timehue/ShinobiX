/**
 * A Cinderhold shinobi storming a player village's campaign stronghold when no
 * player is queued to defend it (owner ruling 2026-11-10: "they should raid
 * player strongholds").
 *
 * A player meets the defending village's AI copy of its ANBU or Kage there in
 * a solo PvE garrison battle they play themselves. A server-played NPC has no
 * browser to play that seat, so its assault resolves the way Cinderhold's
 * sector-war garrison assaults already do (api/_npc-war-party.ts): both sealed
 * builds fight it out on the server (resolveMercBattle), the NPC's own kit in
 * the merc's place. Everything else (the run, its admission, the personal daily
 * allowance, the PvE support scoring, the watchtower alert) is the `start`
 * route's own, exactly as for a player (api/village/war-campaign.ts).
 */
import { randomInt } from 'node:crypto';
import { loadAdminJutsuObjects } from './_admin-jutsu-catalog.js';
import { resolvePveGapClosingJutsu, type AiOpponentJutsu } from './_ai-opponent-loadout.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle, type MercBattleResult } from './towers/_merc-fighters.js';

/** What the assault decided, sealed into the campaign run before it is admitted. */
export type NpcGarrisonAssault = { winner: 'p1' | 'p2' | 'draw'; rounds: number; seed: number };

type Fight = (args: Parameters<typeof resolveMercBattle>[0]) => Pick<MercBattleResult, 'mercWon' | 'playerWon' | 'rounds'>;
let fight: Fight = resolveMercBattle;
/** Tests decide the fight (the real one is a whole tower floor). */
export function setNpcGarrisonAssaultFightForTest(next: Fight | null): void { fight = next ?? resolveMercBattle; }

let gapClosing: AiOpponentJutsu[] | null = null;
async function gapClosingJutsu(): Promise<AiOpponentJutsu[]> {
    return gapClosing ??= resolvePveGapClosingJutsu({ jutsu: await loadAdminJutsuObjects(), items: new Map() });
}

/**
 * The NPC (p1, the attacker) against the defending village's sealed AI copy
 * (p2). `save`/`character` are the NPC's fresh save, as the route read it.
 */
export async function resolveNpcGarrisonAssault(args: {
    npcName: string;
    save: Record<string, unknown>;
    character: Record<string, unknown>;
    admin: Parameters<typeof sealTowerFighter>[3];
    copy: { slug: string; name: string; character: Record<string, unknown> };
    now: number;
}): Promise<NpcGarrisonAssault> {
    const seed = randomInt(0x1_0000_0000);
    const level = Math.max(1, Math.floor(Number(args.character.level) || 1));
    const battle = fight({
        playerName: args.copy.name, playerSlug: args.copy.slug, playerSealedChar: args.copy.character,
        mercLevel: level, seed, now: args.now, gapClosingJutsu: await gapClosingJutsu(),
        mercSealed: { name: args.npcName, character: sealTowerFighter(args.character, args.save, {}, args.admin) },
    });
    // A stall is a draw, as in a sector-war garrison assault: nobody scores.
    return { winner: battle.mercWon ? 'p1' : battle.playerWon ? 'p2' : 'draw', rounds: battle.rounds, seed };
}

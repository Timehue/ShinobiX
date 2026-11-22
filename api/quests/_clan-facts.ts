/*
 * What a clan quest line needs to know about the player's clan.
 *
 * A clan quest is taken with a clan and moves only while the player is still in
 * that same clan (its coast generation, so a clan re-founded under an old name
 * is a different clan) and has been in it for the coast's member tenure. A
 * player who leaves keeps the quest where it stood; it moves again if they come
 * back to the same clan.
 *
 * Read from the server's own rows: the player's save, the clan record, and the
 * clan's Landing. The client never says which clan it is in.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { COAST_LAND, coastClanGenerationFor } from '../coast/_land.js';
import { readCoastLanding } from '../coast/_landing-store.js';
import { activeQuestCatalogue } from './_active-catalogue.js';
import { parseQuestLines } from './_record.js';
import type { QuestClanFacts } from './_types.js';

/**
 * The player's clan as a clan quest sees it, or null when they are in no clan.
 * `mint` gives a clan its coast generation if it has none yet: only accepting
 * a clan quest does that.
 */
export async function questClanFactsFor(playerName: string, options: { mint?: boolean; now?: number } = {}): Promise<QuestClanFacts | null> {
    const player = safeName(playerName), now = options.now ?? Date.now();
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const clanName = String(((save?.character ?? {}) as Record<string, unknown>).clan ?? '').trim();
    if (!clanName) return null;
    const clan = await coastClanGenerationFor(clanName, options.mint === true);
    if (!clan) return null;
    const members = Array.isArray(clan.record.members) ? clan.record.members as Array<Record<string, unknown>> : [];
    const row = members.find(member => safeName(String(member?.name ?? '')) === player);
    // The save names the clan; the clan's own list must agree.
    if (!row) return null;
    const joinedAt = Math.max(0, Math.floor(Number(row.joinedAt) || 0));
    const landing = await readCoastLanding(clan.clanSlug);
    const standing = landing && landing.status !== 'destroyed' && landing.generation === clan.generation ? landing : null;
    return {
        generation: clan.generation,
        // A member row with no join date is from before join dates were kept, so it is long-standing.
        tenured: joinedAt === 0 || now - joinedAt >= COAST_LAND.memberTenureMs,
        ...(standing ? { landing: { tier: standing.tier, active: standing.status === 'active' } } : {}),
    };
}

/**
 * Before a clan quest's fight: the same standing its other stages ask for.
 * Throws a sentence the player can read; does nothing for any other quest.
 */
export async function assertQuestClanStanding(playerName: string, save: Record<string, unknown>, questId: string): Promise<void> {
    const catalogue = activeQuestCatalogue();
    const line = Object.hasOwn(catalogue.lines, questId) ? catalogue.lines[questId] : undefined;
    if (!line?.gate.clan) return;
    const active = parseQuestLines(save.questLines).active[questId];
    const facts = await questClanFactsFor(playerName);
    if (!facts || (active?.clanGeneration && facts.generation !== active.clanGeneration)) {
        throw new Error('This quest waits for the clan you took it with.');
    }
    if (!facts.tenured) throw new Error('You must be in your clan for two days before its quests move.');
}

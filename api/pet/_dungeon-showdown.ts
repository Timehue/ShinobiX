import { randomInt, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { resolveDungeonPetAuthority, applyDungeonPetTerminal, dungeonPetWasWon } from '../dungeon/_encounter-proof.js';
import { createShowdownSession, type ShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { buildDungeonCommandBeast } from './_dungeon-command-beast.js';
import { buildDungeonSealBeast } from './_authored-encounter.js';
import { publishShowdownPresence } from './_showdown-presence.js';
import { activeCarriedPets } from '../_entitlements.js';
import { showdownBusyIssue } from './_showdown-readiness.js';

export type DungeonShowdownSession = ShowdownSession & { dungeonRun?: { runToken: string; petId: string } };
const keyOf = (name: string, id: string) => `pet:showdown:${name}:${id}`;
const TTL = 45 * 60;
type Failure = { ok: false; error: string };
type Commit = { ok: true; character: Record<string, unknown>; _saveVersion: number };

/** One immutable command session per exact parent run. Lost replies resume it. */
export async function startDungeonShowdown(name: string, runToken: string, petId: string): Promise<(Commit & { session: DungeonShowdownSession }) | (Commit & { completed: true }) | Failure> {
    const mutation = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ session?: DungeonShowdownSession; completed?: true }>(name, async ({ character }) => {
        let authority;
        try { authority = resolveDungeonPetAuthority({ character, dungeonRunToken: runToken }); }
        catch (cause) { return { ok: false as const, status: 409, error: cause instanceof Error ? cause.message : 'This Dungeon seal is unavailable.' }; }
        if (dungeonPetWasWon(authority.activeRun)) return { ok: true as const, value: { completed: true as const }, character, write: false };
        const existing = authority.activeRun.petArenaSessionId;
        if (typeof existing === 'string') {
            const session = await kv.get<DungeonShowdownSession>(keyOf(name, existing));
            if (!session || session.playerName !== name || session.dungeonRun?.runToken !== runToken) {
                return { ok: false as const, status: 409, error: 'This Dungeon battle has expired. Leave this run before starting another.' };
            }
            return { ok: true as const, value: { session }, character, write: false };
        }
        if (authority.activeRun.petDefeated === true) return { ok: false as const, status: 409, error: 'The Rare Beast seal is already complete.' };
        const mine = activeCarriedPets<Pet>(character).find(pet => pet.id === petId);
        if (!mine) return { ok: false as const, status: 409, error: 'Choose a carried pet for the Rare Beast seal.' };
        const busy = showdownBusyIssue(character, [mine]);
        if (busy) return { ok: false as const, status: 409, error: busy };
        const visual = buildDungeonSealBeast(name, runToken);
        const beast: Pet = buildDungeonCommandBeast();
        const sessionId = randomUUID().replace(/-/g, '');
        const session: DungeonShowdownSession = {
            ...createShowdownSession({ sessionId, playerName: name, format: '1v1', tier: 'champion', seed: randomInt(1, 0x7fffffff), playerPets: [mine], enemyPets: [beast], enemyTeamName: beast.name, rewardEligible: false }),
            dungeonRun: { runToken, petId: mine.id },
        };
        // Presentation identity is assigned only AFTER combat sealing. Passing
        // it into growth/kit normalization would change the fixed boss's stats.
        if (visual?.templateId) session.enemy[0].templateId = visual.templateId;
        const nextCharacter = { ...character, activeDungeonRun: { ...authority.activeRun, petArenaSessionId: sessionId } };
        // Store combat first. A failed CAS leaves an unreachable, unpaid orphan;
        // publishing a pointer to missing combat could strand the parent run.
        await kv.set(keyOf(name, sessionId), session, { ex: TTL });
        return { ok: true as const, value: { session }, character: nextCharacter };
    }));
    if (!mutation.ok) return { ok: false, error: mutation.error };
    const opened = { ok: true as const, character: mutation.character, _saveVersion: mutation._saveVersion };
    const session = mutation.value.session;
    if (opened.ok && session?.finished) {
        const recorded = await settleDungeonShowdown(name, session);
        return recorded.ok ? { ...recorded, session } : recorded;
    }
    if (opened.ok && session && !session.finished) await publishShowdownPresence(kv, name, session.sessionId);
    return session ? { ...opened, session } : { ...opened, completed: true };
}

export async function dungeonShowdownIsActive(name: string, session: DungeonShowdownSession): Promise<boolean> {
    if (!session.dungeonRun) return true;
    const record = await kv.get<Record<string, unknown>>(`save:${name}`);
    const character = record?.character as Record<string, unknown> | undefined;
    if (!character) return false;
    try {
        const authority = resolveDungeonPetAuthority({ character, dungeonRunToken: session.dungeonRun.runToken });
        return session.playerName === name && authority.activeRun.petArenaSessionId === session.sessionId
            && session.player.length === 1 && session.player[0].id === session.dungeonRun.petId;
    } catch { return false; }
}

/** Only a terminal server session can advance the Rare Beast parent proof. */
export async function settleDungeonShowdown(name: string, session: DungeonShowdownSession): Promise<Commit | Failure> {
    if (!session.dungeonRun || !session.finished || !session.outcome || session.playerName !== name) return { ok: false, error: 'The Dungeon battle is not complete.' };
    const binding = session.dungeonRun;
    const outcome = session.outcome;
    const mutation = await retryOnSaveVersionConflict(() => mutatePlayerSave(name, ({ character }) => {
        const run = character.activeDungeonRun as Record<string, unknown> | undefined;
        if (!run || run.token !== binding.runToken || run.petArenaSessionId !== session.sessionId) return { ok: false as const, status: 409, error: 'This battle does not belong to the active Dungeon run.' };
        const applied = applyDungeonPetTerminal({ character, dungeonRunToken: binding.runToken, proofId: session.sessionId, outcome, petIds: [binding.petId] });
        if (!applied.ok) return { ok: false as const, status: 409, error: applied.error };
        return { ok: true as const, value: null, character: applied.character, ...(applied.alreadyApplied ? { write: false } : {}) };
    }));
    return mutation.ok ? { ok: true, character: mutation.character, _saveVersion: mutation._saveVersion } : { ok: false, error: mutation.error };
}

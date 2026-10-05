import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict } from '../save/_projected-write.js';
import {
    PROFESSION_CHANGE_APPROVAL_ID,
    PROFESSION_CHANGE_APPROVAL_NAME,
    PROFESSION_UNLOCK_LEVEL,
    isProfession,
    professionChangeUnlockError,
} from '../../shared/profession-change.js';

function consumeProfessionApproval(character: Record<string, unknown>): Record<string, unknown> | null {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const approvalIndex = inventory.indexOf(PROFESSION_CHANGE_APPROVAL_ID);
    if (approvalIndex >= 0) return {
        ...character,
        inventory: [...inventory.slice(0, approvalIndex), ...inventory.slice(approvalIndex + 1)],
    };
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    const stackIndex = stacks.findIndex(stack => stack?.itemId === PROFESSION_CHANGE_APPROVAL_ID && Number.isSafeInteger(stack.count) && stack.count > 0);
    if (stackIndex < 0) return null;
    return {
        ...character,
        itemStacks: stacks.flatMap((stack, index) => index !== stackIndex ? [stack]
            : stack.count > 1 ? [{ ...stack, count: stack.count - 1 }] : []),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const profession = String(body.profession ?? '');
        const respecRequested = body.respec === true;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!isProfession(profession)) {
            return res.status(400).json({ error: 'Invalid profession.' });
        }
        // Admin accounts can't pick a profession — the picker UI also skips
        // them, but block at the endpoint as defense-in-depth. safeName
        // upstream strips whitespace, so the canonical forms are 'admin1'
        // and 'admin2' (the prior 'admin 1' / 'admin 2' literals never
        // matched after sanitization and silently let admins through).
        const lower = playerName.toLowerCase();
        if (lower === 'admin1' || lower === 'admin2') {
            return res.status(403).json({ error: 'Admin accounts do not pick professions.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only choose a profession for yourself.' });
        }

        // The whole read-check-write commits through mutatePlayerSave — the save
        // lock and an exact compare-and-set. Without it two concurrent POSTs both
        // read profession=undefined, both pass the "already chosen" check, both
        // write a different profession, and last-writer-wins. It also serializes
        // against any concurrent /api/save auto-save so the profession flip
        // doesn't get clobbered by a stale character body. The profession itself
        // is the receipt, so re-running the whole choice after a lost
        // compare-and-set cannot consume a second approval.
        type Reply = { status: 200 | 403 | 409; body: Record<string, unknown> };
        const committed = await retryOnSaveVersionConflict(() => mutatePlayerSave<Reply>(playerName, ({ character: char }) => {
            const reply = (status: Reply['status'], body: Record<string, unknown>) =>
                ({ ok: true as const, write: false, character: char, value: { status, body } });

            const level = Number(char.level ?? 0);
            if (!Number.isFinite(level) || level < PROFESSION_UNLOCK_LEVEL) {
                return reply(403, { error: `Profession unlocks at Level ${PROFESSION_UNLOCK_LEVEL}.` });
            }

            if (char.profession === profession) return reply(200, { ok: true, profession, idempotent: true });
            if (respecRequested) {
                const error = professionChangeUnlockError(char);
                if (error) return reply(403, { error });
                if (body.fromProfession !== undefined && body.fromProfession !== char.profession) {
                    return reply(409, { error: 'Your profession has changed. Refresh before choosing another path.' });
                }
                // Bind delayed retries to the choice generation, including A→B→A changes.
                if (body.fromProfessionChosenAt !== undefined && body.fromProfessionChosenAt !== (char.professionChosenAt ?? null)) {
                    return reply(409, { error: 'Your profession has changed. Refresh before choosing another path.' });
                }
            }
            if (respecRequested) {
                const error = professionChangeUnlockError(char);
                if (error) return { status: 403 as const, body: { error } };
                if (body.fromProfession !== undefined && body.fromProfession !== char.profession) {
                    return { status: 409 as const, body: { error: 'Your profession has changed. Refresh before choosing another path.' } };
                }
                // Bind retries to this choice generation. A delayed A→B request
                // must not reset fresh A progress after a later B→A change.
                if (body.fromProfessionChosenAt !== undefined && body.fromProfessionChosenAt !== (char.professionChosenAt ?? null)) {
                    return { status: 409 as const, body: { error: 'Your profession has changed. Refresh before choosing another path.' } };
                }
            }
            let paidCharacter = char;
            if (char.profession) {
                if (!respecRequested) {
                    return reply(409, {
                        error: `Profession already chosen. A ${PROFESSION_CHANGE_APPROVAL_NAME} is required to change it.`,
                        current: char.profession,
                        requiredItemId: PROFESSION_CHANGE_APPROVAL_ID,
                    });
                }
                if (!consumeProfessionApproval(char)) {
                    return reply(409, {
                        error: `You need a ${PROFESSION_CHANGE_APPROVAL_NAME} from the Grand Marketplace.`,
                        current: char.profession,
                        requiredItemId: PROFESSION_CHANGE_APPROVAL_ID,
                    });
                }
                paidCharacter = consumed;
            }

            const changingProfession = Boolean(char.profession);
            const paidCharacter = changingProfession ? consumeProfessionApproval(char)! : char;
            const priorChosenAt = Number(char.professionChosenAt);
            const nextCharacter = {
                ...paidCharacter,
                profession,
                professionRank: 1,
                professionXp: 0,
                professionChosenAt: Math.max(Date.now(), Number.isSafeInteger(priorChosenAt) ? priorChosenAt + 1 : 0),
                ...(changingProfession ? { masterySpec: {} } : {}),
            };
            return {
                ok: true,
                character: nextCharacter,
                value: { status: 200, body: { ok: true, profession, approvalConsumed: changingProfession } },
            };
        }));

        if (!committed.ok) {
            if (committed.status === 404) {
                return res.status(404).json({ error: committed.code === 'character-not-found' ? 'Character not found.' : 'Player not found.' });
            }
            return res.status(committed.status).json({ error: committed.error });
        }
        const outcome = committed.value;
        if (outcome.status === 200) {
            // Echo the version. Bumping it silently leaves the client's
            // `_baseSaveVersion` stale, so its next autosave 409s and the conflict
            // path replaces local state with the server snapshot — progress
            // reverts. authFetch adopts any `_saveVersion` in a response body
            // monotonically. An idempotent repeat echoes the version it found.
            outcome.body.character = committed.character;
            outcome.body._saveVersion = committed._saveVersion;
        }
        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(409).json({ error: 'Profession choice is busy; no change was written. Please retry.' });
        }
        console.error('[profession/choose]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

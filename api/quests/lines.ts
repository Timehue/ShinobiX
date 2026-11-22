import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { recordAudit } from '../_audit.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { recordEconomyTxn } from '../_economy.js';
import { onlineStore } from '../_realtime/online-store.js';
import { mutatePlayerSave, type PlayerSaveMutation } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import { grantPoolPoints } from '../story/_settle.js';
import { sectorBuilding } from '../../shared/sector-buildings.js';
import { SECTOR_TILE_COUNT } from '../../shared/sector-links.js';
import { coastSite } from '../../shared/coast-world.js';
import type { QuestLinePlace } from './_types.js';
import { questLineRyo } from './_catalog.js';
import { questLineGearDrop } from './_gear.js';
import { activeQuestCatalogue } from './_active-catalogue.js';
import {
    abandonQuestLine,
    acceptQuestLine,
    advanceQuestLine,
    chooseQuestLineOption,
    claimQuestLine,
    examineQuestLineClue,
    makeQuestLineItem,
    resetQuestLine,
    type QuestDecision,
    type QuestEngineDeps,
} from './_engine.js';
import { parseQuestLines, questLineMarks, questLinesForStorage } from './_record.js';
import { questSiteViews } from './_sites.js';
import { questClanFactsFor } from './_clan-facts.js';
import { questClaimSentence, questLineClientViews, questRecall, spoken } from './_views.js';
import type { QuestSay } from './_types.js';
import { QUEST_REFUSAL_SENTENCES } from './_refusals.js';
import { announce } from '../_announce.js';

/** The quest that ends the Crossing War. Finishing it is announced to everyone. */
const COAST_FINALE_QUEST = 'the-unmoored';

/*
 * /api/quests/lines: POST { action, playerName, questId?, optionKey?, stageKey? }
 *
 * The quest lines (see _types.ts). Everything is decided on the server from its
 * own copies: the catalogue, the save, and where the online store says the
 * player is standing. The client names a quest and an action and nothing else.
 *
 *   list                  -> { ok, marks, lines, sites }
 *   accept  { questId }   -> { ok, id, stage } | { ok:false, reason }
 *   advance { questId }   -> { ok, advanced, stage, readyToClaim } | { ok:false, reason, ... }
 *   make    { questId }   -> as advance; spends the recipe's inputs. On a later
 *                            stage it makes an earlier recipe again and passes
 *                            nothing ({ stageKey } picks which).
 *
 * Gathering at a quest site is not an action here. It is ordinary gathering, so
 * it goes through /api/world/resource with the site's id as the node.
 *   choose  { questId, optionKey }
 *   examine { questId, clueKey } -> { ok, clue, talk, found, of, advanced, again? } | { ok:false, reason }
 *                            look at one thing inside the building the step names
 *                            (EnterStage.clues). Kept on the record; the last one passes the step.
 *   claim   { questId }   -> { ok, ryo, statPoints, ..., marks }
 *   abandon { questId }   -> { ok } | { ok:false, reason:'committed' }
 *
 * Fight stages are never passed here. They are passed inside the fight's own
 * settlement write (settleQuestLineFight), where the win is proven.
 *
 * Admin only:
 *   inspect               -> { ok, marks, active, done }   the stored record, as read
 *   reset   { questId, forget? } -> { ok, cleared, forgot, returned? }
 *                            ends that quest's run and takes back what it lent.
 *                            `forget: true` also forgets that it was finished;
 *                            nothing paid is taken back, so it can pay again.
 *                            Written to the audit log.
 */

const GRID_WIDTH = Math.round(Math.sqrt(SECTOR_TILE_COUNT));

function tileDistance(a: number, b: number): number {
    return Math.max(
        Math.abs((a % GRID_WIDTH) - (b % GRID_WIDTH)),
        Math.abs(Math.floor(a / GRID_WIDTH) - Math.floor(b / GRID_WIDTH)),
    );
}

/**
 * Where the player must stand to use a place a quest stage names: a building on
 * the home map (shared/sector-buildings.ts) or a site on the coast
 * (shared/coast-world.ts). Either way it is the tile at its entrance.
 */
export function questBuildingPlace(buildingId: string): QuestLinePlace | null {
    const place = sectorBuilding(buildingId) ?? coastSite(buildingId);
    return place ? { sector: place.sector, tile: place.approach, radius: 1 } : null;
}

export { setQuestLineCatalogueForTest } from './_active-catalogue.js';

function engineDeps(playerName: string): QuestEngineDeps {
    return {
        catalogue: activeQuestCatalogue(),
        buildingPlace: questBuildingPlace,
        ryo: questLineRyo,
        grantStatPoints: grantPoolPoints,
        tileDistance,
        rollGear: (character, chanceBp, questId) => questLineGearDrop(playerName, character, chanceBp, questId),
    };
}

/** Every refusal is worded here, on the server (_refusals.ts). A reply's own `error` always wins over these. */
const REFUSAL_SENTENCES = QUEST_REFUSAL_SENTENCES;

const ACTIONS = new Set(['list', 'recall', 'accept', 'advance', 'make', 'examine', 'choose', 'claim', 'abandon', 'inspect', 'reset']);
const ADMIN_ACTIONS = new Set(['inspect', 'reset']);
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** `wrote` is true when the save changed, so the reply carries the new character and version. */
type Reply = { body: Record<string, unknown>; wrote: boolean; paid?: Record<string, number> };

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        if (!ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (ADMIN_ACTIONS.has(action) && !identity.admin) return res.status(403).json({ error: 'Admin only.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `quest-lines-${action}`, 30, 60_000, identity.name))) return;

        const questId = typeof body.questId === 'string' ? body.questId.slice(0, 80) : '';
        const optionKey = typeof body.optionKey === 'string' ? body.optionKey : '';
        // Only ever compared with the catalogue's own stage keys.
        const stageKey = typeof body.stageKey === 'string' ? body.stageKey.slice(0, 40) : '';
        const clueKey = typeof body.clueKey === 'string' ? body.clueKey.slice(0, 40) : '';
        // A reset may name a quest the catalogue has since dropped: the stored
        // record is what it clears.
        if (action !== 'list' && action !== 'inspect' && action !== 'reset' && !Object.hasOwn(activeQuestCatalogue().lines, questId)) {
            return res.status(400).json({ error: 'Unknown quest.' });
        }
        if (action === 'reset' && !questId) return res.status(400).json({ error: 'Name the quest to reset.' });
        const deps = engineDeps(playerName);
        // A clan quest moves only with its clan. What the server knows of the
        // player's clan is read here, before the save is locked: its coast
        // generation, how long the player has been in it, and its Landing.
        const clanQuest = Object.hasOwn(deps.catalogue.lines, questId) && deps.catalogue.lines[questId].gate.clan === true;
        // Abandon reads them too: a clan quest whose clan is gone may be dropped
        // even after it has taken items (abandonQuestLine).
        const clan = clanQuest && action !== 'reset' && action !== 'list' && action !== 'inspect' && action !== 'recall'
            ? await questClanFactsFor(playerName, { mint: action === 'accept' })
            : undefined;
        const forget = body.forget === true;
        let audit: { before: unknown; after: unknown } | null = null;

        const committed = await mutatePlayerSave<Reply>(playerName, ({ record: save, character }): PlayerSaveMutation<Reply> => {
            const record = parseQuestLines(save.questLines);
            const inClan = typeof character.clan === 'string' && character.clan.trim().length > 0;
            if (action === 'inspect') {
                return { ok: true, write: false, character, value: { body: { ok: true, marks: questLineMarks(record), active: record.active, done: record.done }, wrote: false } };
            }
            if (action === 'reset') {
                const decision = resetQuestLine(deps, record, character, questId, { forget });
                const reply: Reply = { body: { ok: true, ...(decision.body ?? {}) }, wrote: !!decision.record };
                audit = decision.record
                    ? { before: { active: record.active[questId] ?? null, done: record.done[questId] ?? null }, after: decision.body }
                    : null;
                if (!decision.record) return { ok: true, write: false, character, value: reply };
                return {
                    ok: true,
                    character: decision.character ?? character,
                    recordPatch: { questLines: questLinesForStorage(decision.record, save.questLines) },
                    value: reply,
                };
            }
            if (action === 'list') {
                const view = questLineClientViews(deps, record, character, { level: num(character.level), inClan });
                const sites = questSiteViews(save, character, Date.now());
                return { ok: true, write: false, character, value: { body: { ok: true, ...view, sites }, wrote: false } };
            }
            if (action === 'recall') {
                // A finished quest's whole story, to be read again. It changes nothing and is sent only on asking,
                // so the quest list every screen reads does not carry twenty quests' worth of lines.
                const told = questRecall(deps, record, character, questId);
                const body = told ? { ok: true, ...told } : { ok: false, reason: 'unfinished', error: 'That quest is not finished yet.' };
                return { ok: true, write: false, character, value: { body, wrote: false } };
            }

            const now = Date.now();
            // Read where the server holds the player at the moment of the
            // decision, inside the save lock, so a move cannot race the check.
            const presence = onlineStore.get(playerName) ?? null;
            let decision: QuestDecision;
            if (action === 'accept') decision = acceptQuestLine(deps, record, character, questId, { inClan, now, clan });
            else if (action === 'advance') decision = advanceQuestLine(deps, record, character, questId, { presence, now, clan });
            else if (action === 'make') decision = makeQuestLineItem(deps, record, character, questId, { presence, now, clan, ...(stageKey ? { stageKey } : {}) });
            else if (action === 'examine') {
                decision = examineQuestLineClue(deps, record, questId, clueKey, { presence, now, clan });
                // What was learned, as the journal shows speech: names and faces, not cast ids.
                const say = decision.body?.say as readonly QuestSay[] | undefined;
                if (say) {
                    const { say: _ids, ...rest } = decision.body!;
                    decision = { ...decision, body: { ...rest, talk: say.map(spoken) } };
                }
            }
            else if (action === 'choose') decision = chooseQuestLineOption(deps, record, questId, optionKey, { now, clan });
            else if (action === 'claim') decision = claimQuestLine(deps, record, character, questId, { now, clan });
            else decision = abandonQuestLine(record, questId, clanQuest ? { deps, character, clan } : undefined);

            const changed = !!decision.record || !!decision.character;
            const sentence = decision.reason && !decision.body?.error ? REFUSAL_SENTENCES[decision.reason] : undefined;
            const reply: Reply = {
                body: { ok: decision.ok, ...(decision.reason ? { reason: decision.reason } : {}), ...(sentence ? { error: sentence } : {}), ...(decision.body ?? {}) },
                wrote: changed,
            };
            if (!changed) return { ok: true, write: false, character, value: reply };
            const next = decision.character ?? character;
            if (action === 'claim' && decision.ok) {
                // The journal shows this as it is; the client words nothing itself.
                reply.body.earned = questClaimSentence(reply.body);
                reply.paid = { ryo: num(next.ryo), fateShards: num(next.fateShards), boneCharms: num(next.boneCharms), auraStones: num(next.auraStones) };
            }
            return {
                ok: true,
                character: next,
                ...(decision.record ? { recordPatch: { questLines: questLinesForStorage(decision.record, save.questLines) } } : {}),
                value: reply,
            };
        });

        if (!committed.ok) {
            return committed.status === 404
                ? res.status(404).json({ error: 'Your save was not found.' })
                : res.status(committed.status).json({ error: committed.error });
        }

        const { body: out, paid, wrote } = committed.value;
        if (paid && questId === COAST_FINALE_QUEST) {
            // The one quest whose ending other players hear of, with what was asked of her. `paid` is set only by a
            // claim that really paid, and the receipt makes a retried request announce once.
            const standings = (committed.character as { questStandings?: unknown } | undefined)?.questStandings;
            const opened = Array.isArray(standings) && standings.includes('coast-opened');
            await announce({
                type: 'coast_finale', importance: 'high', title: `${playerName} has ended the Crossing War`,
                message: opened ? 'They asked the Unmoored to open the Unmapped Coast.' : 'They asked the Unmoored to keep the Unmapped Coast closed.',
                player: playerName, meta: { quest: questId, choice: opened ? 'open' : 'closed' },
            }, { receiptId: `quest-line:${questId}:${playerName}` }).catch(() => null);
        }
        if (audit) {
            const { before, after } = audit as { before: unknown; after: unknown };
            await recordAudit({ actor: 'admin', domain: 'reward', action: 'quest-line.reset', entityType: 'player', entityId: playerName, before, after, meta: { questId, forget } });
        }
        if (paid) {
            // Telemetry follows the committed payout. The save's own ledger row
            // was written with it; this feeds the economy dashboards.
            for (const currency of ['ryo', 'fateShards', 'boneCharms', 'auraStones'] as const) {
                const delta = num(out[currency]);
                if (delta > 0) {
                    await recordEconomyTxn({ txnId: `quest-line:${playerName}:${questId}:${currency}`, player: playerName, currency, delta, source: 'quest.line', balanceAfter: paid[currency] });
                }
            }
        }
        return res.status(200).json({
            ...out,
            ...(wrote ? { character: committed.character, _saveVersion: committed._saveVersion } : {}),
        });
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'Could not update the quest. Please retry.' });
        }
        console.error('[quests/lines]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

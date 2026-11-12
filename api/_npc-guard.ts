/**
 * Cinderhold NPC accounts may be played by an admin (api/admin/npc-possess.ts),
 * so every route that moves value OUT of an account — to another player, a
 * village or clan pool, a bounty — and every route that deletes or renames an
 * account refuses them here, at registration, instead of trusting each handler.
 *
 * NPC accounts have no password, so the only way to act as one is a session
 * token; this checks exactly that token. Ordinary players pay one extra token
 * verification on these few routes and nothing else changes.
 */
import type { ApiRequest, ApiResponse } from './_vercel.js';
import { verifyPlayerToken } from './_auth.js';
import { cors, safeName } from './_utils.js';
import { isNpcAccount } from '../shared/npc-village-roster.js';

type AnyHandler = (req: ApiRequest, res: ApiResponse) => unknown;

/** Routes a Cinderhold NPC can never use, even under admin control. */
export const NPC_BLOCKED_ROUTES: readonly string[] = [
    '/player/trade',
    '/bank/transfer',
    '/village/transfer',
    '/village/treasury/donate',
    '/village/treasury/transfer',
    '/clan/seal-pool/donate',
    '/clan/seal-pool/distribute',
    '/clan/treasury/donate',
    '/clan/treasury/transfer',
    '/pvp/bounty',
    '/pet/sanctuary/transfer',
    '/festival/exchange', // player-to-player listings: a 1-ryo sale is a transfer
    '/clan/mentor', // sensei/student milestone pay crosses two accounts
    // Ranked and ladder play: a controlled NPC losing on purpose would feed a
    // friend Elo, ladder points and season rewards (NPCs earn no standing).
    '/pvp/ranked-queue',
    '/pvp/ranked-2v2',
    '/pvp/pet-ranked-queue',
    '/pet/ranked-start',
    '/pet-ladder',
    '/arena/lobby',
    '/card-clash/queue',
    '/card-clash/challenge',
    '/towers/pvp-queue',
    // Brackets and player-run play (2026-11-11 audit): a controlled NPC entering
    // a tournament could throw a match (purse and title to the winner), and
    // leading or joining a tower party, a pet-tactics room or the dojo circuit
    // would carry a player through content on an NPC's build.
    '/tournaments/event',
    '/towers/start',
    '/towers/join',
    '/towers/party',
    '/pet/tactics',
    '/dojo-circuit/event',
    '/village-guard/queue',
    '/village-guard/challenge',
    '/player/account-deletion',
    '/player/account-name',
    // War rewards and war commands (Push 4). Cinderhold earns nothing from a
    // war, and its wars are declared, fought and supplied by the server
    // (api/_npc-village-war.ts, api/_npc-war-party.ts): a controlled NPC can
    // still duel and play war card and pet battles, but cannot declare, storm a
    // garrison, hire mercenaries, raid a stronghold or claim a war payout.
    '/war/claim-reward',
    '/village/claim-map-control',
    '/village/claim-war-crate',
    '/village/open-war-crate',
    '/village/sector-war',
    '/village/war-merc',
    '/village/anbu-infiltration',
    // Kage seats and challenges: Cinderhold's leaders are the server's
    // (api/_npc-village-leaders.ts). Both routes only check that the actor
    // belongs to the village named, and only NPCs belong to Cinderhold, so a
    // controlled NPC could otherwise open a Cinderhold Kage seat or challenge.
    '/village/kage',
    '/village/kage-challenge',
    // Cinderhold's clans (shared/npc-clans.ts) are permanent and earn nothing.
    // They never declare a war (owner ruling 2026-11-10); a player clan
    // declares on one, and it is fought through the queue, which stays open to
    // a controlled NPC; surrender and withdrawal are refused inside the queue
    // route (api/clan/war/queue.ts). A controlled NPC cannot declare, leave,
    // kick, buy upgrades, claim clan missions or contracts, shop the clan
    // exchange, collect or spend territory supply, or fight the clan boss.
    '/clan/war/declare',
    '/clan/leave',
    '/clan/kick',
    '/clan/upgrade/purchase',
    '/clan/mission/claim',
    '/clan/exchange/purchase',
    '/clan/program',
    '/clan/territory/collect-supply',
    '/clan/territory/assign-scrolls',
    '/clan-boss/party',
    '/clan-boss/assault-start',
    '/clan-boss/assault-settle',
    // The world boss (2026-11-10): Cinderhold shinobi may stand in the boss's
    // sector while an event is live (api/_npc-roam.ts), but never queue, take
    // a party slot, turn in shards, contribute or collect anything. Each
    // handler also refuses an NPC itself, for in-process calls.
    '/world-boss-event',
    '/world-boss-event/queue',
    '/world-boss-event/settle',
];

/**
 * The one action an NPC token may take on a blocked route: registering a real
 * world duel it is fighting in for the sector war there (`/village/sector-war`
 * `attack`), so a war strike (api/_npc-war-strike.ts) or an admin-played NPC's
 * attack scores like a player's. Declaring, abandoning and the garrison stay
 * the server's.
 */
export const NPC_ALLOWED_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    '/village/sector-war': ['attack'],
});

function bodyAction(req: ApiRequest): string {
    let body: unknown = (req as { body?: unknown }).body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return ''; } }
    const action = (body as { action?: unknown } | null)?.action;
    return typeof action === 'string' ? action : '';
}

function header(req: ApiRequest, name: string): string {
    const value = (req.headers as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
}

export async function requestIsNpcAccount(req: ApiRequest): Promise<boolean> {
    const token = header(req, 'x-player-token');
    if (!token) return false;
    const name = await verifyPlayerToken(token).catch(() => null);
    return Boolean(name && isNpcAccount(name));
}

/**
 * Whether a named TARGET (a challenge, invite, trade or sleeper attack aimed at
 * someone) is a Cinderhold NPC. The NPCs answer only the world attack, which
 * the server plays (api/_npc-duel-driver.ts); anything else sent to them would
 * sit unanswered, or move value into an account that can never send it back.
 */
export function isNpcTarget(name: unknown): boolean {
    return isNpcAccount(safeName(String(name ?? '')));
}
export const NPC_TARGET_REFUSAL = "You can't challenge or follow NPCs.";

export function refuseNpcAccounts(handler: AnyHandler, allowedActions: readonly string[] = []): AnyHandler {
    return async (req, res) => {
        if (req.method !== 'OPTIONS' && !(allowedActions.length && allowedActions.includes(bodyAction(req))) && await requestIsNpcAccount(req)) {
            cors(res, req);
            return res.status(403).json({ error: 'Cinderhold shinobi cannot trade, donate, transfer, change their account or run a war by hand.' });
        }
        return handler(req, res);
    };
}

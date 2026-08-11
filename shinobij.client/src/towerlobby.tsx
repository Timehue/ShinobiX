// DEV-ONLY harness to eyeball the Battle Towers LOBBY without a server. Mocks the
// /api/towers/floors response. Served at /towerlobby.html by vite dev.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowersLobby } from "./screens/BattleTowersLobby";
import type { TowerFloorMeta, TowerPartyInvitationView, TowerPartyView } from "./lib/towers-api";

const F = (id: number, name: string, biome: string, objective: string, isBoss = false, milestone: string | null = null): TowerFloorMeta => {
    const strike = id === 7 ? { kind: "volley" as const, everyRounds: 3, firstRound: 3, radius: 1 }
        : id === 9 || id === 10 ? { kind: "nova" as const, everyRounds: 2, firstRound: 2, radius: 1 }
        : null;
    const bossMechanic = id === 5 ? "bulwark" : id === 7 ? "regen" : id === 9 ? "summon" : id === 10 ? "enrage" : null;
    const bossTargetMode = id === 5 ? "squishiest" as const : id === 7 ? "support" as const : isBoss ? "lowest-hp" as const : null;
    return {
        id, name, biome, objective, roundBudget: isBoss ? 16 : 8, isBoss, milestone,
        bossMechanic, bossTargetMode, bossStrike: strike,
        closingRing: id === 10 ? { fromRound: 11, minRadius: 3, percent: 3 } : null,
        dynamicHazards: [2, 3, 6, 9].includes(id) ? [{ kind: "geyser", everyRounds: 3, firstRound: id === 9 ? 2 : 3, count: id === 2 ? 3 : 4 }] : [],
        fieldRule: id === 3 ? { kind: "hazard", tag: "Drain", percent: 5 } : null,
        enemyCount: isBoss ? 7 : 9,
        reinforcementWaves: [2, 5, 7].includes(id) ? [2] : [],
        firstClearReward: {
            ryo: id * 400,
            statPoints: id * 4,
            fateShards: isBoss ? id * 2 : 0,
            boneCharms: id === 2 || id === 6 ? id + 3 : 0,
            milestone,
        },
        map: { width: isBoss ? 22 : 20, height: isBoss ? 16 : 14 },
    };
};
const MOCK = [
    F(1, "Foothold", "forest", "defeat-all"),
    F(2, "Crossfire Glade", "forest", "defeat-all"),
    F(3, "Frozen Gauntlet", "snow", "defeat-all"),
    F(4, "Hold the Line", "central", "protect-npc"),
    F(5, "Warden of the Spire", "volcano", "defeat-boss", true, "tower-floor-5"),
    F(6, "The Acolyte Coven", "shadow", "defeat-all"),
    F(7, "The Hollow Revenant", "shadow", "defeat-all-then-boss", true),
    F(8, "Escort the Vanguard", "central", "kill-escort"),
    F(9, "Pit of Embers", "volcano", "kill-adds-first", true),
    F(10, "The Spire Sovereign", "shadow", "defeat-boss", true, "tower-floor-10"),
];
const realFetch = window.fetch.bind(window);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
let mockParty: TowerPartyView | null = null;
const partyView = (party: TowerPartyView): TowerPartyView => {
    const required = party.binding.mode === "spire" ? 4 : null;
    const allReady = party.members.length > 0 && party.members.every(member => member.ready);
    const validSize = required == null ? party.members.length >= 2 && party.members.length <= 4 : party.members.length === required;
    return { ...party, sizeRequirements: { min: required ?? 2, max: 4, required }, allReady, canLaunch: party.status === "forming" && allReady && validSize };
};
const incomingParty = partyView({
    id: "tparty-fedcba9876543210fedcba9876543210", inviteCode: "KAZUROOM", hostSlug: "kazuto",
    binding: { mode: "story", floor: 3 }, status: "forming",
    members: [{ slug: "kazuto", displayName: "Kazuto Uzumaki", joinedAt: Date.now(), ready: false }],
    invitedSlugs: ["rill"], version: 3, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 7_200_000,
    sizeRequirements: { min: 2, max: 4, required: null }, allReady: false, canLaunch: false,
});
let mockInvitations: TowerPartyInvitationView[] = [{
    partyId: incomingParty.id, inviteCode: incomingParty.inviteCode, hostSlug: incomingParty.hostSlug,
    hostDisplayName: "Kazuto Uzumaki", binding: incomingParty.binding, memberCount: incomingParty.members.length,
    expiresAt: incomingParty.expiresAt,
}];
window.fetch = ((url: RequestInfo | URL, ...rest: unknown[]) => {
    const u = String(url);
    const init = rest[0] as RequestInit | undefined;
    if (u.includes("/api/towers/floors")) return json({ floors: MOCK });
    if (u.includes("/api/player/friends")) return json({ following: ["Kazuto", "Mira", "Daichi", "Yuki"] });
    if (u.includes("/api/towers/spire-leaderboard")) return json({ weekKey: "dev", total: 0, leaderboard: [] });
    if (u.includes("/api/towers/my-run")) return json({});
    if (u.includes("/api/towers/party") && (init?.method ?? "GET") === "GET") {
        const requestedIncomingParty = u.includes(`partyId=${encodeURIComponent(incomingParty.id)}`);
        return json({ party: requestedIncomingParty && !mockParty ? incomingParty : mockParty, invitations: mockInvitations });
    }
    if (u.includes("/api/towers/party") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        const action = String(body.action ?? "");
        if (action === "create") {
            const mode = body.mode === "spire" ? "spire" : "story";
            mockParty = partyView({
                id: "tparty-0123456789abcdef0123456789abcdef", inviteCode: "DEVROOM2", hostSlug: "rill",
                binding: mode === "spire" ? { mode, ascensionTier: Number(body.ascensionTier) } : { mode, floor: Number(body.floor) },
                status: "forming", members: [
                    { slug: "rill", displayName: "Rill", joinedAt: Date.now(), ready: false },
                    { slug: "mira", displayName: "Mira (dev ally)", joinedAt: Date.now(), ready: false },
                ],
                invitedSlugs: [], version: 1, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 7_200_000,
                sizeRequirements: { min: mode === "spire" ? 4 : 2, max: 4, required: mode === "spire" ? 4 : null }, allReady: false, canLaunch: false,
            });
        } else if (!mockParty) {
            return json({ error: "Create a dev room first.", errorCode: "party-not-found" }, 404);
        } else if (action === "ready" || action === "unready") {
            mockParty = partyView({ ...mockParty, version: mockParty.version + 1, members: mockParty.members.map(member => member.slug === "rill" ? { ...member, ready: action === "ready" } : member) });
        } else if (action === "invite") {
            const target = String(body.target ?? "").toLowerCase();
            mockParty = partyView({ ...mockParty, version: mockParty.version + 1, invitedSlugs: [...new Set([...mockParty.invitedSlugs, target])] });
        } else if (action === "revoke-invite") {
            const target = String(body.target ?? "").toLowerCase();
            mockParty = partyView({ ...mockParty, version: mockParty.version + 1, invitedSlugs: mockParty.invitedSlugs.filter(slug => slug !== target) });
        } else if (action === "kick") {
            const target = String(body.target ?? "").toLowerCase();
            mockParty = partyView({
                ...mockParty,
                version: mockParty.version + 1,
                members: mockParty.members.filter(member => member.slug !== target).map(member => ({ ...member, ready: false })),
            });
        } else if (action === "leave") {
            mockParty = null;
        } else if (action === "accept") {
            mockParty = partyView({
                ...incomingParty,
                version: incomingParty.version + 1,
                invitedSlugs: [],
                members: [...incomingParty.members, { slug: "rill", displayName: "Rill", joinedAt: Date.now(), ready: false }],
            });
            mockInvitations = [];
        } else if (action === "decline") {
            mockInvitations = [];
        } else if (action === "join") {
            if (String(body.inviteCode ?? "") !== incomingParty.inviteCode) {
                return json({ error: "That dev room code was not found.", errorCode: "party-not-found" }, 404);
            }
            mockParty = partyView({
                ...incomingParty,
                version: incomingParty.version + 1,
                invitedSlugs: [],
                members: [...incomingParty.members, { slug: "rill", displayName: "Rill", joinedAt: Date.now(), ready: false }],
            });
            mockInvitations = [];
        }
        return json({ party: mockParty, invitations: mockInvitations, replayed: false });
    }
    if (u.includes("/api/towers/start")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (body.mode === "spire" && !body.partyId) {
            return json({ error: "Spire progression requires a four-player Ready Room.", errorCode: "party-required", requiredPartySize: 4 }, 403);
        }
        return json({ error: "Fight launch is disabled in the lobby-only harness.", errorCode: "dev-harness" }, 409);
    }
    return realFetch(url, ...(rest as []));
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
    <BattleTowersLobby
        character={{ name: "Rill", level: 42, ryo: 12_000, battleTowerBestFloor: 4, battleTowerRating: 1840, battleTowerClearedFloors: [1, 2, 3, 4] } as never}
        updateCharacter={() => {}} onEnter={() => {}} onBack={() => {}}
    />,
);

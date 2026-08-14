// DEV-ONLY harness to eyeball the Battle Towers LOBBY without a server. Mocks the
// /api/towers/floors response. Served at /towerlobby.html by vite dev.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowersLobby } from "./screens/BattleTowersLobby";
import { GameConfirmHost } from "./components/GameAlert";
import type { TowerFloorMeta, TowerPartyInvitationView, TowerPartyView } from "./lib/towers-api";
import { FLOOR_CATALOG, type TowerFloor } from "../../api/towers/_floor-catalog";

function publicFloorMeta(floor: TowerFloor): TowerFloorMeta {
    const reward = floor.firstClearReward;
    return {
        id: floor.id,
        name: floor.name,
        chapter: floor.chapter ?? 1,
        chapterTitle: floor.chapterTitle ?? "The Celestial Ascent",
        ...(floor.chapterSubtitle ? { chapterSubtitle: floor.chapterSubtitle } : {}),
        ...(floor.chapterSummary ? { chapterSummary: floor.chapterSummary } : {}),
        ...(floor.artKey ? { artKey: floor.artKey } : {}),
        ...(floor.briefing ? { briefing: {
            situation: floor.briefing.situation,
            tactics: [...floor.briefing.tactics],
            warnings: [...floor.briefing.warnings],
        } } : {}),
        biome: floor.biome,
        objective: floor.objective,
        roundBudget: floor.roundBudget,
        isBoss: Boolean(floor.boss),
        bossMechanic: floor.boss?.mechanic ?? null,
        bossTargetMode: floor.boss?.targetMode ?? null,
        bossStrike: floor.boss?.strike ? {
            kind: floor.boss.strike.kind,
            everyRounds: Math.max(1, Math.floor(Number(floor.boss.strike.everyRounds ?? 1))),
            firstRound: Math.max(1, Math.floor(Number(floor.boss.strike.firstRound ?? floor.boss.strike.everyRounds ?? 1))),
            radius: Math.max(0, Math.floor(Number(floor.boss.strike.radius ?? 0))),
        } : null,
        closingRing: floor.closingRing ? {
            fromRound: Math.max(1, Math.floor(Number(floor.closingRing.fromRound ?? 1))),
            minRadius: Math.max(0, Math.floor(Number(floor.closingRing.minRadius ?? 0))),
            percent: Math.max(0, Number(floor.closingRing.pct ?? 0)),
        } : null,
        dynamicHazards: (floor.dynamicHazards ?? []).map(hazard => ({
            kind: hazard.kind,
            everyRounds: hazard.everyRounds,
            firstRound: hazard.firstRound ?? hazard.everyRounds,
            count: hazard.count,
        })),
        milestone: reward.milestone ?? null,
        fieldRule: floor.fieldRule.kind === "none" ? null : { ...floor.fieldRule },
        enemyCount: floor.enemies.reduce((sum, pod) => sum + pod.count, 0) + (floor.boss ? 1 : 0),
        phaseReinforcementCount: floor.boss?.mechanic === "summon"
            ? Math.max(0, Math.floor(Number(floor.boss.summonCount ?? 2))) * (floor.boss.phases?.length ?? 0)
            : 0,
        reinforcementWaves: [...new Set(floor.enemies
            .map(pod => Math.max(1, Math.floor(Number(pod.spawnRound ?? 1))))
            .filter(round => round > 1))].sort((a, b) => a - b),
        firstClearReward: {
            ryo: Math.max(0, Math.floor(Number(reward.ryo ?? 0))),
            statPoints: Math.max(0, Math.round(Number(reward.xp ?? 0) / 40)),
            fateShards: Math.max(0, Math.floor(Number(reward.fateShards ?? 0))),
            boneCharms: Math.max(0, Math.floor(Number(reward.boneCharms ?? 0))),
            milestone: reward.milestone ?? null,
        },
        map: { width: floor.map.width, height: floor.map.height },
    };
}

const MOCK = FLOOR_CATALOG.map(publicFloorMeta);
const realFetch = window.fetch.bind(window);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const harnessParams = new URLSearchParams(window.location.search);
const floorHarnessState = harnessParams.get("floors");
const showReadyCheck = harnessParams.get("pvp") === "ready";
const mockReadyMatch = {
    contractVersion: 1, matchId: "tpvp-0123456789abcdef0123456789abcdef", status: "ready", version: 3,
    createdAt: Date.now(), updatedAt: Date.now(), readyDeadlineAt: Date.now() + 45_000, turnDeadlineAt: null,
    roster: [
        { slug: "rill", displayName: "Rill", teamId: "amber", actorId: "amber-rill", ready: false, afkStrikes: 0, forfeited: false },
        { slug: "mira", displayName: "Mira of the Long Winter Name", teamId: "amber", actorId: "amber-mira", ready: true, afkStrikes: 0, forfeited: false },
        { slug: "daichi", displayName: "Daichi", teamId: "violet", actorId: "violet-daichi", ready: true, afkStrikes: 0, forfeited: false },
        { slug: "yuki", displayName: "Yuki", teamId: "violet", actorId: "violet-yuki", ready: false, afkStrikes: 0, forfeited: false },
    ],
    viewer: { teamId: "amber", actorId: "amber-rill" },
    rules: { teamSize: 2, rewards: "none", consumables: "disabled", rating: "none", progression: "none" },
    combat: null, settlement: null, cancellationReason: null,
};
type MockPvpMatch = typeof mockReadyMatch;
type MockPvpPresence =
    | { state: "idle"; match: null; queuePosition: null }
    | { state: "queued"; match: null; queuePosition: number; queuedAt: number }
    | { state: "matched"; match: MockPvpMatch; queuePosition: null };
let mockPvpPresence: MockPvpPresence = showReadyCheck
    ? { state: "matched", match: mockReadyMatch, queuePosition: null }
    : { state: "idle", match: null, queuePosition: null };
let mockParty: TowerPartyView | null = null;
const partyView = (party: TowerPartyView): TowerPartyView => {
    const required = party.binding.mode === "spire" ? 4 : null;
    const allReady = party.members.length > 0 && party.members.every(member => member.ready);
    const validSize = required == null ? party.members.length >= 2 && party.members.length <= 4 : party.members.length === required;
    const aiMemberCount = party.members.filter(member => member.ai).length;
    return {
        ...party,
        sizeRequirements: { min: required ?? 2, max: 4, required },
        allReady,
        canLaunch: party.status === "forming" && allReady && validSize,
        liveMemberCount: party.members.length - aiMemberCount,
        aiMemberCount,
        aiPolicy: { allowed: party.binding.mode === "story", max: party.binding.mode === "story" ? 1 : 0, profile: "story-recruit-v1", progressionEligible: false },
    };
};
const incomingParty = partyView({
    id: "tparty-fedcba9876543210fedcba9876543210", inviteCode: "KAZUROOM", hostSlug: "kazuto",
    binding: { mode: "story", floor: 3 }, status: "forming",
    members: [{ slug: "kazuto", displayName: "Kazuto Uzumaki", joinedAt: Date.now(), ready: false }],
    invitedSlugs: ["rill"], version: 3, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 7_200_000,
    sizeRequirements: { min: 2, max: 4, required: null }, allReady: false, canLaunch: false,
    liveMemberCount: 1, aiMemberCount: 0,
    aiPolicy: { allowed: true, max: 1, profile: "story-recruit-v1", progressionEligible: false },
});
let mockInvitations: TowerPartyInvitationView[] = [{
    partyId: incomingParty.id, inviteCode: incomingParty.inviteCode, hostSlug: incomingParty.hostSlug,
    hostDisplayName: "Kazuto Uzumaki", binding: incomingParty.binding, memberCount: incomingParty.members.length,
    expiresAt: incomingParty.expiresAt,
}];
window.fetch = ((url: RequestInfo | URL, ...rest: unknown[]) => {
    const u = String(url);
    const init = rest[0] as RequestInit | undefined;
    if (u.includes("/api/towers/floors")) {
        if (floorHarnessState === "error") return json({ error: "Tower catalog temporarily unavailable." }, 503);
        if (floorHarnessState === "empty") return json({ floors: [] });
        if (floorHarnessState === "loading") {
            return new Promise<Response>(resolve => window.setTimeout(() => {
                void json({ floors: MOCK }).then(resolve);
            }, 1_800));
        }
        return json({ floors: MOCK });
    }
    if (u.includes("/api/player/friends")) return json({ following: ["Kazuto", "Mira", "Daichi", "Yuki"] });
    if (u.includes("/api/towers/spire-leaderboard")) return json({ weekKey: "dev", total: 0, leaderboard: [] });
    if (u.includes("/api/towers/my-run")) return json({});
    if (u.includes("/api/towers/pvp-queue") && (init?.method ?? "GET") === "GET") {
        return json({ presence: mockPvpPresence });
    }
    if (u.includes("/api/towers/pvp-queue") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        const currentMatch = mockPvpPresence.state === "matched" ? mockPvpPresence.match : null;
        if (body.action === "ready" && currentMatch) {
            const nextMatch = {
                ...currentMatch,
                version: currentMatch.version + 1,
                roster: currentMatch.roster.map(member => member.slug === "rill" ? { ...member, ready: Boolean(body.ready) } : member),
            };
            mockPvpPresence = { state: "matched", match: nextMatch, queuePosition: null };
            return json({ replayed: false, match: nextMatch });
        }
        if (body.action === "join") {
            mockPvpPresence = { state: "queued", match: null, queuePosition: 1, queuedAt: Date.now() };
            return json({ replayed: false, presence: mockPvpPresence });
        }
        mockPvpPresence = { state: "idle", match: null, queuePosition: null };
        return json({ replayed: false, match: null, presence: mockPvpPresence });
    }
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
                liveMemberCount: 2, aiMemberCount: 0,
                aiPolicy: { allowed: mode === "story", max: mode === "story" ? 1 : 0, profile: "story-recruit-v1", progressionEligible: false },
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
        } else if (action === "add-ai") {
            const slot = [1, 2, 3].find(index => !mockParty?.members.some(member => member.slug === `tower-ai:${index}`)) ?? 1;
            mockParty = partyView({
                ...mockParty,
                version: mockParty.version + 1,
                members: [
                    ...mockParty.members.map(member => member.ai ? member : { ...member, ready: false }),
                    { slug: `tower-ai:${slot}`, displayName: `Tower Recruit ${slot} (AI)`, joinedAt: Date.now(), ready: true, ai: true, aiProfile: "story-recruit-v1" },
                ],
            });
        } else if (action === "remove-ai") {
            const target = String(body.target ?? "");
            mockParty = partyView({
                ...mockParty,
                version: mockParty.version + 1,
                members: mockParty.members.filter(member => member.slug !== target).map(member => member.ai ? member : { ...member, ready: false }),
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

const root = createRoot(document.getElementById("root")!);
root.render(
    <>
        <BattleTowersLobby
            character={{ name: "Rill", level: 42, ryo: 12_000, battleTowerBestFloor: 10, battleTowerRating: 1840, battleTowerClearedFloors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } as never}
            updateCharacter={() => {}} onEnter={() => {}} onEnterPvp={() => {}} onPvpMatchChange={() => {}} onBack={() => {}}
        />
        <GameConfirmHost />
    </>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());

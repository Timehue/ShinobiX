import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    capabilityAdmissionAllowed,
    capabilityPreferenceAllowsAdmission,
    isVillageWarDedicatedScreen,
    mutationAdmissionMessage,
    playerSurfaceBlockerMode,
    playerLoginAdmissionMessage,
    registrationAdmissionMessage,
    sectorMapAdmissionMessage,
    villageWarScreenMountAllowed,
} from "./live-capability-admission";

test("new admissions fail closed until public capability truth is available", () => {
    assert.equal(capabilityAdmissionAllowed("available"), true);
    assert.equal(capabilityAdmissionAllowed("unavailable"), false);
    assert.equal(capabilityAdmissionAllowed("unknown"), false);

    assert.equal(capabilityPreferenceAllowsAdmission(true, "available"), true);
    assert.equal(capabilityPreferenceAllowsAdmission(true, "unknown"), false);
    assert.equal(capabilityPreferenceAllowsAdmission(true, "unavailable"), false);
    assert.equal(capabilityPreferenceAllowsAdmission(false, "available"), false);
});

test("only dedicated Sector campaign screens are blocked by village-war truth", () => {
    for (const screen of ["villageWarMap", "sectorCard", "sectorPet"] as const) {
        assert.equal(isVillageWarDedicatedScreen(screen), true);
        assert.equal(villageWarScreenMountAllowed(screen, "unknown"), false);
        assert.equal(villageWarScreenMountAllowed(screen, "unavailable"), false);
        assert.equal(villageWarScreenMountAllowed(screen, "available"), true);
    }

    assert.equal(isVillageWarDedicatedScreen("villageWar"), false);
    assert.equal(villageWarScreenMountAllowed("villageWar", "unavailable"), true);
    assert.match(sectorMapAdmissionMessage("unavailable"), /Sector campaign operations/);
    assert.match(sectorMapAdmissionMessage("unavailable"), /legacy War Hall remains open/);
    assert.match(registrationAdmissionMessage("unknown"), /Existing players can still log in/);
});

test("maintenance and mutation-freeze copy preserves operator, legal, read, and recovery access", () => {
    assert.match(playerLoginAdmissionMessage("unknown"), /admin and legal access remain available/i);
    assert.match(playerLoginAdmissionMessage("unavailable"), /maintenance/i);
    assert.match(playerLoginAdmissionMessage("unavailable"), /admin and legal access remain available/i);
    assert.match(registrationAdmissionMessage("unavailable"), /Existing players can still log in/);
    assert.match(mutationAdmissionMessage("unavailable"), /Read-only status and active recovery remain available/i);

    assert.equal(playerSurfaceBlockerMode(false, "start", "unknown"), "checking");
    assert.equal(playerSurfaceBlockerMode(false, "start", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(false, "start", "available"), null);
    assert.equal(playerSurfaceBlockerMode(true, "start", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "adminLogin", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "adminPanel", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "home", "available"), null);
    assert.equal(playerSurfaceBlockerMode(true, "home", "unknown"), "checking");
    assert.equal(playerSurfaceBlockerMode(true, "home", "unavailable"), "maintenance");
});

test("App and admission surfaces consume live capability truth at both boundaries", () => {
    const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
    const start = readFileSync("shinobij.client/src/screens/StartScreen.tsx", "utf8");
    const townHall = readFileSync("shinobij.client/src/screens/TownHall.tsx", "utf8");
    const vanguard = readFileSync("shinobij.client/src/screens/professions/VanguardHub.tsx", "utf8");
    const desktop = readFileSync("shinobij.client/src/components/RightMenu.tsx", "utf8");
    const mobile = readFileSync("shinobij.client/src/components/MobileNav.tsx", "utf8");
    const worldMap = readFileSync("shinobij.client/src/screens/WorldMap.tsx", "utf8");

    assert.match(app, /useCapabilityViewAvailability\("villageWar"\)/);
    assert.match(app, /villageWarScreenMountAllowed\(screen, villageWarAvailability\)/);
    assert.match(app, /const currentVillageWarAvailability = viewAvailability\("villageWar"\);[\s\S]*villageWarScreenMountAllowed\(nextScreen, currentVillageWarAvailability\)/);
    assert.match(app, /const currentRegistration = mutationAvailability\("registrations"\);[\s\S]*if \(!capabilityAdmissionAllowed\(currentRegistration\)\)/);
    assert.match(app, /const currentAvailability = viewAvailability\(\);[\s\S]*if \(!capabilityAdmissionAllowed\(currentAvailability\)\)/);
    assert.match(start, /useCapabilityMutationAvailability\("registrations"\)/);
    assert.match(start, /useCapabilityViewAvailability\(\)/);
    assert.match(start, /creatorAdmissionGranted/);
    assert.match(start, /if \(!registrationOpen\) \{\s*alert\(registrationMessage\)/);
    assert.match(start, /if \(normalizeAdminName\(loginName\)\) \{[\s\S]*onAdmin\(loginPassword\);[\s\S]*if \(!playerLoginOpen\)/);
    assert.match(start, /disabled=\{!!loginStatus \|\| \(!playerLoginOpen && !normalizeAdminName\(loginName\)\)\}/);
    assert.match(start, /if \(view\.startsWith\("legal:"\)\) \{\s*return <LegalPage/);
    assert.match(townHall, /useCapabilityViewAvailability\("villageWar"\)/);
    assert.match(vanguard, /useCapabilityViewAvailability\("villageWar"\)/);
    assert.match(desktop, /target === "villageWarMap"/);
    assert.match(mobile, /target === "villageWarMap"/);
    assert.match(worldMap, /useCapabilityViewAvailability\("villageWar"\)/);
    assert.match(worldMap, /useCapabilityMutationAvailability\("villageWar"\)/);
    assert.match(worldMap, /useCapabilityViewAvailability\("anbuInfiltration"\)/);
    assert.match(worldMap, /useCapabilityMutationAvailability\("anbuInfiltration"\)/);
    assert.match(worldMap, /if \(!legacyAvailable\) \{ setLegacyServerLive\(false\); return; \}/);
    assert.match(worldMap, /if \(!legacyAvailable \|\| !legacyServerLive/);
});

test("transient unknown Sector truth preserves a pending deep link until explicit unavailability", () => {
    const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
    const redirectEffect = app.match(/useEffect\(\(\) => \{\s*if \(villageWarAvailability !== "unavailable"[\s\S]*?\}, \[screen, villageWarAvailability, character\]\);/)?.[0] ?? "";
    assert.ok(redirectEffect, "Sector redirect effect is present");
    assert.match(redirectEffect, /villageWarAvailability !== "unavailable"/);
    assert.match(redirectEffect, /setScreen\(fallback\)/);
    assert.doesNotMatch(redirectEffect, /villageWarAvailability === "unknown"/);
    assert.match(app, /screen === "villageWarMap" && villageWarScreenMountAllowed\(screen, villageWarAvailability\)/);
});

test("global maintenance pauses player restore and polling while preserving operator surfaces", () => {
    const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
    const blocker = readFileSync("shinobij.client/src/components/PlayerSurfaceBlocker.tsx", "utf8");
    const boundary = readFileSync("shinobij.client/src/components/MaintenanceOperatorBoundary.tsx", "utf8");
    const diagnostics = readFileSync("shinobij.client/src/screens/AdminDiagnosticsPanel.tsx", "utf8");
    const entry = readFileSync("shinobij.client/src/main.tsx", "utf8");
    const authFetch = readFileSync("shinobij.client/src/authFetch.ts", "utf8");
    assert.match(app, /if \(!gameplayViewOpen \|\| bootRestoreStartedRef\.current\) return;/);
    assert.match(app, /if \(!gameplayViewOpen \|\| !tabVisible\) return;/);
    assert.match(app, /characterName: gameplayViewOpen \? character\?\.name : undefined/);
    assert.match(app, /const surfaceBlockerMode = playerSurfaceBlockerMode\(Boolean\(character\), screen, gameplayViewAvailability\)/);
    assert.doesNotMatch(app, /if \(surfaceBlockerMode\)\s*\{\s*return/, "maintenance must not unmount the player subtree");
    assert.match(app, /<MaintenanceOperatorBoundary mode=\{surfaceBlockerMode\}>\s*<AdaptiveGameShell/);
    assert.match(boundary, /const operatorRecoveryOpen = operatorView !== null/);
    assert.match(boundary, /const playerSurfaceBlocked = mode !== null \|\| operatorRecoveryOpen/);
    assert.match(boundary, /<div inert=\{playerSurfaceBlocked\} style=\{\{ display: "contents" \}\}>[\s\S]*<Activity name="player-surface" mode=\{playerSurfaceBlocked \? "hidden" : "visible"\}>\s*\{children\}/,
        "the state-preserving Activity boundary must clean up all mounted leaf effects while blocked");
    assert.match(boundary, /playerSurfaceBlocked && \([\s\S]*<PlayerSurfaceBlocker[\s\S]*mode=\{mode \?\? "checking"\}/);
    assert.match(boundary, /onOperatorRecovery=\{\(\) => setOperatorView\("login"\)\}/);
    assert.match(boundary, /operatorSurface=\{operatorSurface\}/);
    assert.doesNotMatch(app, /onOperatorRecovery=\{\(\) => setScreen\(/, "operator recovery must not navigate or unmount the paused player screen");
    assert.match(blocker, /dialog\.showModal\(\)/, "the full-screen blocker must use the modal top layer so portals are inert too");
    assert.match(blocker, /data-operator-recovery-surface/);
    assert.match(blocker, /operatorRecoveryOpen \? "operator-recovery-title" : "player-surface-blocker-title"/);
    assert.match(blocker, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); \}\}/);
    assert.match(blocker, /<a href="\/terms">Terms<\/a>[\s\S]*<a href="\/privacy">Privacy<\/a>/);
    assert.match(entry, /const legalSlug = \(\(\) => \{[\s\S]*legalPageForPath\(window\.location\.pathname\)/);
    assert.match(entry, /legalSlug \? \([\s\S]*<LegalPage slug=\{legalSlug\} \/>[\s\S]*\) : \([\s\S]*<LiveCapabilitiesProvider>/,
        "exact legal paths must render before the capability provider and maintenance boundary mount");
    assert.match(blocker, /current screen and resumable operation state remain mounted and preserved/);
    assert.match(app, /screen === "start" && \(!restoringSession \|\| gameplayViewAvailability === "unavailable"\)/);
    assert.match(authFetch, /export function installAuthFetch\(\): void \{\s*if \(installed \|\| typeof window === 'undefined' \|\| !window\.fetch\) return;[\s\S]*clearRecoveryAdminSession\(\);\s*installed = true;/,
        "the interceptor must consume recovery-owned credentials synchronously on boot before it can attach them");
    assert.match(boundary, /if \(!setRecoveryAdminSession\(token, password\)\) \{[\s\S]*return;\s*\}\s*recoveryAdminSessionRef\.current = true;[\s\S]*setOperatorView\("diagnostics"\)/,
        "operator diagnostics open only after server-backed AdminLogin succeeds");
    assert.match(boundary, /if \(recoveryAdminSessionRef\.current\) \{\s*recoveryAdminSessionRef\.current = false;\s*clearRecoveryAdminSession\(\)/,
        "closing recovery clears only the admin credential established by this isolated boundary");
    assert.match(boundary, /OperatorDiagnostics adminPw=\{adminPassword\}/);
    assert.match(boundary, /authenticated diagnostics and bounded recovery actions/);
    assert.match(diagnostics, /fetch\("\/api\/admin\/economy-reconcile", \{[\s\S]*method: "POST"/);
    assert.match(diagnostics, /fetch\("\/api\/admin\/clan-boss-operations", \{[\s\S]*method: "POST"/);
    assert.doesNotMatch(boundary, /<AdminPanel|\.\.\/screens\/AdminPanel"|onSave=|setCharacter\(|setCurrentAccountName\(|commitVersionedCharacter|pushSaveToServer/,
        "operator recovery must not mount an editor, claim a false save, or touch player save authority");
});

test("App rechecks live mutation admission inside delayed save callbacks", () => {
    const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
    const autosave = readFileSync("shinobij.client/src/lib/use-capability-guarded-autosave.ts", "utf8");
    assert.match(app, /useCapabilityGuardedAutosave\(\{/);
    assert.match(autosave, /const persistDirtySnapshot = useEffectEvent\([\s\S]*capabilityAdmissionAllowed\(mutationAvailability\(\)\)[\s\S]*void persistSave\(snapshot\)/);
    assert.match(autosave, /setTimeout\(\(\) => \{[\s\S]*persistDirtySnapshot\(\)[\s\S]*\}, 3000\)/);
    assert.match(autosave, /setInterval\(persistDirtySnapshot, 15_000\)/);
    assert.match(autosave, /const flushDirtySnapshot = useEffectEvent\([\s\S]*capabilityAdmissionAllowed\(mutationAvailability\(\)\)[\s\S]*void persistSave\(snapshot\)/);
});

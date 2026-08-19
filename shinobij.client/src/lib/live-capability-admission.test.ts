import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    capabilityAdmissionAllowed,
    capabilityAdmissionOpenUntilRefused,
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
    for (const screen of ["villageWarMap", "sectorCard", "sectorPet", "sectorGarrison"] as const) {
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

    assert.equal(playerSurfaceBlockerMode(false, "start", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(false, "start", "available"), null);
    assert.equal(playerSurfaceBlockerMode(true, "start", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "adminLogin", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "adminPanel", "unavailable"), "maintenance");
    assert.equal(playerSurfaceBlockerMode(true, "home", "available"), null);
    assert.equal(playerSurfaceBlockerMode(true, "home", "unavailable"), "maintenance");
});

// A cold or aged capability read is not an incident, and it happens on every
// single page load. Blocking the whole surface on it put a full-screen
// "Checking live service availability" dialog in front of players on every
// refresh, and again whenever two polls in a row missed mid-session. Only the
// server saying "unavailable" earns that dialog now; the boot check renders
// nothing, and MAINTENANCE_MODE is enforced server-side anyway.
test("a capability check that is merely in flight never blocks the player surface", () => {
    assert.equal(playerSurfaceBlockerMode(false, "start", "unknown"), null);
    assert.equal(playerSurfaceBlockerMode(true, "home", "unknown"), null);
    assert.equal(playerSurfaceBlockerMode(true, "villageWarMap", "unknown"), null);

    // Doors that are visible before truth arrives stay open on cold truth and
    // close only on an explicit refusal. Progress-committing admissions keep
    // using capabilityAdmissionAllowed, which still fails closed on "unknown".
    assert.equal(capabilityAdmissionOpenUntilRefused("available"), true);
    assert.equal(capabilityAdmissionOpenUntilRefused("unknown"), true);
    assert.equal(capabilityAdmissionOpenUntilRefused("unavailable"), false);
    assert.equal(capabilityAdmissionAllowed("unknown"), false);
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
    // Both sign-in doors SETTLE cold truth rather than refusing it. Refusing on
    // "unknown" turned the boot capability round-trip into a player-facing
    // "still checking" alert on any click that beat it; awaiting the coalesced
    // request yields a real answer, and only "unavailable" turns anyone away.
    assert.match(app, /const currentRegistration = await settleAdmission\(\(\) => mutationAvailability\("registrations"\), refreshCapabilities\);[\s\S]*if \(currentRegistration === "unavailable"\)/);
    assert.match(app, /const currentAvailability = await settleAdmission\(\(\) => viewAvailability\(\), refreshCapabilities\);[\s\S]*if \(currentAvailability === "unavailable"\)/);
    // A capability refresh that cannot reach the server must not invent a
    // refusal: api/_launch-controls.ts 503s both actions during MAINTENANCE_MODE
    // and is the authority. So the helper returns the read as-is and the caller
    // only ever refuses on an explicit "unavailable".
    const admission = readFileSync("shinobij.client/src/lib/live-capability-admission.ts", "utf8");
    assert.match(admission, /export async function settleAdmission\([\s\S]{0,200}?if \(read\(\) !== "unknown"\) return read\(\);\s*await refresh\(\);\s*return read\(\);/);
    assert.doesNotMatch(app, /settleAdmission[\s\S]{0,400}?capabilityAdmissionAllowed\(current/,
        "a settled sign-in read must not be re-narrowed by the fail-closed helper");
    assert.match(start, /useCapabilityMutationAvailability\("registrations"\)/);
    assert.match(start, /useCapabilityViewAvailability\(\)/);
    assert.match(start, /creatorAdmissionGranted/);
    // The registration gate is enforced where the creator is OPENED rather than
    // at its submit. Every door into signup — password, guest, and the Google
    // return — routes through openCreator, so a paused registration is refused
    // once, before the player fills anything in, and the "create" view still
    // checks creatorAdmissionGranted so a direct navigation cannot skip it.
    assert.match(start, /function openCreator\([\s\S]{0,160}?if \(!registrationOpen\) return;/);
    assert.match(start, /\{registrationMessage\}/,
        "the paused-registration surface must still say WHY it is paused");

    // The login form moved out of StartScreen into start/LoginGate.tsx when the
    // sign-in gate was rebuilt around the passwordless doors. Its admin routing
    // came with it, renamed: only "admin2" auto-routes, and Admin 1 deliberately
    // does not, so it stays gated behind both passwords.
    const loginGate = readFileSync("shinobij.client/src/screens/start/LoginGate.tsx", "utf8");
    assert.match(loginGate, /isAdminTwo\(loginName\)\)\s*\{\s*onAdmin\(loginPassword\);\s*return;/);
    assert.doesNotMatch(loginGate, /["']admin1["']/i,
        "Admin 1 must never auto-route from the player login form");
    // Player-login availability is no longer gated inside the form. It is gated
    // for the whole surface by App's playerSurfaceBlockerMode (asserted above and
    // unit-tested at the top of this file), which covers the landing screen too —
    // an in-form copy would be a second, drifting owner of the same rule.
    assert.match(app, /playerSurfaceBlockerMode\(/);
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
    const accountMarkerPersistence = app.match(
        /useEffect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(restoringSession\) return;[\s\S]*?localStorage\.setItem\([\s\S]*?\}, \[\s*currentAccountName,\s*restoringSession,\s*\]\);/,
    )?.[0] ?? "";
    assert.ok(accountMarkerPersistence, "the guarded account-marker persistence effect is present");
    assert.match(accountMarkerPersistence, /if \(restoringSession\) return;[\s\S]*localStorage\.setItem\([\s\S]*STORAGE/,
        "cold capability discovery must not erase the durable account before boot restore can read it");
    assert.match(accountMarkerPersistence, /\[\s*currentAccountName,\s*restoringSession,\s*\]\);/,
        "account persistence must re-run after boot restore resolves");
    assert.match(app, /if \(!gameplayViewOpen \|\| !tabVisible\) return;/);
    assert.match(app, /characterName: gameplayViewOpen \? character\?\.name : undefined/);
    assert.match(app, /const surfaceBlockerMode = playerSurfaceBlockerMode\(Boolean\(character\), screen, gameplayViewAvailability\)/);
    assert.doesNotMatch(app, /if \(surfaceBlockerMode\)\s*\{\s*return/, "maintenance must not unmount the player subtree");
    assert.match(app, /<MaintenanceOperatorBoundary mode=\{surfaceBlockerMode\}>\s*<AdaptiveGameShell/);
    assert.match(boundary, /const operatorRecoveryOpen = operatorView !== null/);
    assert.match(boundary, /const playerSurfaceBlocked = mode !== null \|\| operatorRecoveryOpen/);
    assert.match(boundary, /<div inert=\{playerSurfaceBlocked\} style=\{\{ display: "contents" \}\}>[\s\S]*<Activity name="player-surface" mode=\{playerSurfaceBlocked \? "hidden" : "visible"\}>\s*\{children\}/,
        "the state-preserving Activity boundary must clean up all mounted leaf effects while blocked");
    // The blocker takes no mode: cold capability truth no longer raises it at
    // all, so "maintenance" is the only surface left and there is nothing to
    // select. Pin that it still renders only when the surface is blocked, and
    // that it cannot regain a mode without this assertion failing.
    assert.match(boundary, /playerSurfaceBlocked && \(\s*<PlayerSurfaceBlocker\s+onOperatorRecovery=/);
    assert.doesNotMatch(blocker, /"checking"/,
        "the cold-truth blocker mode is removed, not merely unreachable");
    assert.doesNotMatch(blocker, /Checking live service availability/,
        "the string players saw on every refresh must not exist in the shipped component");
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

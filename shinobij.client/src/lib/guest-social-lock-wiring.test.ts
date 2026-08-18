/*
 * Contract test: every screen that can send player-visible text consults the
 * server's lock, and none of them re-derive it locally.
 *
 * The server gate in `api/_guest-gate.ts` is the enforcement, so losing a line
 * here opens nothing — but it does hand a guest a compose box that answers 403,
 * which reads as a broken game rather than a rule. These assertions are all
 * single-line needles on purpose: a worktree with CRLF checkouts would fail any
 * needle that spanned a line break, for reasons unrelated to the wiring.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("guest social lock — client wiring", () => {
    it("shuts the whole tavern, and stops it polling endpoints that would 403", () => {
        const tavern = source("../screens/VillageTavern.tsx");
        assert.match(tavern, /import \{ GuestSocialLock \} from "\.\.\/components\/GuestSocialLock";/);
        assert.match(tavern, /useSocialLock\(character\.name\)/);
        assert.match(tavern, /\{locked && \(/);
        assert.match(tavern, /<GuestSocialLock what=/);
        // Both polls bail while locked OR still unanswered, so a locked guest
        // never issues a request the server is going to refuse.
        assert.equal((tavern.match(/if \(locked \|\| lockLoading\) return;/g) ?? []).length, 2);
        assert.match(tavern, /\}, \[character\.village, locked, lockLoading\]\);/);
        // The log and the composer both live behind the same guard.
        assert.match(tavern, /\{!locked && !lockLoading && \(<>/);
    });

    it("keeps mail readable but removes both composers", () => {
        const messages = source("../screens/Messages.tsx");
        assert.match(messages, /useSocialLock\(character\.name\)/);
        assert.match(messages, /const composeDisabled = sendLocked \|\| lockLoading;/);
        // Two composers: the in-thread reply and the new-conversation form.
        assert.equal((messages.match(/\{sendLocked \? \(/g) ?? []).length, 2);
        assert.equal((messages.match(/<GuestSocialLock compact what=/g) ?? []).length, 2);
        // Reading is untouched — the inbox and thread fetches carry no guard.
        assert.match(messages, /const r = await fetch\(`\/api\/messages\?with=\$\{encodeURIComponent\(withName\)\}`\);/);
    });

    it("keeps clan chat readable but removes the composer", () => {
        const chat = source("../screens/ClanChat.tsx");
        assert.match(chat, /useSocialLock\(playerName\)/);
        assert.match(chat, /\{sendLocked \? \(/);
        assert.match(chat, /<GuestSocialLock compact what=/);
        assert.match(chat, /disabled=\{busy \|\| lockLoading \|\| !text\.trim\(\)\}/);
    });

    it("disables battle chat in place, treating an unanswered lock as locked", () => {
        const pvp = source("../screens/PvpBattleScreen.tsx");
        assert.match(pvp, /useSocialLock\(character\.name\)/);
        // `loading` folds into `locked` here because this sender appends
        // optimistically — a rejected line would otherwise stay in the log.
        assert.match(pvp, /const battleChatLocked = guestChatLocked \|\| guestChatLockLoading;/);
        assert.match(pvp, /if \(battleChatLocked\) return;/);
        assert.match(pvp, /disabled=\{battleChatLocked\}/);
        // The row itself is NOT swapped for a panel: the combat layout matrix
        // measures this DOM, so the lock must not restructure it.
        assert.doesNotMatch(pvp, /<GuestSocialLock/);
    });

    it("re-reads the standing at both moments a guest becomes a real account", () => {
        // Password: handled here. Google: a full redirect out and back, so the
        // module cache starts cold and needs no explicit refresh.
        const card = source("../components/ChangePasswordCard.tsx");
        assert.match(card, /import \{ refreshAccountStatus \} from "\.\.\/lib\/account-status";/);
        assert.match(card, /void refreshAccountStatus\(\);/);
    });

    it("takes the lock from the server and never from localStorage", () => {
        // The pre-existing guest signal (`loadGuestSession`) is browser-local
        // and player-editable. A lock derived from it would disagree with the
        // server on a second device and could be switched off from devtools.
        const lib = source("./account-status.ts");
        assert.match(lib, /const ENDPOINT = "\/api\/player\/account-status";/);
        assert.doesNotMatch(lib, /loadGuestSession/);
        // Member access, not the word — the header comment explains why the
        // localStorage signal is the wrong source, and should keep saying so.
        assert.doesNotMatch(lib, /localStorage\s*\./);
        // `socialLocked` is read straight through, never recomputed from `guest`.
        assert.match(lib, /locked: status\?\.socialLocked === true,/);
        assert.doesNotMatch(lib, /locked: status\?\.guest/);

        for (const screen of ["../screens/VillageTavern.tsx", "../screens/Messages.tsx", "../screens/ClanChat.tsx"]) {
            assert.doesNotMatch(source(screen), /loadGuestSession/, `${screen} must not re-derive guest status locally`);
        }
    });
});

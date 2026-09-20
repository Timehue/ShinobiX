import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { setActivePlayer, setActiveToken } from "../authFetch";
import { getUnreadMail, refreshUnreadMail } from "./mail-unread";

/*
 * The unread-mail badge polls /api/messages every 30s while it is mounted. That
 * endpoint is player-scoped: authedPlayerOrAdmin answers 403 for an admin
 * identity and 401 for no identity, so a poll made without a player credential
 * cannot return an inbox — it can only log a console error. An operator sitting
 * on the admin panel therefore collected one red line every 30 seconds.
 *
 * The guard has to key off the SAME condition the fetch interceptor uses to
 * attach a credential, or it desynchronises from it. In particular it must let
 * the token-less password fallback through: when the server runs without
 * SESSION_SECRET no token is ever minted, and a guard that demanded one would
 * silently stop the badge for every player on that deployment.
 */

/** Fresh in-memory sessionStorage AND localStorage — the identity helpers write to both. */
function installStorage(): () => void {
    const previous = (["sessionStorage", "localStorage"] as const)
        .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key] of previous) {
        const values = new Map<string, string>();
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (k) => values.get(k) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (k) => { values.delete(k); },
            setItem: (k, value) => { values.set(k, String(value)); },
        };
        Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    }
    return () => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete (globalThis as Record<string, unknown>)[key];
        }
    };
}

type Call = string;

/** Stub fetch with an inbox payload; returns the recorded request URLs. */
function installFetch(inbox: unknown): Call[] {
    const calls: Call[] = [];
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: (input: string) => {
            calls.push(String(input));
            return Promise.resolve({ ok: true, json: () => Promise.resolve(inbox) });
        },
    });
    return calls;
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("unread-mail poller identity guard", () => {
    it("makes no request when no player is signed in", async () => {
        const restore = installStorage();
        try {
            setActivePlayer(null);
            const calls = installFetch([{ with: "someone", unread: 4 }]);
            refreshUnreadMail();
            await settle();
            assert.deepEqual(calls, [], "an admin-only or logged-out session must not hit /api/messages");
        } finally {
            restore();
        }
    });

    it("polls for a token-authenticated player", async () => {
        const restore = installStorage();
        try {
            setActivePlayer("Kaito", null);
            setActiveToken("a.token.value");
            const calls = installFetch([{ with: "Rin", unread: 2 }, { with: "Sora", unread: 3 }]);
            refreshUnreadMail();
            await settle();
            assert.deepEqual(calls, ["/api/messages"]);
            assert.equal(getUnreadMail(), 5);
        } finally {
            restore();
        }
    });

    it("polls on the token-less password fallback", async () => {
        const restore = installStorage();
        try {
            // SESSION_SECRET unset server-side: a name and the memory-only
            // password are the whole credential, and the badge must still work.
            setActivePlayer("Kaito", "correct horse");
            setActiveToken(null);
            const calls = installFetch([{ with: "Rin", unread: 7 }]);
            refreshUnreadMail();
            await settle();
            assert.deepEqual(calls, ["/api/messages"]);
            assert.equal(getUnreadMail(), 7);
        } finally {
            restore();
        }
    });
});

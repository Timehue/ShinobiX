import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceFromReferrer, getSurface, canUsePlayBilling, isAppShell, APP_SHELL_UA_TOKEN, resetSurfaceCacheForTests } from "./surface";

// ── Pure referrer parsing ───────────────────────────────────────────────────

test("a plain web visit is the web surface", () => {
    assert.equal(surfaceFromReferrer(""), "web");
    assert.equal(surfaceFromReferrer("https://google.com/"), "web");
    assert.equal(surfaceFromReferrer("https://shinobijourney.com/"), "web");
});

test("Chrome's android-app referrer identifies the Play app", () => {
    assert.equal(surfaceFromReferrer("android-app://com.shinobijourney.app"), "play-app");
    assert.equal(surfaceFromReferrer("android-app://com.shinobijourney.app/"), "play-app");
});

test("pinning the package rejects a launch from somebody else's Android app", () => {
    const ours = "com.shinobijourney.app";
    assert.equal(surfaceFromReferrer("android-app://com.shinobijourney.app", ours), "play-app");
    assert.equal(surfaceFromReferrer("android-app://com.someone.else", ours), "web");
});

test("a missing or malformed referrer never throws", () => {
    assert.equal(surfaceFromReferrer(undefined as unknown as string), "web");
    assert.equal(surfaceFromReferrer("android-app://"), "play-app");
});

// ── Runtime resolution + persistence ────────────────────────────────────────

type FakeStore = { store: Map<string, string>; throwOnGet?: boolean; throwOnSet?: boolean };

function installFakeWindow(referrer: string, opts: Partial<FakeStore> = {}) {
    const state: FakeStore = { store: new Map(), ...opts };
    const sessionStorage = {
        getItem(k: string) {
            if (state.throwOnGet) throw new Error("private mode");
            return state.store.get(k) ?? null;
        },
        setItem(k: string, v: string) {
            if (state.throwOnSet) throw new Error("private mode");
            state.store.set(k, v);
        },
    };
    (globalThis as Record<string, unknown>).window = { sessionStorage };
    (globalThis as Record<string, unknown>).document = { referrer };
    resetSurfaceCacheForTests();
    return state;
}

function clearFakeWindow() {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
    resetSurfaceCacheForTests();
}

test("a TWA launch resolves to play-app and is remembered for the tab", () => {
    const state = installFakeWindow("android-app://com.shinobijourney.app");
    try {
        assert.equal(getSurface(), "play-app");
        // Persisted, because the proving referrer is gone after a reload.
        assert.equal(state.store.get("shinobix:surface.v1"), "play-app");
    } finally { clearFakeWindow(); }
});

test("a reload that lost the referrer still reads play-app from the stored verdict", () => {
    const state = installFakeWindow("android-app://com.shinobijourney.app");
    getSurface();
    clearFakeWindow();

    // Same tab, fresh document, no referrer — the stored verdict must win.
    (globalThis as Record<string, unknown>).window = {
        sessionStorage: { getItem: (k: string) => state.store.get(k) ?? null, setItem: () => {} },
    };
    (globalThis as Record<string, unknown>).document = { referrer: "" };
    resetSurfaceCacheForTests();
    try {
        assert.equal(getSurface(), "play-app");
    } finally { clearFakeWindow(); }
});

test("a web verdict is NOT persisted, so a later real launch can still win", () => {
    const state = installFakeWindow("");
    try {
        assert.equal(getSurface(), "web");
        assert.equal(state.store.has("shinobix:surface.v1"), false);
    } finally { clearFakeWindow(); }
});

test("private-mode storage throwing never breaks boot", () => {
    installFakeWindow("android-app://com.shinobijourney.app", { throwOnGet: true, throwOnSet: true });
    try {
        assert.equal(getSurface(), "play-app");
    } finally { clearFakeWindow(); }
});

test("no window at all (SSR / node) is the web surface", () => {
    clearFakeWindow();
    assert.equal(getSurface(), "web");
});

// ── Play Billing capability ─────────────────────────────────────────────────

test("Play Billing is unavailable without the Digital Goods API", () => {
    clearFakeWindow();
    assert.equal(canUsePlayBilling(), false);

    (globalThis as Record<string, unknown>).window = {};
    try { assert.equal(canUsePlayBilling(), false); } finally { clearFakeWindow(); }
});

test("Play Billing is available when the TWA exposes getDigitalGoodsService", () => {
    (globalThis as Record<string, unknown>).window = { getDigitalGoodsService: () => {} };
    try { assert.equal(canUsePlayBilling(), true); } finally { clearFakeWindow(); }
});

// ── Flutter WebView shell (User-Agent token) ───────────────────────────────

const SHELL_UA = `Mozilla/5.0 (Linux; Android 16; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.0.0 Mobile Safari/537.36 ${APP_SHELL_UA_TOKEN}1`;
const CHROME_UA = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";

function withUserAgent(userAgent: string | undefined, run: () => void) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: userAgent === undefined ? undefined : { userAgent },
    });
    try { run(); } finally {
        if (original) Object.defineProperty(globalThis, "navigator", original);
        else Reflect.deleteProperty(globalThis, "navigator");
    }
}

test("the shell's User-Agent token identifies the app with no referrer at all", () => {
    withUserAgent(SHELL_UA, () => {
        const state = installFakeWindow("");
        try {
            assert.equal(isAppShell(), true);
            assert.equal(getSurface(), "play-app");
            assert.equal(state.store.get("shinobix:surface.v1"), "play-app");
        } finally { clearFakeWindow(); }
    });
});

test("plain Android Chrome, and a missing navigator, are not the shell", () => {
    withUserAgent(CHROME_UA, () => {
        installFakeWindow("");
        try {
            assert.equal(isAppShell(), false);
            assert.equal(getSurface(), "web");
        } finally { clearFakeWindow(); }
    });
    withUserAgent(undefined, () => assert.equal(isAppShell(), false));
});

test("the shell still resolves when storage throws", () => {
    withUserAgent(SHELL_UA, () => {
        installFakeWindow("", { throwOnGet: true, throwOnSet: true });
        try {
            assert.equal(getSurface(), "play-app");
        } finally { clearFakeWindow(); }
    });
});

test("the shell has no Play Billing, so the shop cannot offer a purchase", () => {
    // A WebView has no Digital Goods API. The app surface plus no billing is
    // what makes shardRail() answer "blocked" instead of "web" (Tebex).
    withUserAgent(SHELL_UA, () => {
        installFakeWindow("");
        try {
            assert.equal(getSurface(), "play-app");
            assert.equal(canUsePlayBilling(), false);
        } finally { clearFakeWindow(); }
    });
});

test("billing capability is independent of the surface flag", () => {
    // A play-app surface with no Digital Goods API (older Chrome) must NOT be
    // offered a purchase button — the capability probe is what gates it.
    (globalThis as Record<string, unknown>).window = {
        sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    (globalThis as Record<string, unknown>).document = { referrer: "android-app://com.shinobijourney.app" };
    resetSurfaceCacheForTests();
    try {
        assert.equal(getSurface(), "play-app");
        assert.equal(canUsePlayBilling(), false);
    } finally { clearFakeWindow(); }
});

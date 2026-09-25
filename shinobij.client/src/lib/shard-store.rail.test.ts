import { test } from "node:test";
import assert from "node:assert/strict";
import { shardRail } from "./shard-store";
import { APP_SHELL_UA_TOKEN, resetSurfaceCacheForTests } from "./surface";

/*
 * ⛔ Play policy: inside the Android app the shop may offer Play Billing or
 * nothing, never the Tebex web checkout. The Flutter WebView shell has no
 * referrer and no Digital Goods API, so its User-Agent token is the ONLY thing
 * standing between it and the web rail. Pin that end to end.
 */

function withPage(opts: { userAgent: string; referrer?: string; digitalGoods?: boolean }, run: () => void) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: opts.userAgent } });
    (globalThis as Record<string, unknown>).window = {
        sessionStorage: { getItem: () => null, setItem: () => {} },
        ...(opts.digitalGoods ? { getDigitalGoodsService: () => {} } : {}),
    };
    (globalThis as Record<string, unknown>).document = { referrer: opts.referrer ?? "" };
    resetSurfaceCacheForTests();
    try { run(); } finally {
        delete (globalThis as Record<string, unknown>).window;
        delete (globalThis as Record<string, unknown>).document;
        if (original) Object.defineProperty(globalThis, "navigator", original);
        else Reflect.deleteProperty(globalThis, "navigator");
        resetSurfaceCacheForTests();
    }
}

const WEBVIEW_UA = "Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.0.0 Mobile Safari/537.36";

test("the Flutter shell gets no purchase path, never the web checkout", () => {
    withPage({ userAgent: `${WEBVIEW_UA} ${APP_SHELL_UA_TOKEN}1` }, () => {
        assert.equal(shardRail(), "blocked");
    });
});

test("the same WebView without the token is treated as the web", () => {
    // Documents why the token matters: drop it and the shell would render Tebex.
    withPage({ userAgent: WEBVIEW_UA }, () => {
        assert.equal(shardRail(), "web");
    });
});

test("the older TWA shell keeps its referrer-based rails", () => {
    withPage({ userAgent: "Android Chrome", referrer: "android-app://com.shinobijourney.app" }, () => {
        assert.equal(shardRail(), "blocked");
    });
    withPage({ userAgent: "Android Chrome", referrer: "android-app://com.shinobijourney.app", digitalGoods: true }, () => {
        assert.equal(shardRail(), "play");
    });
});

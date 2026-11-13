import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/*
 * The decode order through the real loadPackedImage path: fetch, hash check,
 * the worker, and the shared page cache. Only the browser edges are stubbed
 * (network, Worker, object URLs, Image). The worker answers one page at a
 * time, when the test releases it, which is how the real single worker behaves.
 */

const decoded: string[] = [];
const releases: Array<() => void> = [];
const bodies = new Map<string, Uint8Array>();

class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: { bytes: ArrayBuffer }) {
        const label = new TextDecoder().decode(message.bytes);
        releases.push(() => {
            decoded.push(label);
            this.onmessage?.({ data: { blob: new Blob([label]) } });
        });
    }
    terminate() {}
}
class FakeImage { src = ""; decode() { return Promise.resolve(); } }

Object.assign(globalThis, {
    Worker: FakeWorker,
    Image: FakeImage,
    fetch: async (url: string) => {
        const body = bodies.get(url.split("/").pop()!);
        return body ? new Response(body.slice(), { status: 200 }) : new Response(null, { status: 404 });
    },
});
URL.createObjectURL = () => "blob:fake";
URL.revokeObjectURL = () => {};

/** A page whose bytes carry its own label, served under its content hash. */
function page(label: string) {
    const body = new TextEncoder().encode(label);
    const file = createHash("sha256").update(body).digest("hex") + ".264";
    bodies.set(file, body);
    return { file, cell: [8, 8], frames: 1, cols: 1 };
}
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve)); };
/** Release the worker one page at a time until every request has decoded. */
async function drain() {
    for (let guard = 0; guard < 50; guard++) {
        await settle();
        const next = releases.shift();
        if (!next) return;
        next();
    }
}

test("the player's own page decodes ahead of other figures and warm-up pages", async () => {
    const { loadPackedImage } = await import("./sector-pose-delivery");
    decoded.length = 0;
    const loads = [
        loadPackedImage("/art/peer-a/", page("peer-a idle"), 1), // takes the free worker
        loadPackedImage("/art/self/", page("self warm"), 2),
        loadPackedImage("/art/peer-b/", page("peer-b idle"), 1),
        loadPackedImage("/art/self/", page("self idle"), 0),
    ];
    await drain();
    const images = await Promise.all(loads);
    assert.deepEqual(decoded, ["peer-a idle", "self idle", "peer-b idle", "self warm"]);
    images.forEach(image => image.release());
});

test("a warm-up page the player now needs is raised, not decoded twice", async () => {
    const { loadPackedImage } = await import("./sector-pose-delivery");
    decoded.length = 0;
    const start = page("self start-walk");
    const loads = [
        loadPackedImage("/art/peer-c/", page("peer-c idle"), 1), // takes the free worker
        loadPackedImage("/art/peer-d/", page("peer-d idle"), 1),
        loadPackedImage("/art/self/", start, 2),                 // queued behind peer-d
    ];
    await settle();
    // The player presses a direction: the figure asks for the same start page now.
    loads.push(loadPackedImage("/art/self/", start, 0));
    await drain();
    const images = await Promise.all(loads);
    assert.deepEqual(decoded, ["peer-c idle", "self start-walk", "peer-d idle"]);
    assert.equal(images[2]!.image, images[3]!.image, "both asks share one decoded page");
    images.forEach(image => image.release());
});

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const target = process.argv[2]
    ?? "https://127.0.0.1:5176/petvfx.html?rite=1&petQuality=high&ritespeed=0.78&autostart=1";
const outputDir = path.resolve(process.argv[3] ?? ".tmp/round8/body-contact");
const channel = process.argv[4] === "chrome" ? "chrome" : undefined;
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    channel,
    args: channel ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : [],
});
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));

const url = new URL(target);
url.searchParams.set("ritemotionqa", "1");
url.searchParams.set("bodycapture", "1");
await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 35_000 });
await page.waitForFunction(() => {
    const curtain = document.querySelector('[data-testid="wfr-stage-curtain"]');
    return curtain?.getAttribute("data-stage-ready") === "true"
        && curtain?.getAttribute("data-models-ready") === "8";
}, undefined, { timeout: 35_000 });

const read = () => page.evaluate(() => {
    const canvas = document.querySelector(".wfr-canvas canvas");
    const clock = document.querySelector('[data-testid="wfr-clock"]');
    return {
        elapsedMs: performance.now(),
        tick: Number(clock?.getAttribute("data-tick") ?? "0"),
        lunge: Number(canvas?.getAttribute("data-rite-body-lunge-active") ?? "0"),
        lethalLunge: Number(canvas?.getAttribute("data-rite-body-lethal-lunge-active") ?? "0"),
        recoil: Number(canvas?.getAttribute("data-rite-body-recoil-active") ?? "0"),
        koExit: Number(canvas?.getAttribute("data-rite-body-ko-exit-active") ?? "0"),
        maxActive: Number(canvas?.getAttribute("data-rite-body-reaction-max-active") ?? "0"),
        maxOffset: Number(canvas?.getAttribute("data-rite-body-reaction-max-offset") ?? "0"),
        last: canvas?.getAttribute("data-rite-body-reaction-last"),
        lethalLast: canvas?.getAttribute("data-rite-body-lethal-last"),
        actorMode: canvas?.getAttribute("data-rite-actor-render-mode"),
        actors: Number(canvas?.getAttribute("data-rite-initial-actors-visible") ?? "0"),
        cameraDelta: Number(canvas?.getAttribute("data-rite-camera-max-delta") ?? "NaN"),
        calls: Number(canvas?.getAttribute("data-rite-render-calls") ?? "NaN"),
        longTaskSample: canvas?.getAttribute("data-rite-long-task-sample"),
        longTasks: Number(canvas?.getAttribute("data-rite-long-tasks-over100ms") ?? "NaN"),
        frameGaps: Number(canvas?.getAttribute("data-rite-frame-gaps-over100ms") ?? "NaN"),
    };
});
const capture = async (name) => {
    const state = await read();
    await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
    return { name, ...state };
};

// Catch the lethal attack before contact: the authoritative beat encoded in
// `last` must still be ahead of the playback tick.
await page.waitForFunction(() => {
    const canvas = document.querySelector(".wfr-canvas canvas");
    const tick = Number(document.querySelector('[data-testid="wfr-clock"]')?.getAttribute("data-tick") ?? "0");
    const last = canvas?.getAttribute("data-rite-body-lethal-last") ?? "";
    const contact = Number(last.match(/@(\d+)/)?.[1] ?? "NaN");
    return Number(canvas?.getAttribute("data-rite-body-lethal-lunge-active") ?? "0") > 0
        && Number.isFinite(contact)
        && tick < contact;
}, undefined, { polling: "raf", timeout: 35_000 });

const sequenceStart = await read();
const clip = await page.evaluate(async () => {
    const canvas = document.querySelector(".wfr-canvas canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Warfront canvas unavailable for body-contact capture");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("No supported WebM MediaRecorder format");
    const stream = canvas.captureStream(60);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const startedAt = performance.now();
    const complete = new Promise((resolve, reject) => {
        recorder.onerror = () => reject(recorder.error ?? new Error("body-contact MediaRecorder failed"));
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
        recorder.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            }
            resolve({ base64: btoa(binary), byteLength: bytes.length, mimeType, startedAt, stoppedAt: performance.now() });
        };
    });
    recorder.start(100);
    // Record a little guard time so the decoded clip always contains an exact
    // 0.80s review span even when MediaRecorder drops its first partial chunk.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    recorder.stop();
    for (const track of stream.getTracks()) track.stop();
    return complete;
});
const clipPath = path.join(outputDir, "body-contact-sequence.webm");
await writeFile(clipPath, Buffer.from(clip.base64, "base64"));
const sequenceEnd = await read();
const samples = [
    { name: "00-sequence-start", ...sequenceStart },
    { name: "01-sequence-end", ...sequenceEnd },
    await capture("02-post-sequence"),
];

const video = page.video();
await page.close();
const videoPath = video ? await video.path() : undefined;
await context.close();
await browser.close();

const stripBrowser = await chromium.launch({ headless: true });
const stripPage = await stripBrowser.newPage({ viewport: { width: 1280, height: 720 } });
await stripPage.goto(pathToFileURL(clipPath).href, { waitUntil: "load", timeout: 15_000 });
const videoElement = stripPage.locator("video");
await videoElement.waitFor({ state: "visible", timeout: 10_000 });
const duration = await videoElement.evaluate((video) => new Promise((resolve) => {
    if (Number.isFinite(video.duration)) resolve(video.duration);
    else video.addEventListener("loadedmetadata", () => resolve(video.duration), { once: true });
}));
const strip = [];
for (const seconds of [0.02, 0.22, 0.42, 0.62, 0.82]) {
    const seek = Math.min(seconds, Math.max(0, duration - 0.01));
    await videoElement.evaluate((video, time) => new Promise((resolve) => {
        video.pause();
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.currentTime = time;
    }), seek);
    const file = path.join(outputDir, `strip-${String(Math.round(seconds * 1000)).padStart(3, "0")}ms.png`);
    await videoElement.screenshot({ path: file });
    strip.push({ seconds: seek, file });
}
await stripBrowser.close();

console.log(JSON.stringify({
    outputDir,
    videoPath,
    clipPath,
    clipDurationMs: clip.stoppedAt - clip.startedAt,
    clipBytes: clip.byteLength,
    stripDurationSeconds: duration,
    stripSpanSeconds: strip.at(-1).seconds - strip[0].seconds,
    strip,
    samples,
    errors,
}, null, 2));
if (errors.length) process.exitCode = 1;

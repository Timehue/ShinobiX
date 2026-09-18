import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] || "../tmp/vn-art-audit/after");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const reports = [];
let cases = [
    { name: "ashen-register", event: "story-ashen-leaf-village-4-0", page: 1, line: 0 },
    { name: "ashen-reveal", event: "story-ashen-leaf-village-4-0", page: 7, line: 2 },
    { name: "ashen-clerk", event: "story-ashen-leaf-village-4-0", page: 2, line: 0 },
    { name: "ashen-annex", event: "story-ashen-leaf-village-15-1", page: 4, line: 0 },
    { name: "frostfang-yura", event: "story-frostfang-village-35-3", page: 1, line: 0 },
    { name: "stormveil-clerk", event: "story-stormveil-village-4-0", page: 1, line: 0 },
    { name: "frostfang-intake", event: "story-frostfang-village-4-0", page: 1, line: 0 },
    { name: "frostfang-plate", event: "story-frostfang-village-4-0", page: 7, line: 2 },
    { name: "moonshadow-intake", event: "story-moonshadow-village-4-0", page: 1, line: 0 },
    { name: "moonshadow-water", event: "story-moonshadow-village-4-0", page: 7, line: 1 },
    { name: "reed-kitchen", event: "story-interlude-ashen-leaf-village-42", page: 1, line: 0 },
    { name: "reed-wall", event: "story-interlude-ashen-leaf-village-42", page: 2, line: 1 },
    { name: "sova-records", event: "story-interlude-frostfang-village-58", page: 1, line: 0 },
    { name: "frostfang-antechamber", event: "story-interlude-frostfang-village-70", page: 0, line: 0 },
    { name: "rift-aftermath", event: "rift-first-clear-hollow-stalker", page: 0, line: 0 },
];
if (process.argv.includes("--manifest")) {
    const inventory = JSON.parse(await readFile("../tmp/vn-art-audit/current.json", "utf8"));
    const manifest = JSON.parse(await readFile("../docs/art-audit/production.json", "utf8"));
    cases = manifest.assets.map((asset) => {
        const row = inventory.rows.find((r) => r.presentations.some((p) => p.background === asset.asset || p.actors.some((a) => a.image.split("?", 1)[0] === asset.asset)));
        if (!row) throw new Error(`Approved asset has no runtime consumer: ${asset.key}`);
        const line = row.presentations.find((p) => p.background === asset.asset || p.actors.some((a) => a.image.split("?", 1)[0] === asset.asset));
        return { name: asset.key, event: row.key.split("/page:", 1)[0], page: row.pageIndex, line: line.lineIndex };
    });
}
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
if (only) cases = cases.filter((scenario) => only.includes(scenario.name));
const scenes = process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9).split(',');
if (scenes) cases = scenes.map(scene => {
    const [event, page = '0', line = '0'] = scene.split('@');
    return { name: `${event}-p${page}-l${line}`, event, page: Number(page), line: Number(line) };
});
try {
    for (const scenario of cases) {
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.addInitScript(() => {
                performance.setResourceTimingBufferSize(4000);
                localStorage.setItem("vnTextSpeed.v1", "instant");
                localStorage.setItem("vnReaderMode.v1", "cinematic");
                localStorage.setItem("vnAutoRead.v1", "0");
                localStorage.setItem("pet-music-muted", "1");
            });
            const url = new URL("http://127.0.0.1:4173/");
            url.search = new URLSearchParams({ preview: "vn", event: scenario.event, page: String(scenario.page), line: String(scenario.line) }).toString();
            await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 90000 });
            await page.locator(".cvn-root").waitFor({ timeout: 90000 });
            await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
            await page.evaluate(async () => {
                const source = getComputedStyle(document.querySelector(".cvn-backdrop")).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
                if (!source) throw new Error("No backdrop in real VN stage");
                const image = new Image();
                image.src = source;
                await image.decode();
            });
            await page.waitForTimeout(800);
            const metrics = await page.evaluate(() => ({
                text: document.querySelector(".cvn-root")?.textContent,
                overflow: document.documentElement.scrollWidth - innerWidth,
                images: [...document.images].map((i) => ({ src: i.currentSrc, decoded: i.naturalWidth > 0 })),
                background: getComputedStyle(document.querySelector(".cvn-backdrop")).backgroundImage,
                artResources: performance.getEntriesByType("resource").filter((r) => /\/(scenes|portraits)\//.test(r.name)).map((r) => ({ url: r.name, transfer: r.transferSize, body: r.encodedBodySize, duration: r.duration })),
            }));
            const name = `${scenario.name}-${viewport.width}`;
            await page.screenshot({ path: path.join(output, `${name}.png`) });
            reports.push({ name, url: url.href, errors, ...metrics });
            console.log(name);
            await page.close();
        }
    }
} finally { await browser.close(); }
await writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
if (reports.some((r) => r.errors.length || r.overflow > 1 || r.images.some((i) => !i.decoded))) process.exitCode = 1;

import { chromium } from "@playwright/test";

const target = process.argv[2] ?? "https://127.0.0.1:5176/petvfx.html?rite=1&petQuality=high&ritespeed=0.78&autostart=1";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    const client = await context.newCDPSession(page);
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval: 500 });
    await client.send("Profiler.start");
    await client.send("Tracing.start", {
        categories: "devtools.timeline,disabled-by-default-devtools.timeline,v8,blink.user_timing",
        options: "sampling-frequency=10000",
        transferMode: "ReturnAsStream",
    });
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute("data-stage-ready") === "true", undefined, { timeout: 20_000 });
    const marks = await page.evaluate(() => performance.getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("wfr-hydration-"))
        .map((entry) => ({ name: entry.name, startTime: entry.startTime })));
    const { profile } = await client.send("Profiler.stop");
    const complete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
    await client.send("Tracing.end");
    const { stream } = await complete;
    let raw = "";
    while (true) {
        const chunk = await client.send("IO.read", { handle: stream });
        raw += chunk.data;
        if (chunk.eof) break;
    }
    await client.send("IO.close", { handle: stream });
    const events = JSON.parse(raw).traceEvents.filter((event) => event.ph === "X" && event.dur);
    const tasks = events.filter((event) => event.name === "RunTask" && event.dur > 50_000);
    const result = tasks.map((task) => ({
        startMs: task.ts / 1000,
        durationMs: task.dur / 1000,
        children: events
            .filter((event) => event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur && event.dur > 4_000 && event.name !== "RunTask")
            .sort((a, b) => b.dur - a.dur)
            .slice(0, 18)
            .map((event) => ({ name: event.name, durationMs: event.dur / 1000, url: event.args?.data?.url ?? event.args?.data?.scriptName ?? "" })),
    }));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const selfByUrl = new Map();
    for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
        const node = nodes.get(profile.samples[index]);
        const url = node?.callFrame?.url || node?.callFrame?.functionName || "(unknown)";
        selfByUrl.set(url, (selfByUrl.get(url) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000);
    }
    const cpu = [...selfByUrl].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([url, selfMs]) => ({ url, selfMs: Number(selfMs.toFixed(2)) }));
    console.log(JSON.stringify({ tasks: result, cpu, marks }, null, 2));
    await context.close();
} finally {
    await browser.close();
}

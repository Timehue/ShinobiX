import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { artAuditCatalog } from "../src/features/cinematic-vn/art-audit-catalog";
import { resolveCinematicActorImage, resolveVnPresentation } from "../src/lib/vn-presentation";
import { defaultVnPortrait, defaultVnScene, resolveVnAuthoredActorImage, resolveVnActorBaseImage, splitDialogueLine } from "../src/lib/vn";

const output = path.resolve(process.argv[2] || "../docs/art-audit/inventory.json");
const entries = await artAuditCatalog();
const rows: Record<string, unknown>[] = [];
const assets = new Map<string, { consumers: string[]; bytes?: number; missing?: boolean }>();
for (const entry of entries) {
    const { event } = entry;
    const pages = event.vnPages ?? [];
    const reachable = new Set<number>();
    const queue = [0];
    while (queue.length) {
        const index = queue.shift()!;
        if (index < 0 || index >= pages.length || reachable.has(index)) continue;
        reachable.add(index);
        const choices = pages[index].choices?.filter((choice) => choice.text.trim()) ?? [];
        if (!choices.length) queue.push(index + 1);
        else for (const choice of choices) if (!choice.battle) queue.push(choice.nextPage);
    }
    const source = await readFile(path.resolve(entry.source), "utf8");
    for (const [pageIndex, page] of pages.entries()) {
        const swapped = page.rightName?.trim().toLowerCase() === "player";
        const left = swapped ? "Player" : page.leftName || "Player";
        const right = swapped ? page.leftName || page.speaker || event.vnSpeaker || "Narrator" : page.rightName || page.speaker || event.vnSpeaker || "Narrator";
        const authoredLeft = swapped ? "" : resolveVnAuthoredActorImage(event.id, left, page.leftImage);
        const authoredRight = resolveVnAuthoredActorImage(event.id, right, swapped ? page.leftImage || page.rightImage : page.rightImage);
        const pageImage = page.image || event.image || defaultVnScene(event.id, event.biome);
        const lines = page.dialogue.length ? page.dialogue : event.dialogue;
        const presentations = lines.map((text, lineIndex) => {
            const line = page.lines?.[lineIndex] ?? splitDialogueLine(text, page.speaker || event.vnSpeaker || "Narrator");
            const presentation = resolveVnPresentation({ event, page, pageIndex, lineIndex, speaker: line.speaker, speakingSide: line.speaker === right ? "right" : line.speaker === left ? "left" : null, pageImage });
            return {
                lineIndex, speaker: line.speaker, text: line.text, mode: presentation.mode, background: presentation.backgroundImage,
                actors: [
                    { name: left, pose: presentation.leftActorPose, image: left === "Player" ? "" : resolveCinematicActorImage(event.id, left, defaultVnPortrait(left), presentation.leftActorPose, authoredLeft) },
                    { name: right, pose: presentation.rightActorPose, image: right === "Player" ? "" : resolveCinematicActorImage(event.id, right, resolveVnActorBaseImage(event.id, right, authoredRight, event.avatarImage), presentation.rightActorPose, authoredRight) },
                ],
            };
        });
        const consumer = `${entry.key}/page:${pageIndex}/${page.title}`;
        for (const image of new Set(presentations.flatMap((line) => [line.background, ...line.actors.map((actor) => actor.image)]).filter(Boolean))) {
            const asset = assets.get(image) ?? { consumers: [] };
            asset.consumers.push(consumer);
            assets.set(image, asset);
        }
        const at = source.indexOf(JSON.stringify(page.title));
        rows.push({ key: consumer, eventId: event.id, pageIndex, title: page.title, reachable: reachable.has(pageIndex), source: `${entry.source}:${at < 0 ? 1 : source.slice(0, at).split("\n").length}`, eventConditions: entry.conditions, incomingChoices: pages.flatMap((p, index) => (p.choices ?? []).filter((c) => c.nextPage === pageIndex).map((c) => ({ page: index, ...c }))), scene: page.scene, authored: { pageImage: page.image, eventImage: event.image, leftImage: page.leftImage, rightImage: page.rightImage, cinematic: page.cinematic }, presentations });
    }
}
for (const [image, asset] of assets) {
    if (!image.startsWith("/")) continue;
    try { asset.bytes = (await stat(path.resolve("public", image.slice(1).split(/[?#]/)[0]))).size; }
    catch { asset.missing = true; }
}
const result = { coverage: { events: entries.length, pages: rows.length, reachablePages: rows.filter((r) => r.reachable).length, assets: assets.size, missing: [...assets.values()].filter((a) => a.missing).length, inaccessible: ["Production shared-image overrides and private creator/published events are not available in the checkout.", "Player-uploaded avatars and server-selected Sage offer strings are dynamic."] }, rows, assets: Object.fromEntries(assets) };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.coverage, null, 2));

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { useSectorModelPins } from "../lib/sector-model-pins";
import "./sector-model-figure.css";
import type { PlayerModel, SprintStyle } from "../lib/player-model";
import { advanceSectorStride, fitSectorStride, sectorClipGait, sectorStartEntry, type GroundStride } from "../../../shared/sector-model-motion";
import type { DecodePriority, PackedMotion, SheetImage, SpriteClip, SpriteView } from "../lib/sector-pose-delivery";
import { readSectorModelObject, sectorFetchPriority } from "../lib/sector-model-object";
import { createPosePrerequisite } from "../lib/sector-pose-prerequisite";
import { missingSectorModelFeature, reportSectorModelUnavailable, reportSectorModelUnsupported, type SectorModelStage } from "../lib/sector-model-health";

type Model = { mapWidth: number; banks: SpriteView[]; packed?: PackedMotion };
type MovingGait = "walk" | "run";
type Position = { x: number; y: number; width: number; moving: boolean; now: number; gait?: MovingGait; snapped?: boolean; routed?: boolean };
export type SectorModelHandle = {
    place: (x: number, y: number, mapWidth: number, moving: boolean, gait?: MovingGait, routed?: boolean) => void;
    snap: (x: number, y: number, mapWidth: number) => void;
    ground: GroundStride;
    /** The caller stopped driving the stride (Reduce Motion turned on mid-walk):
     *  go back to placing the figure from its positions. */
    unground: () => void;
    /** Advance a stationary actor to its planted pose. Returns true while it still needs frames. */
    stop: () => boolean;
};

// Least-recently-used: every distinct equipped peer adds a manifest, so a long session in busy sectors
// must not keep all of them. 96 covers the 53-model roster plus a crowded sector of player models.
// An evicted entry that a mounted figure still uses stays alive through that figure; a later mount
// re-reads the immutable manifest from the HTTP cache.
const MODEL_CACHE_LIMIT = 96;
const models = new Map<string, Promise<Model>>();

function loadModel(folder: string, revision: string, priority: RequestPriority = "auto"): Promise<Model> {
    const url = folder + revision + ".json";
    const existing = models.get(url);
    if (existing) { models.delete(url); models.set(url, existing); return existing; }
    const request = readSectorModelObject(folder,revision+".json",".json",8*1024**2,priority).then(bytes => {
        const decoded = JSON.parse(new TextDecoder().decode(bytes));
        if (decoded.mapWidth !== 1080) throw new Error("Invalid sector model scale");
        if (decoded.format === "sector-motion-v2") {
            for (const style of ["A", "B", "C"]) {
                const indexes = decoded.styles?.[style];
                if (!Array.isArray(indexes) || indexes.length !== 8 || indexes.some(name =>
                    typeof name !== "string" || !/^[a-f0-9]{64}\.gz$/.test(name))) throw new Error("Invalid motion index");
            }
            return {mapWidth:decoded.mapWidth, banks:[], packed:decoded};
        }
        const model: Model = decoded;
        for (const view of model.banks) for (const clip of Object.values(view)) {
            const filename = clip.url.split("/").pop();
            if (!filename || !/^[a-f0-9]{64}\.webp$/.test(filename)) throw new Error("Invalid sector model page");
            clip.url = folder + filename;
            clip.count = clip.origins.length;
        }
        return model;
    }).catch(error => { if (models.get(url) === request) models.delete(url); throw error; });
    models.set(url, request);
    while (models.size > MODEL_CACHE_LIMIT) models.delete(models.keys().next().value!);
    return request;
}

export const SectorModelFigure = forwardRef<SectorModelHandle, {
    kind: string; artBase: string; equipped?: PlayerModel; style?: SprintStyle;
    /** The player's own figure: its pages decode ahead of every other figure's. */
    self?: boolean;
}>(
    function SectorModelFigure({ kind, artBase, equipped, style = "A", self = false }, ref) {
        const decodePriority: DecodePriority = self ? 0 : 1;
        const {revisions} = useSectorModelPins();
        const revision = equipped?.version ?? revisions[kind];
        const folder = artBase.replace(/\/$/, "") + "/" + (equipped ? "players/" + equipped.assetId : kind) + "/";
        const element = useRef<HTMLSpanElement>(null);
        const latest = useRef<Position | null>(null);
        const notify = useRef<(() => void) | null>(null);
        const ground = useRef<GroundStride | null>(null);
        const unground = useRef<(() => void) | null>(null);
        const settling = useRef(false);
        useImperativeHandle(ref, () => ({
            ground: (...args) => ground.current?.(...args),
            unground: () => unground.current?.(),
            place(x, y, width, moving, gait, routed) {
                if (width <= 0) return;
                latest.current = { x, y, width, moving, gait, routed, now: performance.now() };
                notify.current?.();
            },
            snap(x, y, width) {
                if (width <= 0) return;
                latest.current = { x, y, width, moving: false, now: performance.now(), snapped: true };
                notify.current?.();
            },
            stop() {
                const pos = latest.current;
                // A held NPC still needs time to reach foot contact and finish its braking clip.
                if (pos && (pos.moving || settling.current)) {
                    latest.current = { ...pos, moving: false, now: performance.now() };
                    notify.current?.();
                }
                return settling.current;
            },
        }), []);

        useLayoutEffect(() => {
            if (!revision) return;
            const layer = element.current!;
            const figure = layer.parentElement!;
            let model: Model | undefined;
            let prior: Position | null = null;
            let view = 0;
            let gait: "idle" | MovingGait = "idle";
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
            let idleTimer = 0, idleEpoch = performance.now(), idleView = -1;
            function refreshIdle() {
                idleTimer = 0;
                if (live && !document.hidden) draw();
            }
            function idlePreferenceChanged() {
                window.clearTimeout(idleTimer);
                idleTimer = 0;
                draw();
            }
            let stride = { page: "idle", time: 0 };
            let paintedClip = "", paintedTime = 0;
            let index = 0;
            let live = true;
            let frameKey = "";
            let lastSheet: HTMLImageElement | null = null;
            let lastScale = 0;
            let lastCellWidth = 0, lastCellHeight = 0, lastColumns = 0, lastAtlasIndex = -1;
            let lastGait = "", lastFacing = -1, lastFrame = -1, lastClip = "";
            let currentUrl = "";
            let paintedUrl = "";
            let page: HTMLImageElement | null = null;
            let pendingUrl = "";
            let painted: SheetImage | undefined;
            const pendingFacings = new Set<number>();
            let retryAfter = 0;
            let retryTimer = 0;
            // One dropped request on a phone network should cost a second of
            // portrait, not thirty. Back off 1 s, 4 s, then 30 s; a quiet minute
            // starts the ladder again, so a page that never loads still settles
            // at one attempt per 30 s.
            let failures = 0, lastFailure = -Infinity;
            function retryDelay(stage: SectorModelStage, error?: unknown) {
                const now = performance.now();
                if (now - lastFailure > 60_000) failures = 0;
                lastFailure = now;
                const delay = [1_000, 4_000][failures++];
                // The quick retries are spent: this figure is a portrait for the next
                // half minute at least. That is worth knowing about.
                // An offline phone fails every fetch; that is the network, not the figure.
                if (delay === undefined && navigator.onLine) reportSectorModelUnavailable(stage, folder.includes("/players/"), error);
                return delay ?? 30_000;
            }

            function retry() {
                window.clearTimeout(retryTimer);
                if (!live || document.hidden || !navigator.onLine) return;
                if (model) { retryAfter = 0; draw(); }
                else requestModel();
            }

            function requestModel() {
                void loadModel(folder, revision, sectorFetchPriority(decodePriority)).then(asset => {
                    if (live) {
                        model = { ...asset, banks: asset.banks.map(bank => ({
                            ...bank, run: bank["run"+style] ?? bank.run!,
                        })) };
                        draw();
                    }
                }).catch(error => {
                    if (!live) return;
                    figure.classList.remove("has-sector-model");
                    window.clearTimeout(retryTimer);
                    retryTimer = window.setTimeout(retry, retryDelay("manifest", error));
                });
            }

            let driven = false, waiting = false;
            let offsetX = 0, offsetY = 0;
            let waitingSince: number | undefined, usingPortrait = false;
            let nextPage = "";
            let warmKey = "", warmRun = 0;
            const warmStartPages: SheetImage[] = [];
            const startArt=createPosePrerequisite<SheetImage>();
            const startReleaseArt=createPosePrerequisite<SheetImage>();
            const releaseArt=createPosePrerequisite<SheetImage>();
            const changeArt=createPosePrerequisite<SheetImage>();
            const changeReleaseArt=createPosePrerequisite<SheetImage>();
            // One moving page per facing, held while the actor walks, so a turn
            // changes facing on the next frame instead of waiting on a decode.
            const turnArt=Array.from({length:8},()=>createPosePrerequisite<SheetImage>());
            const turnReleaseArt=Array.from({length:8},()=>createPosePrerequisite<SheetImage>());
            let holdFacing = -1, holdSince = 0;
            const releaseTurns = () => { for (const slot of [...turnArt, ...turnReleaseArt]) slot.clear(); };
            // Moving needs the pose page and its braking page (see releaseReady below).
            // Request both; true only once both are decoded.
            function turnReady(bank: SpriteView, facing: number, pageName: string) {
                const pose = retainPage(turnArt[facing]!, bank[pageName]?.page);
                const release = retainPage(turnReleaseArt[facing]!, brakePage(bank, pageName));
                return pose && release;
            }
            let preparedChange: SpriteClip | undefined;
            function brakePage(bank: SpriteView, pageName: string) {
                return Object.values(bank).find(clip =>
                    (clip.source ?? clip.entryGait) === pageName && clip.target === "idle")?.page;
            }
            function retainPage(slot: typeof releaseArt, spec: SpriteClip["page"], onFailure?: () => void) {
                return !spec || slot.ready(spec.file,
                    () => import("../lib/sector-pose-delivery").then(m => m.loadPackedImage(folder, spec, decodePriority)), onFailure);
            }
            function prepareGaitChange(bank: SpriteView, from: MovingGait) {
                if (preparedChange === bank[from]) return;
                preparedChange = bank[from];
                const to = from === "walk" ? "run" : "walk";
                const change = Object.entries(bank).find(([, clip]) =>
                    (clip.source ?? clip.entryGait) === from && clip.target === to);
                if (!change) return;
                retainPage(changeArt, change[1].page);
                retainPage(changeReleaseArt, brakePage(bank, change[0]));
            }
            function prepareNext(clip: SpriteClip | undefined) {
                const spec = clip?.page;
                if (!spec || nextPage===spec.file) return;
                nextPage=spec.file;
                void import("../lib/sector-pose-delivery").then(m=>m.loadPackedImage(folder,spec,decodePriority))
                    .then(image=>image.release(),()=>{if(nextPage===spec.file) nextPage="";});
            }
            function waitForArt() {
                waiting = true;
                const now = performance.now();
                waitingSince ??= now;
                if (now-waitingSince < 400) return {distance:0,idle:false};
                // A cold download must never hold navigation until the network timeout.
                usingPortrait = true;
                releaseTurns();
                figure.classList.remove("has-sector-model");
                return undefined;
            }
            function facingBank(facing: number) {
                const bank = model?.banks[facing];
                if (bank || !model?.packed || pendingFacings.has(facing) || performance.now()<retryAfter) return bank;
                pendingFacings.add(facing);
                const file = model.packed.styles[style][facing];
                void import("../lib/sector-pose-delivery").then(m=>m.loadFacing(folder,file,decodePriority)).then(bank=>{
                    pendingFacings.delete(facing);
                    if (model && live) { model.banks[facing]=bank; if (!driven) draw(); }
                }).catch(error=>{pendingFacings.delete(facing); if(live) failed("facing", error);});
                return bank;
            }

            function sheetReady(clip: SpriteClip) {
                if (currentUrl !== clip.url || (paintedUrl !== clip.url && performance.now() >= retryAfter)) {
                    if (pendingUrl===clip.url) return false;
                    currentUrl = clip.url;
                    pendingUrl = currentUrl;
                    frameKey = "";
                    // Keep the latest painted frame on screen while a new facing loads.
                    const ready = (next: SheetImage) => {
                        if (!live || currentUrl !== clip.url) {next.release(); return;}
                        const previous = painted;
                        painted=next; paintedUrl=clip.url; page=next.image; pendingUrl=""; if (!driven) draw(); previous?.release();
                    };
                    const fail = (error?: unknown) => {if (live && currentUrl===clip.url) {pendingUrl=""; failed("page", error);}};
                    if (clip.page) {
                        const spec=clip.page;
                        void import("../lib/sector-pose-delivery").then(m=>m.loadPackedImage(folder,spec,decodePriority)).then(ready,fail);
                    } else {
                        const image=new Image();
                        image.onload=()=>ready({image,release:()=>{}});
                        image.onerror=fail;
                        image.src=clip.url;
                    }
                }
                return paintedUrl===clip.url && Boolean(page?.complete && page.naturalWidth);
            }

            const facingFor = (dx: number, dy: number) => (Math.round(Math.atan2(dx,dy)/(Math.PI/4))+8)%8;
            // While a gait loops, keep that gait's pages decoded for every heading a
            // turn can reach without braking: the 45-degree neighbours (diagonal
            // roads and corners) and the 90-degree ones (WASD). A reversal brakes
            // first, and that brake already loads its own start page.
            function warmTurns(page: string) {
                for (let facing = 0; facing < 8; facing++) {
                    const step = (facing - view + 8) % 8;
                    if (step === 0) continue;
                    // Let go of facings a curve has left behind: hold the four in reach only.
                    if (step > 2 && step < 6) { turnArt[facing]!.clear(); turnReleaseArt[facing]!.clear(); continue; }
                    const bank = facingBank(facing);
                    if (bank) turnReady(bank, facing, page);
                }
            }
            function releaseWarmStarts() {
                if (!warmKey) return;
                warmKey = "";
                warmRun++;
                for (const image of warmStartPages.splice(0)) image.release();
            }
            // Travel begins on the frame the player chooses a road, so there is no
            // turn to hide a download behind. While the actor stands, decode the
            // first moving pose and its braking page for each road heading, in the
            // gait the player has selected. Playback takes over these pages when the
            // actor moves. The set covers every heading (cardinals first, then the
            // diagonals, within the byte budget), so it depends on the gait only:
            // turning in place at rest does not release and re-decode it.
            function warmStarts() {
                const packed = model?.packed;
                const start = "start-" + (latest.current?.gait ?? "walk");
                const key = start;
                if (!packed || warmKey === key) return;
                releaseWarmStarts();
                warmKey = key;
                const run = ++warmRun, origin = view, banks = model!.banks;
                void import("../lib/sector-pose-delivery").then(async delivery => {
                    let remainingBytes = 12 * 1024 ** 2;
                    for (const facing of [origin, ...[2, 6, 4, 0, 1, 3, 5, 7].filter(to => to !== origin)]) {
                        if (!live || run !== warmRun) return;
                        const bank = banks[facing] ??
                            await delivery.loadFacing(folder, packed.styles[style][facing], 2).catch(() => undefined);
                        if (!bank) continue;
                        banks[facing] ??= bank;
                        for (const spec of [bank[start]?.page, brakePage(bank, start)]) {
                            if (!live || run !== warmRun) return;
                            if (!spec) continue;
                            const bytes = spec.cell[0] * spec.cell[1] * spec.cols * Math.ceil(spec.frames / spec.cols) * 4;
                            if (bytes > remainingBytes) continue;
                            remainingBytes -= bytes;
                            // Warm-up waits behind every figure's visible pages; a real move
                            // that needs one of these pages raises it on request.
                            const warmed = await delivery.loadPackedImage(folder, spec, 2).catch(() => undefined);
                            // The crowd can exhaust the shared idle cache before the next
                            // input. Keep this self-only budget until playback owns it.
                            if (warmed && live && run === warmRun) warmStartPages.push(warmed);
                            else warmed?.release();
                        }
                    }
                }).catch(() => {});
            }
            unground.current = () => {
                if (!driven) return;
                driven = false; waiting = false;
                // The next placement starts from a standing pose, not a stale stride.
                prior = null;
            };
            ground.current = (direction, desired, dt, allowance, afterBrake) => {
                if (!model?.packed || performance.now()<retryAfter) {
                    driven = false;
                    waiting = false;
                    return;
                }
                driven = true;
                const angle = view * Math.PI / 4;
                const dx = direction?.dx ?? Math.sin(angle), dy = direction?.dy ?? Math.cos(angle);
                let facing = direction ? facingFor(dx,dy) : view;
                let fitX = dx, fitY = dy;
                // A turn mid-stride keeps the facing on screen until the new facing's
                // pages are decoded, instead of holding the actor still for the decode.
                // The hold is bounded like any cold page: after 400 ms (a slow or
                // failed load) the turn takes the normal wait-for-art path.
                const turning = desired && facing !== view && !usingPortrait && stride.page !== "idle"
                    && model.banks[view]?.[stride.page] && paintedUrl === model.banks[view]![stride.page]!.url;
                if (!turning) holdFacing = -1;
                else {
                    const next = facingBank(facing), now = performance.now();
                    // The clock belongs to this target facing; once it runs out the turn
                    // stops holding until the target changes or the turn completes.
                    if (holdFacing !== facing) { holdFacing = facing; holdSince = now; }
                    const ready = next && turnReady(next, facing, next[stride.page] ? stride.page : desired!);
                    if (!ready && now - holdSince < 400) {
                        facing = view;
                        // The held clip's settling correction is authored in its own facing.
                        fitX = Math.sin(view * Math.PI / 4); fitY = Math.cos(view * Math.PI / 4);
                    } else if (!ready) {
                        // The hold already spent the cold-load grace: the wait-for-art path
                        // below goes straight to the portrait instead of waiting 400 ms more.
                        waitingSince ??= holdSince;
                    }
                }
                if (afterBrake && !usingPortrait) {
                    // The held heading starts the moment this brake ends. Keep its first
                    // moving pose and that pose's braking page decoded while the actor slows.
                    const next = facingBank(facingFor(afterBrake.dx,afterBrake.dy));
                    const start = "start-" + (latest.current?.gait ?? "walk");
                    if (next) {
                        retainPage(startArt, next[start]?.page);
                        retainPage(startReleaseArt, brakePage(next, start));
                    }
                }
                waiting = true;
                const bank = facingBank(facing);
                if (!bank) return waitForArt();
                let state = usingPortrait ? {page:desired ?? "idle",time:0} :
                    direction && bank[stride.page] ? stride : {page:"idle",time:0};
                // A standing actor faces the chosen road at once and joins its start
                // clip where the ground already moves, instead of turning in place first.
                if (desired && state.page === "idle" && bank["start-"+desired]) {
                    state = {page:"start-"+desired, time:sectorStartEntry(bank["start-"+desired], bank[desired]?.speed)};
                }
                // Keep the foot and its ground travel on the same clock when one
                // slow display frame contains several simulation updates.
                const stopping = bank[state.page]?.target === "idle";
                const visible = paintedClip === state.page ? paintedTime : 0;
                const elapsed = stopping ? Math.min(dt,Math.max(0,visible+bank[state.page]!.period/4-state.time)) : dt;
                const pose = fitSectorStride(bank,state,desired,elapsed,allowance,fitX,fitY);
                const poseReady = sheetReady(bank[pose.page]);
                const releaseReady = !desired || retainPage(releaseArt, brakePage(bank, pose.page), failed);
                if (!poseReady || !releaseReady) return waitForArt();
                if (desired) releaseWarmStarts();
                if (!afterBrake) { startArt.clear(); startReleaseArt.clear(); }
                if (desired && pose.page==="start-"+desired) prepareNext(bank[desired]);
                if (desired && pose.page===desired) warmTurns(desired);
                if (desired && (pose.page===desired || pose.page==="start-"+desired)) prepareGaitChange(bank, desired);
                if (desired && pose.page.startsWith("change-")) {
                    prepareNext(bank[desired]);
                    // These pages now have the same leases as any painted gait.
                    changeArt.clear();
                    retainPage(changeReleaseArt, brakePage(bank, desired));
                    preparedChange = undefined;
                }
                if (!desired && pose.page.startsWith("stop-")) prepareNext(bank.idle);
                waitingSince=undefined;
                if (usingPortrait) { offsetX=0; offsetY=0; frameKey=""; usingPortrait=false; }
                waiting = false;
                view = facing;
                stride = pose;
                if(pose.page==="idle") {
                    releaseArt.clear();
                    changeArt.clear();
                    changeReleaseArt.clear();
                    releaseTurns();
                    preparedChange = undefined;
                    if (!desired && !afterBrake) warmStarts();
                }
                index = pose.cell;
                gait = desired ?? "idle";
                // Recenter the small lateral settling offset as the next stride travels.
                const retain = Math.max(0,1-pose.travel/24);
                offsetX = offsetX*retain+pose.offsetX;
                offsetY = offsetY*retain+pose.offsetY;
                return {distance:pose.distance,idle:pose.page==="idle",gait:sectorClipGait(bank,pose.page)};
            };

            function draw() {
                const pos = latest.current;
                if (!model || !pos || !live || (driven && waiting && usingPortrait) || (model.packed && performance.now()<retryAfter)) return;
                const scale = pos.width / model.mapWidth;
                if (!driven && prior !== pos) {
                    const dx = prior ? pos.x - prior.x : 0;
                    const dy = prior ? pos.y - prior.y : 0;
                    const distance = Math.hypot(dx, dy) / scale;
                    const dt = prior ? (pos.now - prior.now) / 1000 : 0;
                    // Reduce Motion places every actor as standing (no stride), but it still
                    // travels: face the way it goes rather than sliding in its old facing.
                    // A snap or a jump is a teleport, not a heading.
                    const heading = pos.moving || (reducedMotion.matches && !pos.snapped && distance <= 45);
                    if (heading && distance > .001 && prior?.width === pos.width)
                        view = (Math.round(Math.atan2(dx, dy) / (Math.PI / 4)) + 8) % 8;
                    const bank = facingBank(view);
                    if (!bank) { waitForArt(); return; }
                    if (pos.snapped || !prior || prior.width !== pos.width || (!pos.routed && (dt > .35 || distance > 45))) {
                        gait = "idle";
                        stride = {page:"idle",time:0};
                        index = 0;
                    } else if (dt > 0 && (!pos.moving || distance > .001)) {
                        if (!bank[stride.page]) stride = {page:"idle", time:0};
                        gait = pos.moving ? pos.gait ?? (distance/dt > (gait === "run" ? 55 : 78) ? "run" : "walk") : "idle";
                        const desired = gait === "idle" ? null : gait;
                        // On a loop the actual ground displacement sets the clock, including network pacing.
                        const elapsed = desired && !bank[stride.page]?.times ? distance / bank[desired]!.speed! : dt;
                        const pose = advanceSectorStride(bank, stride, desired, elapsed);
                        stride = pose;
                        index = pose.cell;
                    }
                }
                prior = pos;
                settling.current = !driven && stride.page !== "idle";
                const clip = model.banks[view]?.[stride.page];
                // Substeps may move the feet before the next clip starts loading.
                // Paint the last committed pose from its retained sheet on this frame.
                if (!clip || (driven ? paintedUrl!==clip.url : !sheetReady(clip)) || !page) {
                    if (!driven) waitForArt();
                    return;
                }
                if (!driven) {
                    // NPC and peer movement continues independently of sprite downloads.
                    // Use the portrait after the same cold-load grace as local movement,
                    // then reveal the fitted figure only once its current page is ready.
                    waiting=false; waitingSince=undefined; usingPortrait=false;
                }
                if (stride.page === "idle" && clip.count > 1) {
                    const now = performance.now();
                    if (paintedClip !== "idle" || idleView !== view) {
                        idleEpoch = now;
                        idleView = view;
                    }
                    index = reducedMotion.matches ? 0 : Math.floor((now-idleEpoch)/1000/clip.period*clip.count)%clip.count;
                    if (!reducedMotion.matches && !document.hidden && !idleTimer)
                        idleTimer = window.setTimeout(refreshIdle, clip.period*1000/clip.count);
                } else {
                    window.clearTimeout(idleTimer);
                    idleTimer = 0;
                    idleView = -1;
                }
                paintedClip = stride.page;
                paintedTime = stride.time;
                const atlasIndex = (clip.firstCell ?? 0) + index;
                const key = [clip.url, stride.page, gait, view, atlasIndex, scale, stride.time, offsetX, offsetY].join("/");
                if (key === frameKey) return;
                frameKey = key;
                const [w,h] = clip.cell as [number,number];
                const [x,y] = clip.origins[index] as [number,number];
                const angle = view * Math.PI / 4;
                const residual = clip.times ? 0 : (stride.time-index/clip.count*clip.period)*(clip.speed ?? 0);
                const scaleChanged = scale !== lastScale;
                const cellChanged = w !== lastCellWidth || h !== lastCellHeight;
                if (scaleChanged) figure.style.setProperty("--sector-model-height", pos.width * .068 + "px");
                if (scaleChanged || cellChanged) {
                    layer.style.width = w*scale+"px";
                    layer.style.height = h*scale+"px";
                }
                if (page !== lastSheet) layer.style.backgroundImage = 'url("'+page.src+'")';
                if (page !== lastSheet || scaleChanged) {
                    layer.style.backgroundSize = page.naturalWidth*scale+"px "+page.naturalHeight*scale+"px";
                }
                if (atlasIndex !== lastAtlasIndex || scaleChanged || cellChanged || clip.cols !== lastColumns) {
                    layer.style.backgroundPosition = -(atlasIndex%clip.cols)*w*scale+"px "+(-Math.floor(atlasIndex/clip.cols)*h*scale)+"px";
                }
                lastSheet = page;
                lastScale = scale;
                lastCellWidth = w;
                lastCellHeight = h;
                lastColumns = clip.cols;
                lastAtlasIndex = atlasIndex;
                layer.style.transform = "translate("+((x+offsetX-Math.sin(angle)*residual)*scale)+"px,"+((y+offsetY-Math.cos(angle)*residual)*scale)+"px)";
                if (gait !== lastGait) layer.dataset.gait = lastGait = gait;
                if (view !== lastFacing) layer.dataset.facing = String(lastFacing = view);
                if (index !== lastFrame) layer.dataset.frame = String(lastFrame = index);
                if (stride.page !== lastClip) layer.dataset.clip = lastClip = stride.page;
                figure.classList.add("has-sector-model");
            }
            function failed(stage: SectorModelStage = "page", error?: unknown) {
                // One drop usually fails a facing index, a pose page and a braking page
                // together. They are one failure: keep the backoff already running.
                if (performance.now()<retryAfter) return;
                const delay=retryDelay(stage, error);
                retryAfter=performance.now()+delay;
                releaseTurns();
                figure.classList.remove("has-sector-model");
                window.clearTimeout(retryTimer);
                retryTimer=window.setTimeout(retry,delay);
            }
            const missing = missingSectorModelFeature();
            if (missing) reportSectorModelUnsupported(missing);
            notify.current = draw;
            window.addEventListener("online", retry);
            document.addEventListener("visibilitychange", retry);
            reducedMotion.addEventListener("change", idlePreferenceChanged);
            requestModel();
            return () => {
                live = false;
                ground.current = null;
                unground.current = null;
                settling.current = false;
                notify.current = null;
                window.clearTimeout(retryTimer);
                window.clearTimeout(idleTimer);
                window.removeEventListener("online", retry);
                document.removeEventListener("visibilitychange", retry);
                reducedMotion.removeEventListener("change", idlePreferenceChanged);
                if (page) { page.onload = null; page.onerror = null; }
                painted?.release();
                releaseWarmStarts();
                startArt.dispose();
                startReleaseArt.dispose();
                releaseArt.dispose();
                changeArt.dispose();
                changeReleaseArt.dispose();
                for (const slot of [...turnArt, ...turnReleaseArt]) slot.dispose();
                figure.classList.remove("has-sector-model");
                figure.style.removeProperty("--sector-model-height");
            };
        }, [folder, revision, style, decodePriority]);
        return <span aria-hidden="true" className="sector-model-figure" ref={element} />;
    },
);

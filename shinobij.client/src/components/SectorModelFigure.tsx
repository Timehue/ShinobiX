import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { useSectorModelPins } from "../lib/sector-model-pins";
import "./sector-model-figure.css";
import type { PlayerModel, SprintStyle } from "../lib/player-model";
import { advanceSectorStride, fitSectorStride, sectorStartEntry, type GroundStride } from "../../../shared/sector-model-motion";
import type { PackedMotion, SheetImage, SpriteClip, SpriteView } from "../lib/sector-pose-delivery";
import { readSectorModelObject } from "../lib/sector-model-object";
import { createPosePrerequisite } from "../lib/sector-pose-prerequisite";

type Model = { mapWidth: number; banks: SpriteView[]; packed?: PackedMotion };
type MovingGait = "walk" | "run";
type Position = { x: number; y: number; width: number; moving: boolean; now: number; gait?: MovingGait; snapped?: boolean; routed?: boolean };
export type SectorModelHandle = {
    place: (x: number, y: number, mapWidth: number, moving: boolean, gait?: MovingGait, routed?: boolean) => void;
    snap: (x: number, y: number, mapWidth: number) => void;
    ground: GroundStride;
    /** Advance a stationary actor to its planted pose. Returns true while it still needs frames. */
    stop: () => boolean;
};

// Least-recently-used: every distinct equipped peer adds a manifest, so a long session in busy sectors
// must not keep all of them. 96 covers the 53-model roster plus a crowded sector of player models.
// An evicted entry that a mounted figure still uses stays alive through that figure; a later mount
// re-reads the immutable manifest from the HTTP cache.
const MODEL_CACHE_LIMIT = 96;
const models = new Map<string, Promise<Model>>();

function loadModel(folder: string, revision: string): Promise<Model> {
    const url = folder + revision + ".json";
    const existing = models.get(url);
    if (existing) { models.delete(url); models.set(url, existing); return existing; }
    const request = readSectorModelObject(folder,revision+".json",".json",8*1024**2).then(bytes => {
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
}>(
    function SectorModelFigure({ kind, artBase, equipped, style = "A" }, ref) {
        const {revisions} = useSectorModelPins();
        const revision = equipped?.version ?? revisions[kind];
        const folder = artBase.replace(/\/$/, "") + "/" + (equipped ? "players/" + equipped.assetId : kind) + "/";
        const element = useRef<HTMLSpanElement>(null);
        const latest = useRef<Position | null>(null);
        const notify = useRef<(() => void) | null>(null);
        const ground = useRef<GroundStride | null>(null);
        const settling = useRef(false);
        useImperativeHandle(ref, () => ({
            ground: (...args) => ground.current?.(...args),
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

            function retry() {
                window.clearTimeout(retryTimer);
                if (!live || document.hidden || !navigator.onLine) return;
                if (model) { retryAfter = 0; draw(); }
                else requestModel();
            }

            function requestModel() {
                void loadModel(folder, revision).then(asset => {
                    if (live) {
                        model = { ...asset, banks: asset.banks.map(bank => ({
                            ...bank, run: bank["run"+style] ?? bank.run!,
                        })) };
                        draw();
                    }
                }).catch(() => {
                    if (!live) return;
                    figure.classList.remove("has-sector-model");
                    window.clearTimeout(retryTimer);
                    retryTimer = window.setTimeout(retry, 30_000);
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
            let preparedChange: SpriteClip | undefined;
            function brakePage(bank: SpriteView, pageName: string) {
                return Object.values(bank).find(clip =>
                    (clip.source ?? clip.entryGait) === pageName && clip.target === "idle")?.page;
            }
            function retainPage(slot: typeof releaseArt, spec: SpriteClip["page"], onFailure?: () => void) {
                return !spec || slot.ready(spec.file,
                    () => import("../lib/sector-pose-delivery").then(m => m.loadPackedImage(folder, spec)), onFailure);
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
                void import("../lib/sector-pose-delivery").then(m=>m.loadPackedImage(folder,spec))
                    .then(image=>image.release(),()=>{if(nextPage===spec.file) nextPage="";});
            }
            function waitForArt() {
                waiting = true;
                const now = performance.now();
                waitingSince ??= now;
                if (now-waitingSince < 400) return {distance:0,idle:false};
                // A cold download must never hold navigation until the network timeout.
                usingPortrait = true;
                figure.classList.remove("has-sector-model");
                return undefined;
            }
            function facingBank(facing: number) {
                const bank = model?.banks[facing];
                if (bank || !model?.packed || pendingFacings.has(facing) || performance.now()<retryAfter) return bank;
                pendingFacings.add(facing);
                const file = model.packed.styles[style][facing];
                void import("../lib/sector-pose-delivery").then(m=>m.loadFacing(folder,file)).then(bank=>{
                    pendingFacings.delete(facing);
                    if (model && live) { model.banks[facing]=bank; if (!driven) draw(); }
                }).catch(()=>{pendingFacings.delete(facing); if(live) failed();});
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
                    const fail = () => {if (live && currentUrl===clip.url) {pendingUrl=""; failed();}};
                    if (clip.page) {
                        const spec=clip.page;
                        void import("../lib/sector-pose-delivery").then(m=>m.loadPackedImage(folder,spec)).then(ready,fail);
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
            // actor moves; a new facing or gait at rest warms its own set.
            function warmStarts() {
                const packed = model?.packed;
                const start = "start-" + (latest.current?.gait ?? "walk");
                const key = view + start;
                if (!packed || warmKey === key) return;
                releaseWarmStarts();
                warmKey = key;
                const run = ++warmRun, origin = view, banks = model!.banks;
                void import("../lib/sector-pose-delivery").then(async delivery => {
                    let remainingBytes = 12 * 1024 ** 2;
                    for (const facing of [origin, ...[2, 6, 4, 0].filter(to => to !== origin)]) {
                        if (!live || run !== warmRun) return;
                        const bank = banks[facing] ??
                            await delivery.loadFacing(folder, packed.styles[style][facing]).catch(() => undefined);
                        if (!bank) continue;
                        banks[facing] ??= bank;
                        for (const spec of [bank[start]?.page, brakePage(bank, start)]) {
                            if (!live || run !== warmRun) return;
                            if (!spec) continue;
                            const bytes = spec.cell[0] * spec.cell[1] * spec.cols * Math.ceil(spec.frames / spec.cols) * 4;
                            if (bytes > remainingBytes) continue;
                            remainingBytes -= bytes;
                            const warmed = await delivery.loadPackedImage(folder, spec).catch(() => undefined);
                            // The crowd can exhaust the shared idle cache before the next
                            // input. Keep this self-only budget until playback owns it.
                            if (warmed && live && run === warmRun) warmStartPages.push(warmed);
                            else warmed?.release();
                        }
                    }
                }).catch(() => {});
            }
            ground.current = (direction, desired, dt, allowance, afterBrake) => {
                if (!model?.packed || performance.now()<retryAfter) {
                    driven = false;
                    waiting = false;
                    return;
                }
                driven = true;
                const angle = view * Math.PI / 4;
                const dx = direction?.dx ?? Math.sin(angle), dy = direction?.dy ?? Math.cos(angle);
                const facing = direction ? facingFor(dx,dy) : view;
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
                const pose = fitSectorStride(bank,state,desired,elapsed,allowance,dx,dy);
                const poseReady = sheetReady(bank[pose.page]);
                const releaseReady = !desired || retainPage(releaseArt, brakePage(bank, pose.page), failed);
                if (!poseReady || !releaseReady) return waitForArt();
                if (desired) releaseWarmStarts();
                if (!afterBrake) { startArt.clear(); startReleaseArt.clear(); }
                if (desired && pose.page==="start-"+desired) prepareNext(bank[desired]);
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
                    preparedChange = undefined;
                    if (!desired && !afterBrake) warmStarts();
                }
                index = pose.cell;
                gait = desired ?? "idle";
                // Recenter the small lateral settling offset as the next stride travels.
                const retain = Math.max(0,1-pose.travel/24);
                offsetX = offsetX*retain+pose.offsetX;
                offsetY = offsetY*retain+pose.offsetY;
                return {distance:pose.distance,idle:pose.page==="idle"};
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
                    if (pos.moving && distance > .001 && prior?.width === pos.width)
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
            function failed() {
                retryAfter=performance.now()+30_000;
                figure.classList.remove("has-sector-model");
                window.clearTimeout(retryTimer);
                retryTimer=window.setTimeout(retry,30_000);
            }
            notify.current = draw;
            window.addEventListener("online", retry);
            document.addEventListener("visibilitychange", retry);
            reducedMotion.addEventListener("change", idlePreferenceChanged);
            requestModel();
            return () => {
                live = false;
                ground.current = null;
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
                figure.classList.remove("has-sector-model");
                figure.style.removeProperty("--sector-model-height");
            };
        }, [folder, revision, style]);
        return <span aria-hidden="true" className="sector-model-figure" ref={element} />;
    },
);

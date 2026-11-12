import { test, expect, type Locator, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { lifeSceneView, lifeWanderer, parseLifeState, type LifeActor } from "../../shared/sector-life";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";
import { worldPositionModel } from "../../shared/continuous-world-layout";
import { quietRoadCooldowns } from "../e2e-live/helpers/quiet-road";
import type { MotionClip } from "../../shared/sector-model-motion";

// Bound a release from the actual displayed source frame, using the authored
// travel tables. The compact portrait brake has a different distance limit.
function releaseTravelBound(bank:Record<string,MotionClip>,source:string,cell:number,dx:number) {
    let distance=0;
    const at=(clip:MotionClip,index:number)=>clip.travel?.[index] ?? index/clip.count*clip.period*(clip.speed??0);
    for(let hops=0;hops<3;hops++) {
        const clip=bank[source];
        expect(clip,'The release must identify an authored source clip').toBeTruthy();
        const contact=Object.values(bank).filter(c=>(c.source??c.entryGait)===source && c.target==='idle' && c.entry!==undefined)
            .sort((a,b)=>a.entry!-b.entry!).find(c=>c.entry!>=cell);
        if(contact) return distance+Math.max(0,at(clip,contact.entry!)-at(clip,cell))
            +contact.travel!.at(-1)!-contact.travel![0]+(contact.correction?.[0]??0)*dx;
        distance+=(clip.travel?.at(-1)??clip.period*(clip.speed??0))-at(clip,cell);
        source=clip.target??source;cell=clip.exitFrame??0;
    }
    throw Error('Release has no reachable authored contact');
}

const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? "../.ci-evidence/sector-models");
const pinFolder = resolve("src/data/sector-models");
const npcRevisions = new Map(readdirSync(pinFolder).filter(file => file.endsWith(".json")).map(file => {
    const {manifestSha256} = JSON.parse(readFileSync(resolve(pinFolder,file),"utf8"));
    return [file.slice(0,-5), String(manifestSha256)] as const;
}));
const roster: Record<string,{assetId:string; version:string}> | undefined = process.env.SECTOR_MODEL_TEST_ROSTER
    ? JSON.parse(readFileSync(process.env.SECTOR_MODEL_TEST_ROSTER, "utf8")) : undefined;
const uploadId = process.env.SECTOR_MODEL_TEST_PLAYER_ID ?? "";
if (process.env.SECTOR_MODEL_CAPTURE) test.use({video:'off',trace:'off'});
let artServer: Server | undefined;
let artBase = process.env.SECTOR_MODEL_TEST_ART_BASE ?? "";
const receivedModelObjects = new WeakMap<Page,Set<string>>();
test.beforeEach(({page}) => {
    const received=new Set<string>();
    receivedModelObjects.set(page,received);
    page.on("response",response=>{
        if(response.ok() && response.url().startsWith(artBase+"/")) received.add(response.url());
    });
});
async function installPilotResidents(page: Page, sector: number, now: () => number = Date.now, weather = "clear", kinds: readonly ("patrol" | "medic" | "merchant" | "bell-wraith" | "riftspawn" | "beast" | "raiju-storm-hound" | "hollow-hound")[] = ["patrol", "medic"], routePattern?:{tile:number;repeat:number;frames:[number,number][]}) {
    const customPortraits:Record<string,string>={};
    for(const [kind,prefix] of [["bell-wraith","bell-wraith"],["riftspawn","riftspawn"],["beast","demo-emberfox"],["raiju-storm-hound","raiju-storm-hound"]]){
        if(!kinds.includes(kind as typeof kinds[number]))continue;
        const matches=readdirSync(resolve("dist/assets")).filter(file=>file.startsWith(prefix+'-')&&file.endsWith('.webp'));
        expect(matches).toHaveLength(1);customPortraits[kind]='/assets/'+matches[0];
    }
    if(kinds.includes("hollow-hound"))customPortraits["hollow-hound"]="/hollow-gate/hollow-hound-idle.webp";
    await page.route("**/api/sector/life**", async route => {
        const start = now();
        const scene = lifeSceneView(sector, parseLifeState(null, start), start, weather);
        const actors = kinds.map((kind, i) => {
            const creature=kind==='riftspawn'||kind==='beast'||kind==='raiju-storm-hound'||kind==='hollow-hound';
            const tile = routePattern?.tile ?? (creature ? (kind==='beast'||kind==='hollow-hound'?66:65) : 65 + 12*i);
            const actor: LifeActor = { id: "pilot-"+kind, name: {patrol:"Patrol",medic:"Medic",merchant:"Merchant","bell-wraith":"Bell Wraith",riftspawn:"Riftspawn",beast:"Ember Fox","raiju-storm-hound":"Raiju Storm Hound","hollow-hound":"Hollow Hound"}[kind],
                art: "guard", tile, restTile: tile, workTile: tile+1, activity: kind === "bell-wraith" ? "Resting" : "Walking", line: "The road is clear.",
                motion: { start, repeat: routePattern?.repeat ?? (creature?17000:6500), frames: routePattern?.frames ?? (kind === "bell-wraith" ? [[0,tile],[6500,tile]] : creature ?
                    (kind==='beast'||kind==='hollow-hound'?[[0,66],[4000,65],[8000,53],[12000,65],[16000,66],[17000,66]]:
                    [[0,65],[4000,66],[8000,65],[12000,77],[16000,65],[17000,65]]) : [[0,tile],[3000,tile+1],[6000,tile],[6500,tile]]) } };
            return { ...actor, wanderer: { ...lifeWanderer(sector,actor), avatarKey: kind === "bell-wraith" ? "nemesis" : kind,
                ...(customPortraits[kind] ? {avatarImage:customPortraits[kind]} : {}) } };
        });
        await route.fulfill({ json: { ok: true, serverNow: start, view: { ...scene, actors } } });
    });
}
async function returnToTerrain(back: Locator) {
    if (!await back.isVisible()) return;
    try { await back.click({timeout:15000}); }
    catch (error) {
        // The login restore can finish the same navigation while the button is settling.
        if (await back.isVisible() || !await back.page().locator(".continuous-world-map > canvas").isVisible()) throw error;
    }
}

async function expectStarterArtwork(page: Page, figure: Locator, kind: string) {
    const revision = npcRevisions.get(kind)!;
    const registries=readdirSync(resolve("dist/assets")).filter(file=>/^sector-model-pins-.+\.json$/.test(file));
    expect(registries).toHaveLength(1);
    const built=new Map<string,string>(JSON.parse(await readFile(resolve("dist/assets",registries[0]!),"utf8")));
    expect(built.get(kind)).toBe(revision);
    const manifest = JSON.parse(await readFile(resolve(content,kind,revision+".json"),"utf8"));
    // The full game can exceed the browser's Resource Timing buffer. Observe
    // actual responses for the test lifetime instead of consulting that buffer.
    await expect.poll(() => receivedModelObjects.get(page)?.has(
        artBase+"/"+kind+"/"+revision+".json")).toBe(true);
    await expect(figure).toHaveCSS("background-image", manifest.format === "sector-motion-v2"
        ? /blob:/ : new RegExp("/"+kind+"/"));
}

async function enterEquippedSector(page: Page, account: string, model: {assetId:string;version:string}, style: string, tile = 66) {
    const save = uiAuditSave();
    save.currentSector = 46;
    save.currentTile = tile;
    save.character = {...save.character, name:account, starterCardsClaimed:true, playerModel:model,
        wandererCooldowns:quietRoadCooldowns([46])};
    await installUiAuditRuntime(page,save,false,account);
    await page.route("**/api/world/sector-layout", route => route.fulfill({json:{
        obstaclesEnabled:true, playerGaitsEnabled:true, modelArtBase:artBase,
    }}));
    await page.addInitScript(({owner, sprintStyle}) => {
        localStorage.setItem("legacyRumors.seen.v1:"+owner.toLowerCase(),"[10,20,30,40,45]");
        localStorage.setItem("worldSprintStyle.v1",sprintStyle);
    }, {owner:account, sprintStyle:style});
    await page.goto("/#/worldMap");
    const back = page.getByRole("button",{name:/Return to Sector 46/});
    const canvas = page.locator(".continuous-world-map > canvas");
    await expect(back.or(canvas).first()).toBeVisible({timeout:60000});
    await returnToTerrain(back);
    const actor = page.locator("[data-world-self] .sector-model-figure");
    await expect(actor).toHaveAttribute("data-clip","idle",{timeout:15000});
    return {canvas, actor};
}

async function tapWalkThenRun(page: Page, canvas: Locator, actor: Locator) {
    const toggle = page.getByRole("button",{name:"Run",exact:true});
    await expect(toggle).toHaveAttribute("aria-pressed","true");
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed","false");
    await canvas.scrollIntoViewIfNeeded();
    const destination = await canvas.evaluate(el => {
        const rect = el.getBoundingClientRect();
        // Walk east along the same sector road the keyboard control just used.
        const tile = rect.width / 12;
        const x = rect.left + rect.width / 2 + 2 * tile;
        const y = rect.top + rect.height / 2;
        for (const offset of [0, -.2, .2]) {
            if (document.elementFromPoint(x,y+tile*offset) === el) return {x,y:y+tile*offset};
        }
        throw new Error("The east road is covered by another touch target");
    });
    const start = Number(await canvas.getAttribute("data-world-x"));
    await page.touchscreen.tap(destination.x,destination.y);
    await expect(actor).toHaveAttribute("data-clip","walk",{timeout:10_000});
    await actor.evaluate(el=>{
        delete el.dataset.touchRunFrames;
        const frames=new Set<string>();
        const observer=new MutationObserver(()=>{
            if(el.getAttribute('data-clip')==='run' && el.parentElement?.classList.contains('has-sector-model')) {
                frames.add(el.getAttribute('data-frame')!);
                el.dataset.touchRunFrames=JSON.stringify([...frames]);
            }
            if(frames.size>=3 && el.getAttribute('data-clip')==='idle')observer.disconnect();
        });
        observer.observe(el,{attributes:true,attributeFilter:['data-frame','data-clip']});
    });
    await expect(toggle).toBeEnabled({timeout:25_000});
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed","true");
    await expect.poll(async()=>JSON.parse(await actor.getAttribute('data-touch-run-frames')??'[]').length,
        {timeout:10_000,message:'The touch route must paint three distinct fitted run poses'}).toBeGreaterThanOrEqual(3);
    await expect(actor).toHaveAttribute("data-clip","idle",{timeout:12_000});
    const landed = Number(await canvas.getAttribute("data-world-x"));
    expect(landed-start).toBeGreaterThan(.75);
    await page.waitForTimeout(180);
    expect(Number(await canvas.getAttribute("data-world-x"))).toBe(landed);
}
test.beforeAll(async () => {
    if (artBase || !existsSync(content)) return;
    const server = createServer(async (req, res) => {
        const path = req.url?.match(/^\/sector-models\/([a-z0-9]+(?:-[a-z0-9]+)*|players\/[a-f0-9]{32})\/([a-f0-9]{64}\.(json|webp|gz|264))$/);
        if (!path || (!path[1]!.startsWith("players/") && !npcRevisions.has(path[1]!))) {
            res.writeHead(404).end(); return;
        }
        try {
            const data = await readFile(resolve(content, path[1]!, path[2]!));
            res.writeHead(200, { "Content-Type": path[3] === "json" ? "application/json" : path[3] === "webp" ? "image/webp" : "application/octet-stream",
                "Content-Length":data.length, "Cache-Control":"public, max-age=31536000, immutable", "Access-Control-Allow-Origin":"*",
                "Timing-Allow-Origin":"*" }).end(data);
        } catch { res.writeHead(404).end(); }
    });
    await new Promise<void>((done, reject) => server.once("error", reject).listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local content port");
    artServer = server;
    artBase = "http://127.0.0.1:"+address.port+"/sector-models";
});
test.afterAll(async () => {
    if (artServer) {
        artServer.closeAllConnections();
        await new Promise<void>(done => artServer!.close(() => done()));
        artServer = undefined;
        artBase = "";
    }
});

// Full package qualification runs once per proposed release. Normal gameplay tests fetch on demand.
if (process.env.SECTOR_MODEL_DECODE_REVIEW) test.describe("complete pilot sprite decode", () => {
    for (const [actor, ref] of Object.entries(roster ?? {})) {
        test(actor, async ({page}, info) => {
            test.setTimeout(15*60_000);
            if (!artBase) throw Error("Missing staged pilot content");
            const files=readdirSync(resolve("dist/assets")).filter(n=>/^sector-pose\.worker-.+\.js$/.test(n));
            expect(files).toHaveLength(1);
            // A colon selects a resident pin explicitly. Player rows use their immutable owner asset.
            const folder=actor.startsWith("npc:") ? actor.slice(4) : "players/"+ref.assetId;
            if (actor.startsWith("npc:")) expect(npcRevisions.get(folder)).toBe(ref.version);
            await page.goto("/health");
            const result=await page.evaluate(async ({root,workerPath,revision})=>{
                const decoder=new Worker(workerPath,{type:"module"});
                const checked = new Map<string,{file:string;cell:[number,number];cols:number;frames:number}>();
                const verified=async (name:string)=>{
                    const response=await fetch(root+name,{credentials:"omit"});
                    if (!response.ok) throw Error("Missing sprite file "+name);
                    const bytes=await response.arrayBuffer();
                    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
                        b=>b.toString(16).padStart(2,"0")).join("");
                    if (name.split(".")[0]!==digest) throw Error("Wrong sprite file "+name);
                    return bytes;
                };
                const indexes=new Set<string>();
                let headings=0, clips=0, frames=0, peakAtlasBytes=0;
                try {
                    const model=JSON.parse(new TextDecoder().decode(await verified(revision+".json")));
                    for (const style of ["A","B","C"]) {
                        if (model.styles[style]?.length!==8) throw Error("Missing heading "+style);
                        for (const file of model.styles[style]) {headings++; indexes.add(file);}
                    }
                    for (const name of indexes) {
                        const bytes=await verified(name);
                        const index=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
                        for (const clip of Object.values(index.clips) as Array<{file:string;count:number;firstCell?:number}>) {
                            const p=index.pages[clip.file];
                            if (!p || clip.count<1 || (clip.firstCell??0)+clip.count>p.frames) throw Error("Missing visible poses "+name);
                            checked.set([p.file,p.cols,...p.cell,p.frames].join("/"),p);
                            clips++;
                        }
                    }
                    for (const p of checked.values()) {
                        const bytes=await verified(p.file);
                        const [w,h]=p.cell;
                        const width=p.cols*w,height=Math.ceil(p.frames/p.cols)*h;
                        const decoded=await new Promise<Uint8ClampedArray>((done,fail)=>{
                            const timer=setTimeout(()=>fail(Error("Decode timed out "+p.file)),30000);
                            decoder.onerror=e=>{clearTimeout(timer);fail(Error(e.message));};
                            decoder.onmessage=({data})=>{
                                clearTimeout(timer);
                                if (data.error || data.width!==width || data.height!==height) fail(Error(data.error || "Wrong dimensions"));
                                else done(data.pixels);
                            };
                            decoder.postMessage({...p,bytes},[bytes]);
                        });
                        if (decoded.length!==width*height*4) throw Error("Incomplete decoded page");
                        peakAtlasBytes=Math.max(peakAtlasBytes,decoded.byteLength);
                        for(let n=0;n<p.frames;n++) {
                            const offset=((n%p.cols)*w+Math.floor(n/p.cols)*h*width)*4;
                            let opaque=0;
                            for(let y=0;y<h && opaque<32;y++) for(let x=0;x<w;x++)
                                if (decoded[offset+4*(y*width+x)+3]>=128) opaque++;
                            if (opaque<32) throw Error("Empty character in "+p.file+" frame "+n);
                        }
                        frames+=p.frames;
                    }
                    return {revision,headings,indexes:indexes.size,clips,pages:checked.size,frames,peakAtlasBytes};
                } finally {decoder.terminate();}
            },{root:artBase+"/"+folder+"/",workerPath:"/assets/"+files[0],revision:ref.version});
            expect(result.headings).toBe(24);
            expect(result.peakAtlasBytes).toBeLessThanOrEqual(12*1024**2);
            const path=info.outputPath("complete-decode.json");
            await writeFile(path,JSON.stringify(result));
            await info.attach("complete-decode",{path,contentType:"application/json"});
        });
    }
});

if (process.env.SECTOR_MODEL_LIGHTING_REVIEW) test.describe("Frostfang pilot review", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });
    // These instants produce clear midday, clear midnight and midday rain in Sector 27.
    for (const [scene, hour, weather] of [["day",11,"clear"],["night",0,"clear"],["rain",1,"rain"]] as const) {
        test(scene, async ({page}, info) => {
            const model = roster?.Zayah;
            if (!model || !artBase) throw new Error("Mount Zayah, Patrol and Medic for the lighting review");
            const manifests = new Set<string>();
            const artResponses: Array<{path:string; bytes:number}> = [];
            page.on("response",response => {
                if (response.ok() && response.url().startsWith(artBase+"/")) {
                    const path = response.url().slice(artBase.length+1);
                    if (path.endsWith(".json")) manifests.add(path);
                    artResponses.push({path,bytes:Number(response.headers()["content-length"])});
                }
            });
            const instant = Date.UTC(2026, 10, 8, hour);
            await page.clock.setSystemTime(new Date(instant));
            const save = uiAuditSave();
            const sector = 27;
            save.currentSector = sector;
            save.currentTile = 66;
            save.character = { ...save.character, name: "Zayah", playerModel: model, starterCardsClaimed: true,
                wandererCooldowns: quietRoadCooldowns([sector]) };
            await installUiAuditRuntime(page, save, false, "Zayah");
            await installPilotResidents(page, sector, () => instant, weather);
            // Exercise another player's equipped art through the normal nearby-player poll.
            const peer = roster?.Raccoon;
            if (peer) {
                const world = worldPositionModel();
                const position = world.fallback(sector, 67);
                if (!position || position.from !== sector+":67") throw new Error("Missing peer review tile");
                await page.route("**/api/player/world-move", route => route.request().method() !== "GET"
                    ? route.fallback() : route.fulfill({json:{ok:true, sector, tile:66, sequence:0,
                        worldPosition:world.fallback(sector,66), players:[{name:"Raccoon", level:1, currentSector:sector,
                            tile:67, movementSequence:0, worldPosition:position, character:{playerModel:peer}}]}}));
            }
            await page.route("**/api/world/sector-layout", route => route.fulfill({
                json: { obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: artBase },
            }));
            await page.addInitScript(() => localStorage.setItem("legacyRumors.seen.v1:zayah", "[10,20,30,40,45]"));
            if (process.env.SECTOR_MODEL_RECORD_ROAD) await page.addInitScript(() => localStorage.setItem('worldSprintStyle.v1','C'));
            await page.goto("/#/worldMap");
            const back = page.getByRole("button", { name: /Return to Sector 27/ });
            const map = page.locator(".continuous-world-map");
            await expect(back.or(map).first()).toBeVisible({timeout:60_000});
            await returnToTerrain(back);
            await expect(page.locator(".sector-sky-current").first()).toHaveText(weather === "rain" ? "Rainstorm" : "Clear Skies");
            const opacity = () => map.locator(".day-night-tint").evaluate(el => Number(getComputedStyle(el).opacity));
            if (scene === "night") await expect.poll(opacity).toBeGreaterThan(.4);
            else await expect.poll(opacity).toBeLessThan(.02);
            const bounds = await map.boundingBox();
            if (!bounds) throw new Error("Missing sector viewport");
            const selectors = ["[data-world-self]", '[data-life-resident="pilot-patrol"]', '[data-life-resident="pilot-medic"]'];
            if (peer) selectors.push('.continuous-world-peer[title^="Raccoon ("]');
            for (const selector of selectors) {
                const figure = map.locator(selector + " .sector-model-figure");
                await expect(figure).toHaveCSS("background-image", /blob:/, {timeout:20_000});
                const box = await figure.boundingBox();
                if (!box) throw new Error("Missing fitted character " + selector);
                expect(box.x).toBeGreaterThanOrEqual(bounds.x);
                expect(box.y).toBeGreaterThanOrEqual(bounds.y);
                expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
                expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
            }
            const path = info.outputPath(scene + ".png");
            if (peer) {
                const nameplate = map.locator('.continuous-world-peer .sector-peer-label').filter({hasText:'Raccoon'});
                await expect(nameplate).toBeVisible();
                expect(await nameplate.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            }
            const expected = [`players/${model.assetId}/${model.version}.json`,
                ...["patrol","medic"].map(kind => `${kind}/${npcRevisions.get(kind)}.json`)];
            if (peer) expected.push(`players/${peer.assetId}/${peer.version}.json`);
            for (const revision of expected) expect(manifests.has(revision),revision).toBe(true);
            await info.attach("visible-revisions",{body:JSON.stringify(expected),contentType:"application/json"});
            await map.screenshot({path});
            await info.attach("sector-" + scene, {path, contentType:"image/png"});
            // Compare the cold scene's requested art with the complete local actor packages.
            // Count repeat responses as well. The local art server supplies exact lengths.
            if (!process.env.SECTOR_MODEL_TEST_ART_BASE) {
                const sizes = [];
                for (const revision of expected) {
                    const folder = revision.slice(0,revision.lastIndexOf("/")+1);
                    const header = JSON.parse(await readFile(resolve(content,revision),"utf8"));
                    const facings = new Set<string>(Object.values(header.styles).flat() as string[]);
                    const requests = artResponses.filter(r => r.path.startsWith(folder));
                    expect(requests.every(r=>Number.isSafeInteger(r.bytes) && r.bytes>0)).toBe(true);
                    const opened = new Set(requests.filter(r=>r.path.endsWith(".gz")).map(r=>r.path.slice(folder.length)));
                    expect(opened.size).toBeGreaterThan(0);
                    expect(opened.size).toBeLessThan(facings.size);
                    expect(requests.some(r=>r.path.endsWith(".264"))).toBe(true);
                    sizes.push({revision,requests:requests.length,bytes:requests.reduce((sum,r)=>sum+r.bytes,0),
                        facingIndexes:opened.size,availableIndexes:facings.size});
                }
                await writeFile(info.outputPath("art-load.json"),JSON.stringify(sizes,null,2));
            }
            if (process.env.SECTOR_MODEL_RECORD_ROAD && scene === 'day' && info.project.name === 'chromium-desktop') {
                await map.scrollIntoViewIfNeeded();
                const crop=await map.boundingBox(), viewport=page.viewportSize();
                if (!crop || !viewport || crop.y<0 || crop.x<0 || crop.y+crop.height>viewport.height+1)
                    throw Error('The complete sector must be visible to capture gameplay');
                const actor=map.locator('[data-world-self] .sector-model-figure');
                const canvas=map.locator('canvas').first();
                const toggle=page.getByRole('button',{name:'Run',exact:true});
                if (await toggle.getAttribute('aria-pressed')==='true') await toggle.click();
                const observations: {gait:string;facing:string|null;frame:string|null}[]=[];
                const travel=async (key:string,gait:string,ms:number) => {
                    await canvas.focus();
                    await page.keyboard.down(key);
                    try {
                        await expect(actor).toHaveAttribute('data-clip',gait,{timeout:10000});
                        observations.push({gait,facing:await actor.getAttribute('data-facing'),frame:await actor.getAttribute('data-frame')});
                        await page.waitForTimeout(ms);
                    } finally { await page.keyboard.up(key); }
                    await expect(actor).toHaveAttribute('data-clip','idle',{timeout:10000});
                };
                await page.screencast.start({path:info.outputPath('sector-road.webm'),size:viewport});
                try {
                    await travel('ArrowRight','walk',1250);
                    await toggle.click();
                    await travel('ArrowLeft','run',1050);
                    await travel('ArrowRight','run',1050);
                    await page.waitForTimeout(800);
                } finally { await page.screencast.stop(); }
                expect(observations.map(row=>row.facing)).toEqual(['2','6','2']);
                await writeFile(info.outputPath('sector-road.json'),JSON.stringify({crop,viewport,style:'C',observations,expected}));
            }
        });
    }
});

test("Profile confirms cancellation and explains the used monthly creation", async ({page}) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.route("**/api/world/sector-layout", route => route.fulfill({json:{
        obstaclesEnabled:true, modelArtBase:'https://models.test/sector-models',
    }}));
    const pending = {id:'cancel-profile-job', month:'2026-12', state:'queued'};
    await page.route(/\/api\/avatar-model\/models(?:\?.*)?$/, route => route.fulfill({json:{models:[],before:null,pending}}));
    await page.route("**/jobs/cancel-profile-job", route => route.fulfill({json:pending}));
    let requests = 0;
    await page.route("**/jobs/cancel-profile-job/cancel", route => {
        expect(route.request().method()).toBe('POST');
        requests++;
        return route.fulfill({json:{state:'cancelled'}});
    });
    await expectUiAuditBoot(page,runtime,"profile");
    await page.getByRole("button",{name:"Equip Model",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"World model"});
    const cancel=dialog.getByRole('button',{name:'Cancel model request'});
    page.once('dialog', prompt => prompt.dismiss());
    await cancel.click();
    await expect(cancel).toBeVisible();
    expect(requests).toBe(0);
    page.once('dialog', prompt => prompt.accept());
    await cancel.click();
    await expect(dialog.getByText(/Model creation was cancelled.*creation was used/)).toBeVisible();
    await expect(cancel).toHaveCount(0);
    expect(requests).toBe(1);
});

test("Profile recovers a refunded request after the player leaves", async ({page}) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.route("**/api/world/sector-layout", route => route.fulfill({ json: {
        obstaclesEnabled: true, modelArtBase: artBase || 'https://models.test/sector-models',
    } }));
    const job = { id: 'refunded-profile-job', month: '2026-12' };
    let processing = true;
    await page.route(/\/api\/avatar-model\/models(?:\?.*)?$/, route => {
        const recent = new URL(route.request().url()).searchParams.get('recent');
        const outcome = processing ? { pending: { ...job, state: 'render' } }
            : recent === job.id ? { ended: { ...job, state: 'failed', slot: 'available' } } : {};
        return route.fulfill({ json: { models: [], before: null, ...outcome } });
    });
    await expectUiAuditBoot(page, runtime, "profile");
    const opener = page.getByRole('button', { name: 'Equip Model', exact: true });
    const dialog = page.getByRole('dialog', { name: 'World model' });
    await opener.click();
    await expect(dialog.getByText(/Rendering sprites/)).toBeVisible();
    processing = false;
    await page.reload();
    await opener.click();
    await expect(dialog.getByText(/Model creation failed.*creation was returned/)).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Equip', exact: true })).toBeDisabled();
});

test("the top-left run button expires and refills automatically", async ({page}, info) => {
    await page.clock.install();
    const save = uiAuditSave();
    save.currentSector = 46;
    save.currentTile = 66;
    save.character = {...save.character, starterCardsClaimed:true, wandererCooldowns:quietRoadCooldowns([46])};
    const runtime = await installUiAuditRuntime(page, save);
    if (!artBase) await page.route('https://models.test/**', route => route.abort());
    await page.route('**/api/world/sector-layout', route => route.fulfill({json:{
        obstaclesEnabled:true, playerGaitsEnabled:true, modelArtBase:artBase || 'https://models.test/sector-models',
    }}));
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]'));
    await expectUiAuditBoot(page,runtime,'worldMap');
    const back = page.getByRole('button',{name:/Return to Sector 46/});
    const map = page.locator('.continuous-world-map');
    await expect(back.or(map).first()).toBeVisible();
    await returnToTerrain(back);
    const run = map.getByRole('button',{name:'Run',exact:true});
    await expect(run).toBeEnabled();
    if (artBase) await expect(map.locator('[data-world-self]')).toHaveClass(/has-sector-model/);
    const mapBounds = (await map.boundingBox())!, buttonBounds = (await run.boundingBox())!;
    expect(buttonBounds.x - mapBounds.x).toBeCloseTo(8, 0);
    expect(buttonBounds.y - mapBounds.y).toBeCloseTo(8, 0);
    expect(buttonBounds.width).toBeGreaterThanOrEqual(44);
    expect(buttonBounds.height).toBeGreaterThanOrEqual(44);
    await run.click();
    await expect(run).toHaveAttribute('data-run-state','running');
    await expect(run).toHaveAttribute('aria-pressed','true');
    await map.screenshot({path:info.outputPath('run-active.png')});
    await page.clock.fastForward(15_100);
    await expect(run).toHaveAttribute('data-run-state','refilling');
    await expect(run).toHaveAttribute('aria-pressed','false');
    await expect(run).toBeDisabled();
    await run.screenshot({path:info.outputPath('run-refilling.png')});
    await page.clock.fastForward(20_100);
    await expect(run).toHaveAttribute('data-run-state','ready');
    await expect(run).toBeEnabled();
});

test("Profile opens Make Model next to Upload avatar and creates one monthly model after confirmation", async ({page}, info) => {
    const save = uiAuditSave();
    save.character = {...save.character, patreon:{active:true,tier:'shinobi-supporter'}};
    const runtime = await installUiAuditRuntime(page, save);
    const token = 'f0d4ad57-c199-4a75-bf80-1cd8ace412f0';
    const job = {id:'profile-create',month:'2026-11',state:'queued'};
    let checks = 0, submissions = 0;
    await page.route("**/api/world/sector-layout", route => route.fulfill({json:{
        obstaclesEnabled:true,modelArtBase:'https://models.test/sector-models',worldModelCreationAvailable:true,
    }}));
    await page.route(/\/api\/avatar-model\/models(?:\?.*)?$/, route => route.fulfill({json:{models:[],before:null,
        ...(submissions ? {pending:job} : {creationAvailable:true})}}));
    await page.route("**/api/avatar-model/read", route => {
        expect(route.request().postDataJSON()).toEqual({});
        return ++checks === 1 ? route.fulfill({status:202,json:{state:'pending'}}) :
            route.fulfill({json:{state:'ready',summary:'Warrior in a hooded jacket',readToken:token}});
    });
    await page.route("**/api/avatar-model/jobs", route => {
        expect(route.request().postDataJSON()).toEqual({readToken:token,idempotencyKey:token});
        submissions++;
        return route.fulfill({status:202,json:{jobId:job.id}});
    });
    await page.route("**/api/avatar-model/jobs/profile-create", route => route.fulfill({json:job}));
    await expectUiAuditBoot(page,runtime,"profile");
    const avatarActions = page.locator('.profile-avatar-upload');
    const opener = avatarActions.getByRole("button",{name:"Make Model",exact:true});
    await expect(avatarActions.getByRole("button",{name:"Upload avatar",exact:true})).toBeVisible();
    await expect(opener).toBeVisible();
    const avatarStack = page.locator('.sic-avatar-stack').filter({ has: avatarActions });
    const stackBox = (await avatarStack.boundingBox())!;
    const buttonBox = (await opener.boundingBox())!;
    expect(buttonBox.x).toBeGreaterThanOrEqual(stackBox.x);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(stackBox.x + stackBox.width);
    const equip = page.locator('.sic-stat-grid').getByRole('button', {name:'Equip Model', exact:true});
    await expect(equip).toBeVisible();
    await page.locator('.shinobi-identity-card').filter({has: avatarActions})
        .screenshot({path: info.outputPath('profile-model-placement.png')});
    await opener.click();
    const dialog = page.getByRole("dialog",{name:"Make Model"});
    await expect(dialog.getByText(/sends your saved portrait to OpenAI and Modal/)).toBeVisible();
    expect(checks).toBe(0);
    await dialog.getByRole("button",{name:"Check portrait",exact:true}).click();
    await expect(dialog.getByText('Checking your portrait…')).toBeVisible();
    await expect(dialog.getByText('Warrior in a hooded jacket')).toBeVisible({timeout:15000});
    expect(submissions).toBe(0);
    await dialog.getByRole("button",{name:"Create model",exact:true}).click();
    const library = page.getByRole("dialog",{name:"World model"});
    await expect(library.getByText(/Queued for creation/)).toBeVisible();
    await page.reload();
    await equip.click();
    await expect(library.getByText(/Queued for creation/)).toBeVisible();
    expect(checks).toBe(2);
    expect(submissions).toBe(1);
});

test("Profile switches between both saved Supporter slots", async ({page}) => {
    const first = {assetId:'a'.repeat(32), version:'b'.repeat(64)};
    const second = {assetId:'c'.repeat(32), version:'d'.repeat(64)};
    const save = uiAuditSave();
    save.character = {...save.character, playerModel:first, playerModelSlots:[first,second],
        patreon:{active:true,tier:'shinobi-supporter'}};
    const runtime = await installUiAuditRuntime(page, save);
    const origin = 'https://models.test/sector-models';
    await page.route(origin + '/**', route => route.abort());
    await page.route('**/api/world/sector-layout', route => route.fulfill({json:{modelArtBase:origin}}));
    await page.route(/\/api\/avatar-model\/models(?:\?.*)?$/, route => route.fulfill({json:{models:[],before:null}}));
    await page.route('**/api/avatar-model/equip?snapshot=1', route => {
        expect(route.request().postDataJSON()).toEqual({assetId:second.assetId,slot:2});
        const character = {...save.character,playerModel:second};
        runtime.commitServerSave({character},100);
        return route.fulfill({json:{character,_saveVersion:100,playerModel:second}});
    });
    await expectUiAuditBoot(page,runtime,'profile');
    await expect(page.locator('.sic-stat-grid').getByText('2/2 slots saved')).toBeVisible();
    const opener = page.getByRole('button',{name:'Equip Model',exact:true});
    const dialog = page.getByRole('dialog',{name:'World model'});
    await opener.click();
    const slot = dialog.getByRole('button',{name:'Slot 2 · saved',exact:true});
    await slot.click();
    await expect(dialog.getByRole('combobox')).toHaveValue(second.assetId);
    await dialog.getByRole('button',{name:'Equip',exact:true}).click();
    await expect(dialog.getByRole('status')).toHaveText('World model equipped.');
    await page.reload();
    await opener.click();
    await expect(slot).toHaveAttribute('aria-pressed','true');
    await expect(dialog.getByRole('combobox')).toHaveValue(second.assetId);
});

test("Profile previews an owned model, equips it after a lapse and restores the default", async ({page}) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    save.character = { ...save.character, patreon: null };
    const runtime = await installUiAuditRuntime(page, save);
    const ref = roster?.Patrol ?? { assetId: 'e'.repeat(32), version: 'd'.repeat(64) };
    const origin = artBase || 'https://models.test/sector-models';
    if (!artBase || !roster?.Patrol) await page.route(origin + '/**', route => route.abort());
    await page.route("**/api/world/sector-layout", route => route.fulfill({ json: { obstaclesEnabled: true, modelArtBase: origin } }));
    const pending = { id: 'profile-job', month: '2026-11', state: 'render' };
    let ready = false;
    await page.route(/\/api\/avatar-model\/models(?:\?.*)?$/, route => route.fulfill({ json: ready ?
        { models: [{ ...ref, month: pending.month }], before: null } : { models: [], pending, before: null } }));
    await page.route("**/api/avatar-model/jobs/profile-job", route => route.fulfill({ json: ready ?
        { ...pending, state: 'ready', model: ref } : pending }));
    const choices: (string | null)[] = [];
    let version = 100;
    await page.route("**/api/avatar-model/equip?snapshot=1", async route => {
        const id = route.request().postDataJSON().assetId;
        choices.push(id);
        const char = { ...runtime.serverSave().character, playerModel: id ? ref : undefined };
        runtime.commitServerSave({ character: char }, ++version);
        await route.fulfill({ json: { character: char, _saveVersion: version, playerModel: id ? ref : null } });
    });
    await expectUiAuditBoot(page,runtime,"profile");
    const opener = page.getByRole("button", {name:"Equip Model",exact:true});
    const dialog = page.getByRole("dialog",{name:"World model"});
    const select = dialog.getByRole("combobox",{name:"World character"});
    await opener.click();
    await expect(dialog.getByText(/Rendering sprites/)).toBeVisible();
    await expect(dialog.getByRole("button", {name:"Equip",exact:true})).toBeDisabled();
    await page.reload();
    await opener.click();
    await expect(dialog.getByText(/Rendering sprites/)).toBeVisible();
    ready = true;
    await expect(dialog.getByText('Your new world model is ready to preview and equip.')).toBeVisible({timeout:25_000});
    await select.selectOption(ref.assetId);
    if (artBase && roster?.Patrol) {
        const sprite = dialog.locator(".sector-model-figure");
        await expect(sprite).toHaveAttribute("data-gait","idle",{timeout:20000});
        await dialog.getByRole("button",{name:"Preview walk"}).click();
        await expect(sprite).toHaveAttribute("data-clip","walk",{timeout:20000});
        await expect(sprite).toHaveAttribute("data-facing","2");
        await dialog.getByRole("button",{name:"Preview walk"}).click();
        await expect(sprite).toHaveAttribute("data-clip","idle",{timeout:20000});
        await expect(sprite).toHaveAttribute("data-facing","2");
    }
    await dialog.getByRole("button",{name:"Equip",exact:true}).click();
    await expect(dialog.getByRole("status")).toHaveText("World model equipped.");
    await page.reload();
    await opener.click();
    await expect(select).toHaveValue(ref.assetId);
    await select.selectOption('');
    await dialog.getByRole("button",{name:"Equip",exact:true}).click();
    await expect(dialog.getByRole("status")).toHaveText("Default character equipped.");
    await dialog.getByRole("button",{name:/close/i}).click();
    await expect(dialog).toHaveCount(0);
    expect(choices).toEqual([ref.assetId,null]);
});

test.describe("equipped player upload", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });
    test("a moving NPC uses its portrait during a delayed facing and restores its fitted animation",async({page},info)=>{
        test.setTimeout(90_000);
        test.skip(!artBase,"Mount the local NPC packages");
        const revision=npcRevisions.get("patrol")!;
        const manifest=JSON.parse(await readFile(resolve(content,"patrol",revision+".json"),"utf8"));
        expect(manifest.format).toBe("sector-motion-v2");
        let resume!:()=>void;
        const gate=new Promise<void>(ok=>{resume=ok;});
        let facingRequested=false;
        await page.route("**/"+manifest.styles.A[4],async route=>{facingRequested=true;await gate;await route.continue();});
        const save=uiAuditSave();save.currentSector=46;save.currentTile=70;
        save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
        const runtime=await installUiAuditRuntime(page,save);
        await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:artBase}}));
        await installPilotResidents(page,46,Date.now,"clear",["patrol"],{tile:64,repeat:48000,
            frames:[[0,64],[12000,65],[24000,53],[36000,65],[48000,64]]});
        await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
        try{
            await expectUiAuditBoot(page,runtime,"worldMap");
            const back=page.getByRole("button",{name:/Return to Sector 46/}),canvas=page.locator(".continuous-world-map > canvas");
            await expect(back.or(canvas).first()).toBeVisible({timeout:60_000});
            await returnToTerrain(back);
            const actor=page.locator('[data-life-resident="pilot-patrol"]'),figure=actor.locator('.sector-model-figure');
            await expect(actor).toHaveClass(/has-sector-model/,{timeout:25_000});
            await expect(figure).toHaveAttribute("data-facing","2");
            await expect.poll(()=>facingRequested,{timeout:20_000}).toBe(true);
            await expect(actor).not.toHaveClass(/has-sector-model/,{timeout:3000});
            const start=await actor.evaluate(el=>el.style.transform);
            await expect.poll(()=>actor.evaluate(el=>el.style.transform),{timeout:3000}).not.toBe(start);
            await page.screenshot({path:info.outputPath('npc-portrait-fallback.png')});
            resume();
            await expect(actor).toHaveClass(/has-sector-model/,{timeout:10_000});
            // The shared route clock keeps advancing during a download. A restored
            // figure must face its current ground travel, rather than the old request.
            let directionSamples:{visible:boolean;gait?:string;frame?:string;facing?:string;expectedFacing:number;distance:number}[]=[];
            try{
                await expect.poll(async()=>{
                    directionSamples=await actor.evaluate(async element=>{
                        const position=()=>{
                            const match=element.style.transform.match(/^translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
                            if(!match)throw Error('Missing ground transform');
                            return {x:Number(match[1]),y:Number(match[2])};
                        };
                        let previous=position();const samples=[];
                        for(let n=0;n<12;n++){
                            await new Promise(ok=>setTimeout(ok,50));
                            const next=position(),dx=next.x-previous.x,dy=next.y-previous.y;
                            const sprite=element.querySelector<HTMLElement>('.sector-model-figure');
                            samples.push({visible:element.classList.contains('has-sector-model'),gait:sprite?.dataset.gait,
                                frame:sprite?.dataset.frame,facing:sprite?.dataset.facing,
                                expectedFacing:(Math.round(Math.atan2(dx,dy)/(Math.PI/4))+8)%8,distance:Math.hypot(dx,dy)});
                            previous=next;
                        }
                        return samples;
                    });
                    const matched=directionSamples.filter(sample=>sample.visible&&sample.gait==='walk'&&sample.distance>.001
                        &&Number(sample.facing)===sample.expectedFacing);
                    return matched.length>=3&&new Set(matched.map(sample=>sample.frame)).size>=2;
                },{timeout:10_000,message:'Restored NPC poses must animate and match its actual travel direction'}).toBe(true);
            }finally{
                await writeFile(info.outputPath('npc-restored-direction.json'),JSON.stringify(directionSamples));
            }
            await page.screenshot({path:info.outputPath('npc-animation-restored.png')});
            await writeFile(info.outputPath('npc-delivery.json'),JSON.stringify({kind:"patrol",revision,delayedIndex:manifest.styles.A[4],routeContinued:true,restoredFacingMatchesGround:true}));
        }finally{resume();}
    });
    for (const sharedStyle of ["C",undefined] as const) test("default starter peer uses "+(sharedStyle??"legacy A")+" running style",async ({page},info)=>{
        test.setTimeout(90_000);
        test.skip(!artBase,"Mount the local starter packages");
        const kind="starter-one", revision=npcRevisions.get(kind)!;
        const manifest=JSON.parse(await readFile(resolve(content,kind,revision+".json"),"utf8"));
        if(process.env.SECTOR_MODEL_REQUIRE_COMPLETE_ROSTER==="1")expect(manifest.format).toBe("sector-motion-v2");
        test.skip(manifest.format!=="sector-motion-v2","The replacement starter is still rendering");
        const style=sharedStyle??"A";
        const index=JSON.parse(gunzipSync(await readFile(resolve(content,kind,manifest.styles[style][2]))).toString());
        const expectedRun=index.pages[index.clips.run.file].file;
        const received=new Set<string>();
        page.on("response",response=>{if(response.ok())received.add(response.url());});
        const save=uiAuditSave(); save.currentSector=46;save.currentTile=66;
        save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
        const runtime=await installUiAuditRuntime(page,save);
        await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{
            obstaclesEnabled:true,playerGaitsEnabled:true,modelArtBase:artBase,
        }}));
        const world=worldPositionModel();let tile=64;
        await page.route("**/api/player/world-move**",route=>{
            if(route.request().method()!=="GET")return route.fallback();
            return route.fulfill({json:{ok:true,sector:46,tile:66,sequence:0,worldPosition:world.fallback(46,66),players:[{
                name:"Starter Scout",level:5,currentSector:46,tile,worldPosition:world.fallback(46,tile),movementSequence:tile,
                ...(sharedStyle?{gaitPresentation:{gait:"run",style:sharedStyle}}:{}),
                character:{avatarImage:"/starter-avatar-one.webp?v=2"},
            }]}});
        });
        await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
        await expectUiAuditBoot(page,runtime,"worldMap");
        const back=page.getByRole("button",{name:/Return to Sector 46/});
        const canvas=page.locator(".continuous-world-map > canvas");
        await expect(back.or(canvas).first()).toBeVisible({timeout:60_000});
        await returnToTerrain(back);
        const peer=page.locator(".continuous-world-peer").filter({hasText:"Starter Scout"});
        const sprite=peer.locator(".sector-model-figure");
        await expect(sprite).toHaveAttribute("data-clip","idle",{timeout:15_000});
        await expectStarterArtwork(page,sprite,kind);
        await expect(peer).toHaveClass(/has-sector-model/);
        expect(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
        tile=70;
        await expect(sprite).toHaveAttribute("data-facing","2",{timeout:15_000});
        await expect(sprite).toHaveAttribute("data-clip","run",{timeout:15_000});
        expect(received.has(artBase+"/"+kind+"/"+manifest.styles[style][2])).toBe(true);
        expect(received.has(artBase+"/"+kind+"/"+expectedRun)).toBe(true);
        const first=await sprite.getAttribute("data-frame");
        await expect.poll(()=>sprite.getAttribute("data-frame")).not.toBe(first);
        const evidence=info.outputPath("default-peer-style.json");
        await writeFile(evidence,JSON.stringify({kind,revision,sharedStyle:sharedStyle??null,resolvedStyle:style,expectedRun}));
        await info.attach("default-peer-style",{path:evidence,contentType:"application/json"});
    });
    const fittedPlayers = roster ?? {upload:{assetId:uploadId,version:process.env.SECTOR_MODEL_TEST_MOTION_VERSION ?? ""}};
    if (process.env.SECTOR_MODEL_TURN_REVIEW) {
        for (const [name, model] of Object.entries(fittedPlayers)) {
            test(name+" faces the chosen road at once and steps off without a planted turn", async ({page},info) => {
                test.setTimeout(90_000);
                const {canvas, actor} = await enterEquippedSector(page,name,model,"A",64);
                const capture = Boolean(process.env.SECTOR_MODEL_CAPTURE) && info.project.name==="chromium-desktop";
                if (capture) {
                    await writeFile(info.outputPath("framing.json"),JSON.stringify({
                        actor:await actor.boundingBox(), sector:await canvas.boundingBox(), name,
                    }));
                    await page.screencast.start({path:info.outputPath("turns.webm"),size:page.viewportSize()!});
                    await page.waitForTimeout(350);
                }
                await canvas.focus();
                for (const [key, end] of [
                    ["ArrowRight",2], ["ArrowLeft",6], ["ArrowUp",4], ["ArrowDown",0],
                ] as const) {
                    const origin = await canvas.evaluate(el=>[el.dataset.worldX,el.dataset.worldY]);
                    await actor.evaluate(el => {
                        const clips: string[] = [];
                        const observer = new MutationObserver(() => {
                            const clip = el.getAttribute("data-clip")!;
                            if (clips.at(-1) !== clip) clips.push(clip);
                            el.setAttribute("data-step-clips",clips.join(","));
                            if (clip === "idle") observer.disconnect();
                        });
                        el.removeAttribute("data-step-clips");
                        observer.observe(el,{attributes:true,attributeFilter:["data-clip"]});
                    });
                    await page.keyboard.down(key);
                    try {
                        await expect(actor).toHaveAttribute("data-clip",/^start-/,{timeout:10_000});
                        await expect(actor).toHaveAttribute("data-facing",String(end));
                    } finally { await page.keyboard.up(key); }
                    await expect(actor).toHaveAttribute("data-clip","idle",{timeout:10_000});
                    await expect(actor).toHaveAttribute("data-facing",String(end));
                    expect(await actor.getAttribute("data-step-clips")).toMatch(/^start-(walk|run),/);
                    expect(await actor.getAttribute("data-step-clips")).not.toContain("pivot");
                    expect(await canvas.evaluate(el=>[el.dataset.worldX,el.dataset.worldY])).not.toEqual(origin);
                    if (capture) await page.waitForTimeout(300);
                }
                if (capture) await page.screencast.stop();
                await info.attach("equipped-sector-turns",{body:await page.locator(".continuous-world-map").screenshot(),contentType:"image/png"});
            });
        }
    }
    if (process.env.SECTOR_MODEL_DIRECTION_REVIEW) {
        const headings = [
            {key:"ArrowDown", facing:0, dx:0, dy:1}, {key:"ArrowRight", facing:2, dx:1, dy:0},
            {key:"ArrowUp", facing:4, dx:0, dy:-1}, {key:"ArrowLeft", facing:6, dx:-1, dy:0},
        ];
        for (const [name, model] of Object.entries(fittedPlayers)) for (const {key, facing, dx, dy} of headings) {
            test(name+" travels on the sector road with "+key, async ({page},info) => {
                test.setTimeout(90000);
                // This junction has at least four clear tiles on each approach.
                const {canvas, actor} = await enterEquippedSector(page,name,model,"C",64);
                await canvas.focus();
                const position = () => canvas.evaluate(el => ({x:Number(el.dataset.worldX),y:Number(el.dataset.worldY)}));
                await page.keyboard.down(key);
                try {
                    for (const gait of ["walk","run"]) {
                        if (gait === "run") await page.getByRole("button",{name:"Run",exact:true}).click();
                        await expect(actor).toHaveAttribute("data-clip",gait,{timeout:15000});
                        await expect(actor).toHaveAttribute("data-facing",String(facing));
                        await expect(actor).toHaveCSS("background-image",/blob:/);
                        const start = await position();
                        await expect.poll(async () => {
                            const p = await position();
                            return (p.x-start.x)*dx+(p.y-start.y)*dy;
                        }, {intervals:[50],timeout:3000}).toBeGreaterThan(.12);
                        const end = await position();
                        expect(Math.abs((end.x-start.x)*dy-(end.y-start.y)*dx)).toBeLessThan(.01);
                        await info.attach(gait,{body:JSON.stringify({facing,start,end,version:model.version}),contentType:"application/json"});
                    }
                } finally { await page.keyboard.up(key); }
                await expect(actor).toHaveAttribute("data-clip","idle",{timeout:10000});
                await expect(actor).toHaveAttribute("data-facing",String(facing));
            });
        }
    }
    for (const [name,{assetId,version}] of Object.entries(fittedPlayers))
    for (const style of ["A","B","C"] as const) test(name+" fitted foot lands through its authored stop on key release, style "+style, async ({page},info)=>{
        const capture = Boolean(process.env.SECTOR_MODEL_CAPTURE) && info.project.name === 'chromium-desktop';
        test.skip(!assetId || !version,"Mount a completed movement revision");
        test.setTimeout(100_000);
        const folder=resolve(content,"players",assetId!);
        const manifest=JSON.parse(await readFile(resolve(folder,version+".json"),"utf8"));
        test.skip(manifest.format!=="sector-motion-v2","This revision contains steady gaits only");
        const {clips}=JSON.parse(gunzipSync(await readFile(resolve(folder,manifest.styles[style][2]))).toString());
        const account = roster ? name : "AuditNinja";
        const {canvas,actor}=await enterEquippedSector(page,account,{assetId,version},style);
        const label=page.locator("[data-world-self] .sector-self-label");
        await expect(label).toBeVisible();
        await expect(label).toHaveText(account);
        await actor.evaluate(el=>{
            const shown:string[]=[];
            const samples: [string,number,number][]=[];
            const world=document.querySelector<HTMLCanvasElement>(".continuous-world-map > canvas")!;
            const record=()=>{
                const clip=el.getAttribute("data-clip")!;
                if (clip.startsWith("stop-run-")) samples.push([clip,Number(el.getAttribute("data-frame")),Number(world.dataset.worldX)]);
                if (samples.length && clip==="idle") {
                    el.setAttribute("data-release-path",JSON.stringify({samples,end:Number(world.dataset.worldX)}));
                } else requestAnimationFrame(record);
            };
            requestAnimationFrame(record);
            new MutationObserver(()=>{
                const clip=el.getAttribute("data-clip");
                if(clip && shown.at(-1)!==clip){shown.push(clip);el.setAttribute("data-observed",shown.join(","));}
            }).observe(el,{attributes:true,attributeFilter:["data-clip"]});
        });
        await page.getByRole("button",{name:"Run",exact:true}).click();
        await canvas.focus();
        if (capture) {
            await writeFile(info.outputPath("world-crop.json"), JSON.stringify(await canvas.boundingBox()));
            await page.screencast.start({path:info.outputPath("world-contact.webm"),size:page.viewportSize()!});
        }
        await page.keyboard.down("ArrowRight");
        try {
            await expect(actor).toHaveAttribute("data-clip","run",{timeout:15000});
            await expect(actor).toHaveAttribute("data-facing","2");
            if (capture) await page.waitForTimeout(1500);
        } finally { await page.keyboard.up("ArrowRight"); }
        await expect(actor).toHaveAttribute("data-observed",/^(idle,)?start-run,run,stop-run-\d+,idle/,{timeout:8000});
        await expect(actor).toHaveAttribute("data-release-path",/.+/);
        const path=JSON.parse((await actor.getAttribute("data-release-path"))!) as {samples:[string,number,number][];end:number};
        await info.attach("fitted-release-path",{body:JSON.stringify(path),contentType:"application/json"});
        await info.attach("sector-presentation",{body:await canvas.evaluate(el=>
            el.parentElement?.classList.contains("world-light-effects") ? "light effects" : "full effects"
        ),contentType:"text/plain"});
        expect(new Set(path.samples.map(s=>s[1])).size).toBeGreaterThan(2);
        for (const [name,cell,x] of path.samples) {
            const clip=clips[name];
            const remaining=(i:number)=>{
                const t=clip.times[i]/clip.period;
                return clip.travel.at(-1)-clip.travel[i]+clip.correction[0]*(1-t*t*(3-2*t));
            };
            const observed=(path.end-x)*90;
            expect(observed).toBeLessThanOrEqual(remaining(cell)+.05);
            expect(observed).toBeGreaterThanOrEqual(remaining(Math.min(cell+1,clip.count-1))-.05);
        }
        await expect(actor).toHaveCSS("background-image",/blob:/);
        await page.keyboard.down("ArrowRight");
        try {
            await expect(actor).toHaveAttribute("data-clip","run",{timeout:15000});
            await page.keyboard.down("ArrowLeft");
            await page.keyboard.up("ArrowRight");
            await expect(actor).toHaveAttribute("data-facing","6",{timeout:10000});
            await expect(actor).toHaveAttribute("data-clip","run",{timeout:10000});
            await expect(actor).toHaveAttribute("data-observed",/run,stop-run-[0-9]+,idle,start-run,run$/);
        } finally {
            await page.keyboard.up("ArrowRight");
            await page.keyboard.up("ArrowLeft");
        }
        await expect(actor).toHaveAttribute("data-clip","idle",{timeout:10000});
        if (capture) {
            await page.waitForTimeout(400);
            await page.screencast.stop();
        }
        const painted = await actor.screenshot();
        const ground = await actor.screenshot({style:".sector-model-figure { background-image:none !important }"});
        const coverage = await page.evaluate(async ([before, after])=>{
            async function pixels(png:string) {
                const image=new Image(); image.src="data:image/png;base64,"+png; await image.decode();
                const canvas=document.createElement("canvas"); canvas.width=image.width; canvas.height=image.height;
                const ctx=canvas.getContext("2d")!; ctx.drawImage(image,0,0);
                return ctx.getImageData(0,0,canvas.width,canvas.height).data;
            }
            const [a,b]=await Promise.all([pixels(before),pixels(after)]);
            let different=0;
            for (let i=0;i<a.length;i+=4) {
                if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>35) different++;
            }
            return different/(a.length/4);
        },[painted.toString("base64"),ground.toString("base64")] as const);
        expect(coverage).toBeGreaterThan(.08);
        await info.attach("visible-pixel-coverage",{body:String(coverage),contentType:"text/plain"});
        if (capture) {
            await page.waitForTimeout(600);
            await actor.screenshot({path:info.outputPath("equipped-idle.png")});
            await writeFile(info.outputPath("paint.json"),JSON.stringify(await actor.evaluate(async el=>{
                const style=getComputedStyle(el);
                const image=new Image(); image.src=style.backgroundImage.slice(5,-2); await image.decode();
                const c=document.createElement("canvas");c.width=image.width;c.height=image.height;
                const ctx=c.getContext("2d")!;ctx.drawImage(image,0,0);
                const pixels=ctx.getImageData(0,0,c.width,c.height).data;
                return {style:el.getAttribute("style"),client:el.getBoundingClientRect().toJSON(),
                    display:style.display,visibility:style.visibility,sheet:[image.width,image.height],
                    opaque:pixels.filter((n,i)=>i%4===3&&n>127).length};
            })));
        }
        if (info.project.use.hasTouch) await tapWalkThenRun(page,canvas,actor);
        await info.attach("visible-motion",{body:(await actor.getAttribute("data-observed"))!,contentType:"text/plain"});
    });
    test("a nearby player displays its equipped revision, walks and returns to its starter on unequip", async ({page}, info)=>{
        const assetId=process.env.SECTOR_MODEL_TEST_PLAYER_ID, version=process.env.SECTOR_MODEL_TEST_MOTION_VERSION;
        test.skip(!assetId || !version,"Mount a fitted player package");
        const save=uiAuditSave();
        save.currentSector=46; save.currentTile=66;
        save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
        await installUiAuditRuntime(page,save);
        await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{
            obstaclesEnabled:true,playerGaitsEnabled:true,modelArtBase:artBase,
        }}));
        const world=worldPositionModel(), here=world.fallback(46,66);
        const manifest=JSON.parse(await readFile(resolve(content,"players",assetId!,version+".json"),"utf8"));
        let equipped=true, tile=65, atSprintUpdate: number | undefined, walkIssuedAt: number | undefined;
        const peer=page.locator(".continuous-world-peer").filter({hasText:"Test Scout"});
        const markerX=()=>peer.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
        await page.route("**/api/player/world-move**",async route=>{
            if(route.request().method()!=="GET") return route.fallback();
            if (tile===67 && walkIssuedAt===undefined) walkIssuedAt=await page.evaluate(()=>performance.now());
            if (tile===70 && atSprintUpdate===undefined) atSprintUpdate=await markerX();
            return route.fulfill({json:{ok:true,sector:46,tile:66,sequence:0,worldPosition:here,players:[{
                name:"Test Scout",level:5,currentSector:46,tile,worldPosition:world.fallback(46,tile),
                movementSequence:tile,gaitPresentation:{gait:tile===70?"run":"walk",style:"C"},
                character:{avatarImage:"/starter-avatar-two.webp?v=2",...(equipped?{playerModel:{assetId,version}}:{})},
            }]}});
        });
        await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
        await page.goto("/#/worldMap");
        const back=page.getByRole("button",{name:/Return to Sector 46/});
        const canvas=page.locator(".continuous-world-map > canvas");
        await expect(back.or(canvas).first()).toBeVisible({timeout:60000});
        await returnToTerrain(back);
        const sprite=peer.locator(".sector-model-figure");
        await expect(sprite).toHaveAttribute("data-clip","idle",{timeout:15000});
        const start=await markerX();
        const tileWidth=await page.locator(".continuous-world-map").evaluate(el=>el.clientWidth/12);
        await sprite.evaluate(el=>{
            const firstRun=new MutationObserver(()=>{
                if (el.getAttribute("data-gait")!=="run") return;
                if (!el.hasAttribute("data-first-run-x")) {
                    const x=new DOMMatrixReadOnly(getComputedStyle(el.parentElement!).transform).m41;
                    el.setAttribute("data-first-run-x",String(x));
                    el.setAttribute("data-first-run-time",String(performance.now()));
                }
                if (el.getAttribute("data-clip")==="run") {
                    el.setAttribute("data-observed-run","true");
                    firstRun.disconnect();
                }
            });
            firstRun.observe(el,{attributes:true,attributeFilter:["data-gait","data-clip"]});
        });
        const ninjaFacing=page.waitForRequest(request=>request.url().endsWith(manifest.styles.C[2]));
        tile=67;
        await ninjaFacing;
        tile=70;
        await expect(sprite).toHaveAttribute("data-facing","2",{timeout:10000});
        await expect(sprite).toHaveAttribute("data-observed-run","true",{timeout:20000});
        const firstRunX=Number(await sprite.getAttribute("data-first-run-x"));
        expect(atSprintUpdate).toBeDefined();
        const receivedAt=(atSprintUpdate!-start)/tileWidth, ranAt=(firstRunX-start)/tileWidth;
        const elapsedToRunMs=Number(await sprite.getAttribute("data-first-run-time")) - walkIssuedAt!;
        const observation=JSON.stringify({receivedAt,ranAt,elapsedToRunMs,tileWidth,version,assetId});
        const observationPath=info.outputPath("peer-gait.json");
        await writeFile(observationPath,observation);
        await info.attach("observed-peer-gait",{path:observationPath,contentType:"application/json"});
        expect(receivedAt).toBeLessThan(1.8);
        expect(ranAt).toBeGreaterThanOrEqual(1.98);
        expect(ranAt).toBeLessThanOrEqual(5.01);
        await expect(peer).toHaveClass(/has-sector-model/);
        equipped=false;
        await expectStarterArtwork(page,sprite,"starter-two");
        await expect(peer).toHaveClass(/has-sector-model/);
    });
    test("a delayed facing page allows travel with the portrait and restores the fitted sprite", async ({page})=>{
        const assetId=process.env.SECTOR_MODEL_TEST_PLAYER_ID,version=process.env.SECTOR_MODEL_TEST_MOTION_VERSION;
        test.skip(!assetId || !version,"Mount a fitted player package");
        const root=JSON.parse(await readFile(resolve(content,"players",assetId!,version+".json"),"utf8"));
        const save=uiAuditSave(); save.currentSector=46; save.currentTile=66;
        save.character={...save.character,starterCardsClaimed:true,playerModel:{assetId,version},
            wandererCooldowns:quietRoadCooldowns([46])};
        await installUiAuditRuntime(page,save);
        await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{
            obstaclesEnabled:true,playerGaitsEnabled:true,modelArtBase:artBase,
        }}));
        let resume!:()=>void;
        const gate=new Promise<void>(resolve=>{resume=resolve;});
        await page.route("**/"+root.styles.A[2],async route=>{await gate;await route.continue();});
        await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
        await page.goto("/#/worldMap");
        const canvas=page.locator(".continuous-world-map > canvas");
        const back=page.getByRole("button",{name:/Return to Sector 46/});
        await expect(back.or(canvas).first()).toBeVisible({timeout:60000});
        await returnToTerrain(back);
        const marker=page.locator("[data-world-self]"), actor=marker.locator(".sector-model-figure");
        await expect(actor).toHaveAttribute("data-clip","idle",{timeout:15000});
        await canvas.focus();
        const request=page.waitForRequest(url=>url.url().endsWith(root.styles.A[2]));
        await page.keyboard.down("ArrowRight");
        try {
            await request;
            const start=Number(await canvas.getAttribute("data-world-x"));
            await expect(marker).not.toHaveClass(/has-sector-model/,{timeout:3000});
            await expect.poll(async()=>Number(await canvas.getAttribute("data-world-x"))-start,{timeout:3000}).toBeGreaterThan(.04);
            resume();
            await expect(marker).toHaveClass(/has-sector-model/,{timeout:10000});
            await expect(actor).toHaveAttribute("data-facing","2");
        } finally { resume(); await page.keyboard.up("ArrowRight"); }
        await expect(actor).toHaveAttribute("data-clip","idle",{timeout:10000});
    });
    test("the first cardinal sprint steps off from a warmed start page", async ({page}) => {
        test.setTimeout(100_000);
        const model = roster?.Raccoon ?? fittedPlayers[Object.keys(fittedPlayers)[0]];
        test.skip(!model?.assetId || !model?.version || !artBase, "Mount a fitted player package");
        const folder = resolve(content, "players", model.assetId!);
        const manifest = JSON.parse(await readFile(resolve(folder, model.version! + ".json"), "utf8"));
        const east = JSON.parse(gunzipSync(await readFile(resolve(folder, manifest.styles.C[2]))).toString());
        const start = east.pages[east.clips["start-run"].file].file;
        let requests = 0;
        await page.route("**/" + start, route => {
            requests++;
            return route.continue();
        });
        const {canvas, actor} = await enterEquippedSector(page, "AuditNinja", model, "C");
        await expect(actor).toHaveAttribute("data-clip", "idle");
        // Choosing Run at rest warms the sprint starts in place of the walking ones.
        await page.getByRole("button", {name:"Run", exact:true}).click();
        await expect.poll(() => requests, {timeout:15000}).toBe(1);
        await actor.evaluate(el => {
            const shown: string[] = [];
            new MutationObserver(() => {
                const clip = el.getAttribute("data-clip");
                if (clip && shown.at(-1) !== clip) shown.push(clip);
                el.setAttribute("data-first-sprint", shown.join(","));
            }).observe(el, {attributes:true, attributeFilter:["data-clip"]});
        });
        await canvas.focus();
        await page.keyboard.down("ArrowRight");
        try {
            await expect(actor).toHaveAttribute("data-clip", "run", {timeout:15000});
            await expect(actor).toHaveAttribute("data-first-sprint", /^start-run,run$/);
            expect(requests).toBe(1);
        } finally { await page.keyboard.up("ArrowRight"); }
    });
    test("a delayed destination brake still lets a reversal show the sprint start", async ({page}, info) => {
        test.setTimeout(100_000);
        const model = roster?.Raccoon ?? fittedPlayers[Object.keys(fittedPlayers)[0]];
        test.skip(!model?.assetId || !model?.version || !artBase, "Mount a fitted player package");
        const folder = resolve(content, "players", model.assetId!);
        const manifest = JSON.parse(await readFile(resolve(folder, model.version! + ".json"), "utf8"));
        const west = JSON.parse(gunzipSync(await readFile(resolve(folder, manifest.styles.A[6]))).toString());
        const startBrake = Object.values(west.clips as Record<string, {source?:string; entryGait?:string; target?:string; file:string}>)
            .find(clip => (clip.source ?? clip.entryGait) === "start-run" && clip.target === "idle");
        expect(startBrake).toBeDefined();
        const pageFile = west.pages[startBrake!.file].file;
        const {canvas, actor} = await enterEquippedSector(page, "AuditNinja", model, "A");
        await page.getByRole("button", {name:"Run", exact:true}).click();
        await canvas.focus();
        await page.keyboard.down("ArrowRight");
        try {
            await expect(actor).toHaveAttribute("data-clip", "run", {timeout:15000});
            let requests = 0;
            await page.route("**/" + pageFile, async route => {
                requests++;
                // Without a planted turn the reversal only has the brake to load behind.
                await new Promise(resolve => setTimeout(resolve, 250));
                await route.continue();
            });
            await actor.evaluate(el => {
                const clips: string[] = [];
                new MutationObserver(() => {
                    const clip = el.getAttribute("data-clip");
                    if (clip && clips.at(-1) !== clip) clips.push(clip);
                    el.setAttribute("data-turn-clips", clips.join(","));
                }).observe(el, {attributes:true, attributeFilter:["data-clip"]});
            });
            await page.keyboard.down("ArrowLeft");
            await page.keyboard.up("ArrowRight");
            await expect(actor).toHaveAttribute("data-facing", "6", {timeout:15000});
            await expect(actor).toHaveAttribute("data-clip", "run", {timeout:15000});
            expect(requests).toBe(1);
            await expect(actor).toHaveAttribute("data-turn-clips", /idle,start-run,run$/);
            await info.attach("reversal-at-world-scale", {body:await canvas.locator("..").screenshot(), contentType:"image/png"});
        } finally {
            await page.keyboard.up("ArrowRight");
            await page.keyboard.up("ArrowLeft");
        }
        await expect(actor).toHaveAttribute("data-clip", "idle", {timeout:10000});
    });
    test("a cold braking page keeps navigation available and the restored run can visibly stop",async({page},info)=>{
        const assetId=process.env.SECTOR_MODEL_TEST_PLAYER_ID,version=process.env.SECTOR_MODEL_TEST_MOTION_VERSION;
        test.skip(!assetId || !version || !artBase,"Mount a fitted player package");
        const folder=resolve(content,'players',assetId!);
        const manifest=JSON.parse(await readFile(resolve(folder,version+'.json'),'utf8'));
        const bank=JSON.parse(gunzipSync(await readFile(resolve(folder,manifest.styles.A[2]))).toString());
        const brake=bank.pages[bank.clips['stop-run-0'].file].file;
        let resume!:()=>void,requested=false;
        const gate=new Promise<void>(resolve=>{resume=resolve;});
        await page.route('**/'+brake,async route=>{requested=true;await gate;await route.continue();});
        const {canvas,actor}=await enterEquippedSector(page,'AuditNinja',{assetId,version},'A');
        const marker=page.locator('[data-world-self]');
        await actor.evaluate(el=>{
            const clips:string[]=[],frames=new Set<string>();
            const record=()=>{
                const clip=el.getAttribute('data-clip')!;
                if(clips.at(-1)!==clip)clips.push(clip);
                if(clip.startsWith('stop-run-')) {
                    if(!el.parentElement?.classList.contains('has-sector-model'))el.dataset.hiddenBrake='true';
                    frames.add(el.getAttribute('data-frame')!);
                }
                el.dataset.brakeProbe=JSON.stringify({clips,frames:[...frames]});
                requestAnimationFrame(record);
            };
            requestAnimationFrame(record);
        });
        await page.getByRole('button',{name:'Run',exact:true}).click();
        await canvas.focus();await page.keyboard.down('ArrowRight');
        try {
            await expect.poll(()=>requested).toBe(true);
            await expect(marker).not.toHaveClass(/has-sector-model/,{timeout:3000});
            const start=Number(await canvas.getAttribute('data-world-x'));
            await expect.poll(async()=>Number(await canvas.getAttribute('data-world-x'))-start,{timeout:3000}).toBeGreaterThan(.04);
            resume();
            await expect(marker).toHaveClass(/has-sector-model/,{timeout:15000});
            await expect(actor).toHaveAttribute('data-clip','run');
        } finally {resume();await page.keyboard.up('ArrowRight');}
        await expect(actor).toHaveAttribute('data-clip','idle',{timeout:10000});
        const probe=JSON.parse((await actor.getAttribute('data-brake-probe'))!);
        await info.attach('cold-brake-release',{body:JSON.stringify(probe),contentType:'application/json'});
        expect(probe.clips.join(',')).toMatch(/run,stop-run-\d+,idle$/);
        expect(probe.frames.length).toBeGreaterThan(2);
        expect(await actor.getAttribute('data-hidden-brake')).toBeNull();
        await expect(marker).toHaveClass(/has-sector-model/);
    });
    const profiles: Record<string,{assetId:string;version:string;starter?:string}> = {
        ...(roster ?? {upload:{assetId:uploadId,version:process.env.SECTOR_MODEL_TEST_PLAYER_VERSION ?? ""}}),
        ...Object.fromEntries(["starter-one","starter-two"].map(starter =>
            [starter,{assetId:"",version:npcRevisions.get(starter)!,starter}])),
    };
    for (const [name,reference] of Object.entries(profiles)) test(name+" all three running styles survive Settings and a world reload", async ({ page }, info) => {
        test.setTimeout(180_000);
        const {assetId:id, version,starter} = reference;
        test.skip((!id && !starter) || !version || !artBase, "Mount a completed player package");
        if (!starter) expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(version).toMatch(/^[0-9a-f]{64}$/);
        const folder = starter ?? "players/"+id;
        const manifest = JSON.parse(await readFile(resolve(content, folder, version + ".json"), "utf8"));
        if (starter && process.env.SECTOR_MODEL_REQUIRE_COMPLETE_ROSTER === "1")
            expect(manifest.format).toBe("sector-motion-v2");
        test.skip(!!starter && manifest.format !== "sector-motion-v2", "The replacement starter is still rendering");
        const fitted = manifest.format === "sector-motion-v2";
        const styles = ["A","B","C"] as const;
        const east = await Promise.all(styles.map(async style => {
            if (fitted) {
                const shard = await readFile(resolve(content,folder,manifest.styles[style][2]));
                const {pages,clips} = JSON.parse(gunzipSync(shard).toString());
                return {style,run:String(pages[clips.run.file].file),walk:String(pages[clips.walk.file].file)};
            }
            const bank = manifest.banks[2];
            return {style,run:String((style==="A" ? bank.run : bank["run"+style]).url),walk:String(bank.walk.url)};
        }));
        expect(new Set(east.map(clips=>clips.run)).size).toBe(3);
        const reported = new Set<string>();
        page.on("request", request => {
            if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/player/world-move") return;
            const gait = request.postDataJSON()?.gaitPresentation;
            if (gait) reported.add(gait.style + "/" + gait.gait);
        });
        const received = new Set<string>();
        page.on("response",response=>{if (response.ok()) received.add(response.url());});
        const modelBase = artBase+"/"+folder+"/";
        const save = uiAuditSave();
        const sector = Number(process.env.SECTOR_MODEL_REVIEW_SECTOR ?? 46);
        save.currentSector = sector;
        save.currentTile = Number(process.env.SECTOR_MODEL_REVIEW_TILE ?? 66);
        const account = roster ? name : "AuditNinja";
        save.character = { ...save.character, name:account, starterCardsClaimed: true,
            ...(starter ? {playerModel:undefined, avatarImage:"/starter-avatar-"+(starter==="starter-two"?"two":"one")+".webp?v=2"}
                : {playerModel: {assetId:id, version}}),
            wandererCooldowns: quietRoadCooldowns([sector]) };
        const runtime = await installUiAuditRuntime(page, save, false, account);
        await page.route("**/api/world/sector-layout", route => route.fulfill({json: {
            obstaclesEnabled:true, playerGaitsEnabled:true, modelArtBase:artBase
        }}));
        await page.addInitScript(owner => localStorage.setItem("legacyRumors.seen.v1:"+owner.toLowerCase(), "[10,20,30,40,45]"), account);
        for (const {style,run:runFile,walk:walkFile} of east) {
            await page.goto("/?entry=preferences#/settings");
            const setting = page.getByLabel("Running style");
            await setting.selectOption(style);
            await page.reload();
            await expect(setting).toHaveValue(style);
            if (process.env.SECTOR_MODEL_CAPTURE === "1")
                runtime.placeOnWorldTile(sector, Number(save.currentTile));
            await page.goto("/?entry=sector#/worldMap");
            expect(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
            const back = page.getByRole("button", {name:new RegExp("Return to Sector "+sector+"\\b")});
            const canvas = page.locator(".continuous-world-map > canvas");
            await expect(back.or(canvas).first()).toBeVisible({timeout:60_000});
            await returnToTerrain(back);
            const figure = page.locator("[data-world-self] .sector-model-figure");
            if (starter) await expectStarterArtwork(page,figure,starter);
            else await expect(figure).toHaveCSS("background-image", fitted ? /blob:/ : new RegExp("/players/"+id+"/"));
            await expect(page.locator("[data-world-self]")).toHaveClass(/has-sector-model/);
            const run = page.getByRole("button", {name:"Run", exact:true});
            await run.click();
            await canvas.focus();
            await page.keyboard.down("ArrowRight");
            try {
                if (fitted) {
                    await expect(figure).toHaveAttribute("data-clip","run");
                    await expect(figure).toHaveAttribute("data-facing","2");
                    expect(received.has(modelBase+runFile)).toBe(true);
                } else await expect(figure).toHaveCSS("background-image", new RegExp(runFile));
                await expect(figure).toHaveAttribute("data-gait", "run");
                await expect.poll(() => reported.has(style + "/run")).toBe(true);
                const map = page.locator(".continuous-world-map");
                if (process.env.SECTOR_MODEL_CAPTURE === "1") {
                    await writeFile(info.outputPath("capture-"+style+".json"),JSON.stringify(await map.boundingBox()));
                    await page.screencast.start({path:info.outputPath("player-style-"+style+".webm"),size:page.viewportSize()!});
                    try {
                        await page.waitForTimeout(2100);
                        await expect(figure).toHaveAttribute("data-gait","run");
                    } finally { await page.screencast.stop(); }
                }
                await map.screenshot({path:info.outputPath("player-style-"+style+".png")});
                if (process.env.SECTOR_MODEL_TEST_ROSTER) {
                    await page.keyboard.up("ArrowRight");
                    await expect(figure).toHaveAttribute("data-gait","idle");
                    await run.click();
                    await canvas.focus();
                    await page.keyboard.down("ArrowRight");
                    await expect(figure).toHaveAttribute("data-gait","walk");
                    if (fitted) {
                        await expect(figure).toHaveAttribute("data-clip","walk");
                        expect(received.has(modelBase+walkFile)).toBe(true);
                    } else await expect(figure).toHaveCSS("background-image", new RegExp(walkFile));
                }
            } finally { await page.keyboard.up("ArrowRight"); }
        }
    });
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test.describe(reducedMotion, () => {
        test.use({ contextOptions: { reducedMotion } });
        test("player starter follows walk and run controls across the painted map", async ({ page }, info) => {
            test.setTimeout(100_000);
            test.skip(!artBase, "Mount the fitted starter sheets to test player travel");
            const save = uiAuditSave();
            const reduced = reducedMotion === "reduce";
            const second = info.project.use.hasTouch ? !reduced : reduced;
            save.currentSector = 46;
            save.currentTile = 66;
            save.character = { ...save.character, starterCardsClaimed: true,
                avatarImage: second ? "/starter-avatar-two.webp?v=2" : "/api/img?id=avatar:custom",
                wandererCooldowns: quietRoadCooldowns([46]) };
            await installUiAuditRuntime(page, save);
            await page.route("**/api/world/sector-layout", route => route.fulfill({ json: {
                obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: artBase } }));
            await page.addInitScript(() => localStorage.setItem("legacyRumors.seen.v1:auditninja", "[10,20,30,40,45]"));
            await page.goto("/#/worldMap");
            const back = page.getByRole("button", { name: /Return to Sector 46/ });
            const canvas = page.locator(".continuous-world-map > canvas");
            await expect(back.or(canvas).first()).toBeVisible({ timeout: 60_000 });
            await returnToTerrain(back);
            const layer = page.locator('[data-world-self] .sector-model-figure');
            await expect(layer).toBeVisible();
            await expectStarterArtwork(page,layer,"starter-"+(second ? "two" : "one"));
            const kind="starter-"+(second ? "two" : "one");
            const header=JSON.parse(await readFile(resolve(content,kind,npcRevisions.get(kind)+".json"),"utf8"));
            const {clips}=JSON.parse(gunzipSync(await readFile(resolve(content,kind,header.styles.A[2]))).toString());
            function authoredReleaseLimit(gait: "walk" | "run") {
                const cycle=clips[gait];
                const stops=Object.values(clips).filter((clip: unknown) => {
                    const c=clip as {source?:string;entryGait?:string;target?:string};
                    return (c.source ?? c.entryGait)===gait && c.target==="idle";
                }) as {entry:number;travel:number[];correction?:number[]}[];
                const contacts=stops.map(clip=>({clip,time:cycle.times?.[clip.entry] ?? cycle.period*clip.entry/cycle.count}))
                    .sort((a,b)=>a.time-b.time);
                expect(contacts.length).toBeGreaterThan(0);
                return Math.max(...contacts.map(({clip,time},i)=>{
                    const previous=i ? contacts[i-1].time : contacts.at(-1)!.time-cycle.period;
                    return (time-previous)*cycle.speed+clip.travel.at(-1)!-clip.travel[0]+(clip.correction?.[0] ?? 0);
                }));
            }
            const toggle = page.getByRole("button", {name:"Run",exact:true});
            const mapBounds = await canvas.boundingBox(), buttonBounds = await toggle.boundingBox();
            expect(mapBounds && buttonBounds && buttonBounds.x >= mapBounds.x && buttonBounds.y >= mapBounds.y
                && buttonBounds.y + buttonBounds.height <= mapBounds.y + mapBounds.height).toBeTruthy();
            const sample = () => canvas.evaluate(async el => {
                const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
                const start = await frame();
                let now = start;
                const samples: number[][] = [];
                let lastX = Number(el.dataset.worldX), lastY = Number(el.dataset.worldY), distance = 0;
                do {
                    const next = await frame();
                    const x = Number(el.dataset.worldX), y = Number(el.dataset.worldY);
                    const step = Math.hypot(x-lastX, y-lastY);
                    samples.push([next-now,step]); distance += step; now=next; lastX=x; lastY=y;
                } while (now-start < 1200);
                return {rate:distance*90*1000/(now-start),samples};
            });
            const rates: number[] = [];
            const releases: number[] = [];
            for (const running of [false,true]) {
                if (running) {
                    if (info.project.use.hasTouch) await toggle.tap();
                    else await toggle.click();
                }
                await expect(toggle).toHaveAttribute("aria-pressed",String(running));
                await canvas.focus();
                const startX = Number(await canvas.getAttribute("data-world-x"));
                await page.keyboard.down("ArrowRight");
                try {
                    await expect.poll(async () => Number(await canvas.getAttribute("data-world-x")) - startX).toBeGreaterThan(.04);
                    await expect(layer).toHaveAttribute("data-gait",reduced ? "idle" : running ? "run" : "walk");
                    const {rate,samples} = await sample();
                    await writeFile(info.outputPath((running ? "run" : "walk")+"-samples.json"),JSON.stringify(samples));
                    rates.push(rate);
                    const target = running ? 120 : 31;
                    expect(rate).toBeGreaterThan(target * .65);
                    expect(rate).toBeLessThan(target * 1.10);
                    await page.screenshot({path: info.outputPath((running ? "run" : "walk")+".png")});
                    if (process.env.SECTOR_MODEL_CAPTURE && !reduced && info.project.name.startsWith("chromium")) {
                        const view = page.viewportSize()!;
                        const name = running ? "run" : "walk";
                        const rect = await canvas.boundingBox();
                        await writeFile(info.outputPath(name+"-bounds.json"),JSON.stringify(rect));
                        await page.screencast.start({path:info.outputPath(name+".webm"),size:view});
                        try { await page.waitForTimeout(2100); } finally { await page.screencast.stop(); }
                        await expect(page.locator('[aria-modal=true],dialog[open]')).toHaveCount(0);
                        await expect(layer).toHaveAttribute("data-gait",name);
                    }
                } finally {
                    await canvas.evaluate(el => window.addEventListener("keyup", () => {
                        el.dataset.releaseX = el.dataset.worldX;
                        const actor=document.querySelector<HTMLElement>('[data-world-self] .sector-model-figure')!;
                        const samples:[string,number,number][]=[];
                        delete actor.dataset.starterReleasePath;
                        function record() {
                            const clip=actor.dataset.clip!;
                            if(clip.startsWith("stop-")) samples.push([clip,Number(actor.dataset.frame),Number(el.dataset.worldX)]);
                            if(samples.length && clip==="idle") actor.dataset.starterReleasePath=JSON.stringify({samples,end:Number(el.dataset.worldX)});
                            else requestAnimationFrame(record);
                        }
                        if(!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(record);
                    }, {once:true, capture:true}));
                    await page.keyboard.up("ArrowRight");
                }
                const released = Number(await canvas.getAttribute("data-release-x"));
                await expect(layer).toHaveAttribute("data-gait","idle");
                // Reduced motion already shows idle while travelling. Sample ground travel independently.
                await expect(page.locator("[data-world-self]")).not.toHaveClass(/is-walking/);
                // A road node can briefly clear is-walking during an authored brake.
                if (!reduced) await expect(layer).toHaveAttribute("data-clip","idle");
                const stopped = Number(await canvas.getAttribute("data-world-x"));
                const glide = (stopped-released)*90;
                expect(glide).toBeGreaterThanOrEqual(0);
                // Portrait/reduced-motion braking uses the compact fallback. A fitted
                // sprite reaches its next authored contact before settling into idle.
                const releaseLimit=reduced ? (running ? 8.034 : 3.224) : authoredReleaseLimit(running ? "run" : "walk");
                expect(glide).toBeLessThanOrEqual(releaseLimit + .1);
                if(!reduced) {
                    await expect(layer).toHaveAttribute("data-starter-release-path",/.+/);
                    const path=JSON.parse((await layer.getAttribute("data-starter-release-path"))!) as {samples:[string,number,number][];end:number};
                    expect(stopped).toBe(path.end);
                    expect(new Set(path.samples.map(s=>s[1])).size).toBeGreaterThan(2);
                    for(const [name,cell,x] of path.samples) {
                        const clip=clips[name];
                        const remaining=(i:number)=>{
                            const t=clip.times[i]/clip.period;
                            return clip.travel.at(-1)-clip.travel[i]+clip.correction[0]*(1-t*t*(3-2*t));
                        };
                        const observed=(path.end-x)*90;
                        expect(observed).toBeLessThanOrEqual(remaining(cell)+.05);
                        expect(observed).toBeGreaterThanOrEqual(remaining(Math.min(cell+1,clip.count-1))-.05);
                    }
                    await info.attach((running ? "run" : "walk")+"-authored-release",{body:JSON.stringify({limit:releaseLimit,glide,...path}),contentType:"application/json"});
                }
                releases.push(glide);
                await page.waitForTimeout(180);
                expect(Number(await canvas.getAttribute("data-world-x"))).toBe(stopped);
            }
            const report = info.outputPath("ground-speed.json");
            await writeFile(report, JSON.stringify({walk:rates[0],run:rates[1],releasePx:releases}));
            await info.attach("ground-speed", {path:report,contentType:"application/json"});
            if (info.project.name === "chromium-mobile" && !reduced) {
                const touch = await page.context().newCDPSession(page);
                const touchClips:Record<string,MotionClip>=JSON.parse(gunzipSync(await readFile(resolve(content,kind,header.styles.A[6]))).toString()).clips;
                for (const ending of ["touchEnd","touchCancel"] as const) {
                    const {x,y} = await canvas.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        for (const fy of [.3,.7,.4,.6]) for (const fx of [.65,.35,.5]) {
                            const x = rect.left + rect.width*fx, y = rect.top + rect.height*fy;
                            if (document.elementFromPoint(x,y) === el) return {x,y};
                        }
                        throw new Error("No exposed map surface for the drag");
                    });
                    const start = Number(await canvas.getAttribute("data-world-x"));
                    await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
                    await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-40,y}]});
                    await expect.poll(async () => start-Number(await canvas.getAttribute("data-world-x"))).toBeGreaterThan(.08);
                    await expect(layer).toHaveAttribute("data-gait","run");
                    await expect(layer).toHaveAttribute("data-facing","6");
                    await expect(page.locator('[data-world-self]')).toHaveClass(/has-sector-model/);
                    await canvas.evaluate((el,type) => {
                        delete el.dataset.releaseX;delete el.dataset.touchReleasePose;delete el.dataset.touchReleasePath;
                        el.addEventListener(type, () => {
                            const actor=document.querySelector<HTMLElement>('[data-world-self] .sector-model-figure')!;
                            el.dataset.releaseX=el.dataset.worldX;
                            el.dataset.touchReleasePose=JSON.stringify({type,clip:actor.dataset.clip,cell:Number(actor.dataset.frame)});
                            const samples:[string,number,number][]=[];
                            function record(){
                                const clip=actor.dataset.clip!;
                                if(clip.startsWith('stop-'))samples.push([clip,Number(actor.dataset.frame),Number(el.dataset.worldX)]);
                                if(samples.length && clip==='idle')el.dataset.touchReleasePath=JSON.stringify({samples,end:Number(el.dataset.worldX)});
                                else requestAnimationFrame(record);
                            }
                            requestAnimationFrame(record);
                        }, {once:true,capture:true});
                    }, ending === "touchEnd" ? "pointerup" : "pointercancel");
                    await touch.send("Input.dispatchTouchEvent",{type:ending,touchPoints:[]});
                    await expect(canvas).toHaveAttribute("data-touch-release-pose",/.+/);
                    const phase=JSON.parse((await canvas.getAttribute("data-touch-release-pose"))!);
                    expect(phase.type).toBe(ending==='touchEnd'?'pointerup':'pointercancel');
                    const at = Number(await canvas.getAttribute("data-release-x"));
                    await expect(layer).toHaveAttribute("data-gait","idle");
                    await expect(layer).toHaveAttribute("data-clip","idle");
                    await expect(page.locator('[data-world-self]')).not.toHaveClass(/is-walking/);
                    await expect(canvas).toHaveAttribute("data-touch-release-path",/.+/);
                    const stopped = Number(await canvas.getAttribute("data-world-x"));
                    const distance = (at-stopped)*90;
                    const path=JSON.parse((await canvas.getAttribute("data-touch-release-path"))!) as {samples:[string,number,number][];end:number};
                    await info.attach(ending+'-authored-release',{body:JSON.stringify({phase,distance,...path}),contentType:'application/json'});
                    expect(distance).toBeGreaterThanOrEqual(0);
                    expect(distance).toBeLessThanOrEqual(releaseTravelBound(touchClips,phase.clip,phase.cell,-1)+.1);
                    expect(new Set(path.samples.map(s=>s[1])).size).toBeGreaterThan(2);
                    for(const [name,cell,x] of path.samples){
                        const clip=touchClips[name];
                        const remaining=(i:number)=>{
                            const t=clip.times![i]/clip.period;
                            return clip.travel!.at(-1)!-clip.travel![i]-(clip.correction?.[0]??0)*(1-t*t*(3-2*t));
                        };
                        const observed=(x-path.end)*90;
                        expect(observed).toBeLessThanOrEqual(remaining(cell)+.05);
                        expect(observed).toBeGreaterThanOrEqual(remaining(Math.min(cell+1,clip.count-1))-.05);
                    }
                    await page.waitForTimeout(180);
                    expect(Number(await canvas.getAttribute("data-world-x"))).toBe(stopped);
                }
                await touch.detach();
            }
        });
        test("a stationary spirit animates its idle in the map renderer and respects motion preferences", async ({page},info)=>{
            test.skip(!artBase || !npcRevisions.has("bell-wraith"), "Mount the completed spirit candidate");
            const save=uiAuditSave();save.currentSector=46;save.currentTile=66;
            save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
            await installUiAuditRuntime(page,save);
            await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:artBase}}));
            await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
            await installPilotResidents(page,46,Date.now,"clear",["bell-wraith"]);
            const errors:string[]=[],received=new Set<string>();
            page.on("pageerror",error=>errors.push(error.message));
            page.on("response",response=>{if(response.ok())received.add(response.url());});
            await page.goto("/#/worldMap");
            const back=page.getByRole("button",{name:/Return to Sector 46/});
            await expect.poll(async()=>await back.isVisible()||await page.locator(".continuous-world-map").isVisible(),{timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            const actor=page.locator('[data-life-resident="pilot-bell-wraith"]');
            await expect(actor).toHaveClass(/has-sector-model/,{timeout:20_000});
            const figure=actor.locator(".sector-model-figure");
            await expect(figure).toHaveAttribute("data-clip","idle");
            expect(received.has(artBase+"/bell-wraith/"+npcRevisions.get("bell-wraith")+".json")).toBe(true);
            if(reducedMotion==="reduce"){
                await expect(figure).toHaveAttribute("data-frame","0");
                await page.waitForTimeout(300);
                await expect(figure).toHaveAttribute("data-frame","0");
            }else{
                const frame=await figure.getAttribute("data-frame");
                await expect.poll(()=>figure.getAttribute("data-frame")).not.toBe(frame);
            }
            await page.screenshot({path:info.outputPath("spirit-idle-in-sector.png")});
            await page.emulateMedia({reducedMotion:"reduce"});
            await expect(figure).toHaveAttribute("data-frame","0");
            await page.waitForTimeout(300);
            await expect(figure).toHaveAttribute("data-frame","0");
            await page.emulateMedia({reducedMotion:"no-preference"});
            await expect.poll(()=>figure.getAttribute("data-frame")).not.toBe("0");
            expect(errors).toEqual([]);
        });
        test("articulated creatures use their portrait-bound models on the map",async({page},info)=>{
            test.setTimeout(90_000);
            test.skip(!artBase||!npcRevisions.has('riftspawn')||!npcRevisions.has('ember-fox'),'Mount both completed creature candidates');
            const save=uiAuditSave();save.currentSector=46;save.currentTile=70;
            save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
            await installUiAuditRuntime(page,save);
            await page.route('**/api/world/sector-layout',route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:artBase}}));
            await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]'));
            await installPilotResidents(page,46,Date.now,'clear',['riftspawn','beast']);
            const errors:string[]=[],received=new Set<string>();
            page.on('pageerror',error=>errors.push(error.message));
            page.on('response',response=>{if(response.ok())received.add(response.url());});
            await page.goto('/#/worldMap');
            const back=page.getByRole('button',{name:/Return to Sector 46/});
            await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            for(const [kind,slug] of [['riftspawn','riftspawn'],['beast','ember-fox']]){
                const actor=page.locator('[data-life-resident="pilot-'+kind+'"]');
                await expect(actor).toHaveClass(/has-sector-model/,{timeout:30_000});
                const figure=actor.locator('.sector-model-figure');
                if(reducedMotion==='reduce')await expect(figure).toHaveAttribute('data-frame','0');
                else{
                    const frame=await figure.getAttribute('data-frame');
                    await expect.poll(()=>figure.getAttribute('data-frame')).not.toBe(frame);
                    const seen=new Set<string>();
                    await expect.poll(async()=>{
                        seen.add(await figure.getAttribute('data-facing')??'');
                        return [...seen].some(n=>n==='0'||n==='4')&&[...seen].some(n=>n==='2'||n==='6');
                    },{timeout:14_000}).toBe(true);
                }
                expect(received.has(artBase+'/'+slug+'/'+npcRevisions.get(slug)+'.json')).toBe(true);
            }
            await page.screenshot({path:info.outputPath('articulated-creatures-in-sector.png')});
            expect(errors).toEqual([]);
        });
        test("weighted hounds use their portrait-bound models on the map",async({page},info)=>{
            test.setTimeout(90_000);
            test.skip(!artBase||!npcRevisions.has('raiju-storm-hound')||!npcRevisions.has('hollow-hound'),'Mount both completed weighted hound candidates');
            const save=uiAuditSave();save.currentSector=46;save.currentTile=70;
            save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
            const runtime=await installUiAuditRuntime(page,save);
            await page.route('**/api/world/sector-layout',route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:artBase}}));
            await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]'));
            await installPilotResidents(page,46,Date.now,'clear',['raiju-storm-hound','hollow-hound']);
            const errors:string[]=[],received=new Set<string>();
            page.on('pageerror',error=>errors.push(error.message));
            page.on('response',response=>{if(response.ok())received.add(response.url());});
            await expectUiAuditBoot(page,runtime,'worldMap');
            const back=page.getByRole('button',{name:/Return to Sector 46/});
            await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false',{timeout:30_000});
            for(const [kind,slug] of [['raiju-storm-hound','raiju-storm-hound'],['hollow-hound','hollow-hound']]){
                const actor=page.locator('[data-life-resident="pilot-'+kind+'"]');
                await expect(actor).toHaveClass(/has-sector-model/,{timeout:30_000});
                const figure=actor.locator('.sector-model-figure');
                if(reducedMotion==='reduce')await expect(figure).toHaveAttribute('data-frame','0');
                else{
                    const frame=await figure.getAttribute('data-frame');
                    await expect.poll(()=>figure.getAttribute('data-frame')).not.toBe(frame);
                    const seen=new Set<string>();
                    await expect.poll(async()=>{
                        seen.add(await figure.getAttribute('data-facing')??'');
                        return [...seen].some(n=>n==='0'||n==='4')&&[...seen].some(n=>n==='2'||n==='6');
                    },{timeout:14_000}).toBe(true);
                }
                expect(received.has(artBase+'/'+slug+'/'+npcRevisions.get(slug)+'.json')).toBe(true);
            }
            await page.screenshot({path:info.outputPath('weighted-hound-in-sector.png')});
            expect(errors).toEqual([]);
        });
        test("new Merchant uses its pinned portrait model, recovers its registry, animates and talks", async ({page}, info) => {
            test.skip(!artBase || !npcRevisions.has("merchant"), "Mount the completed Merchant package");
            let registryAvailable = reducedMotion === "reduce";
            let registryFailures = 0;
            await page.route("**/assets/sector-model-pins-*.json", route => {
                if(registryAvailable) return route.fallback();
                registryFailures++;
                return route.fulfill({status:503,body:"Temporarily unavailable"});
            });
            const save = uiAuditSave();
            save.currentSector = 46;
            save.currentTile = 66;
            save.character = {...save.character, starterCardsClaimed:true, wandererCooldowns:quietRoadCooldowns([46])};
            await installUiAuditRuntime(page, save);
            await page.route("**/api/world/sector-layout", route => route.fulfill({json:{
                obstaclesEnabled:true, modelArtBase:artBase,
            }}));
            await page.addInitScript(() => localStorage.setItem("legacyRumors.seen.v1:auditninja", "[10,20,30,40,45]"));
            await installPilotResidents(page, 46, Date.now, "clear", ["merchant"]);
            const received = new Set<string>();
            const errors: string[] = [];
            page.on("pageerror", error => errors.push(error.message));
            page.on("response", response => {if(response.ok()) received.add(response.url());});
            await page.goto("/#/worldMap");
            const back = page.getByRole("button", {name:/Return to Sector 46/});
            await expect.poll(async () => await back.isVisible() || await page.locator(".continuous-world-map").isVisible(), {timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            const actor = page.locator('[data-life-resident="pilot-merchant"]');
            if(reducedMotion === "no-preference") {
                await expect(actor.locator(".sector-avatar-body img")).toBeVisible();
                await expect.poll(() => registryFailures).toBeGreaterThan(0);
                registryAvailable = true;
            }
            await expect(actor).toHaveClass(/has-sector-model/, {timeout:15_000});
            const layer = actor.locator(".sector-model-figure");
            await expect(layer).toBeVisible();
            await expect(layer).toHaveCSS("background-image", /blob:/);
            expect(received.has(artBase+"/merchant/"+npcRevisions.get("merchant")+".json")).toBe(true);
            if(reducedMotion === "reduce") await expect(layer).toHaveAttribute("data-gait", "idle");
            else {
                await expect(layer).toHaveAttribute("data-gait", "walk");
                const frame = await layer.getAttribute("data-frame");
                await expect.poll(() => layer.getAttribute("data-frame")).not.toBe(frame);
            }
            await page.screenshot({path:info.outputPath("merchant-in-sector.png")});
            await actor.focus();
            await page.keyboard.press("Enter");
            await expect(page.getByRole("dialog").filter({hasText:/Merchant/})).toBeVisible();
            expect(errors).toEqual([]);
        });
        test("sector pilot NPCs use their fitted models and retain their talk action", async ({ page }, info) => {
            test.setTimeout(90_000); // Functional boot, two model decodes and talk; not a loading-speed benchmark.
            const sector = 46;
            const save = uiAuditSave();
            save.currentSector = sector;
            save.currentTile = 70; // Let the patrols move rather than stop beside the player.
            save.character = { ...save.character, starterCardsClaimed: true, wandererCooldowns: quietRoadCooldowns([sector]) };
            const runtime = await installUiAuditRuntime(page, save);
            await page.route("**/api/world/sector-layout", route =>
                route.fulfill({ json: { obstaclesEnabled: true, modelArtBase: artBase || null } }));
            await page.addInitScript(() => localStorage.setItem("legacyRumors.seen.v1:auditninja", "[10,20,30,40,45]"));
            const errors: string[] = [];
            page.on("pageerror", e => errors.push(e.message));
            const resources: { url: string, bytes: number }[] = [];
            page.on("response", response => {
                if (artBase && response.ok() && response.url().startsWith(artBase + "/")) {
                    resources.push({ url: response.url(), bytes: Number(response.headers()["content-length"] ?? 0) });
                }
            });
            if (artBase && info.project.name === "chromium-mobile") {
                const session = await page.context().newCDPSession(page);
                await session.send("Network.enable");
                await session.send("Network.emulateNetworkConditionsByRule", { matchedNetworkConditions: [{
                    urlPattern:artBase+"/*", latency:150, downloadThroughput:125_000,
                    uploadThroughput:62_500, connectionType:"cellular3g",
                }] });
            }
            await installPilotResidents(page, sector);
            await expectUiAuditBoot(page, runtime, "worldMap");
            const back = page.getByRole("button",{ name: /Return to Sector 46/ });
            await expect.poll(async () => await back.isVisible() || await page.locator(".continuous-world-map").isVisible(),
                {timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            if (!artBase) {
                // A clean checkout has the portrait and the version pin. Published art
                // can be mounted with SECTOR_MODEL_TEST_CONTENT or a public test URL.
                const fallback = page.locator('[data-life-resident="pilot-medic"]');
                await expect(fallback.locator(".sector-avatar-body img")).toBeVisible();
                await expect(fallback.locator(".sector-model-figure")).toHaveCount(0);
                test.skip(true, "Mount the published art pack to certify painted movement and talk");
                return;
            }
            await expect(page.locator(".continuous-world-map")).toHaveAttribute("aria-busy", "false", {timeout:30_000});
            for (const kind of ["patrol","medic"]) {
                const figure = page.locator('[data-life-resident="pilot-'+kind+'"]');
                await expect(figure).toHaveClass(/has-sector-model/);
                const layer = figure.locator(".sector-model-figure");
                await expect(layer).toBeVisible();
                await expect(layer).toHaveCSS("background-image", new RegExp("blob:|/sector-models/"+kind+"/"));
                const manifestUrl = artBase + "/" + kind + "/" + npcRevisions.get(kind) + ".json";
                expect(resources.some(item => item.url === manifestUrl)).toBe(true);
                expect(resources.some(item => item.url.startsWith(artBase+"/"+kind+"/") && /\.(webp|264)$/.test(item.url))).toBe(true);
                if (reducedMotion === "reduce") await expect(layer).toHaveAttribute("data-gait","idle");
                else {
                    await expect(layer).toHaveAttribute("data-gait","walk");
                    const phase = await layer.getAttribute("data-frame");
                    await expect.poll(() => layer.getAttribute("data-frame")).not.toBe(phase);
                }
            }
            const screenshot = info.outputPath("sector-pilots.png");
            expect(new Set(resources.map(item => item.url)).size).toBeLessThan(50);
            const report = info.outputPath("sprite-requests.json");
            await writeFile(report, JSON.stringify(resources, null, 2));
            await info.attach("sprite-requests", { path: report, contentType: "application/json" });
            await page.screenshot({ path: screenshot });
            await info.attach("sector-pilots", { path: screenshot, contentType: "image/png" });
            await page.locator('[data-life-resident="pilot-medic"]').focus();
            await page.keyboard.press("Enter");
            await expect(page.getByRole("dialog").filter({hasText:/Medic/})).toBeVisible();
            expect(errors).toEqual([]);
        });
        test("NPC portraits remain usable when world models are unavailable", async ({page},info) => {
            // A separate cold boot avoids a decoded-model cache, background-tab
            // suspension and transport teardown during an artificial reload.
            const save=uiAuditSave();save.currentSector=46;save.currentTile=66;
            save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
            await installUiAuditRuntime(page,save);
            await page.route("**/api/world/sector-layout",route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:null}}));
            await page.addInitScript(()=>localStorage.setItem("legacyRumors.seen.v1:auditninja","[10,20,30,40,45]"));
            await installPilotResidents(page,46,Date.now,"clear",["patrol","medic","merchant"]);
            const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
            await page.goto("/#/worldMap");
            const back=page.getByRole("button",{name:/Return to Sector 46/});
            await expect.poll(async()=>await back.isVisible()||await page.locator(".continuous-world-map").isVisible(),{timeout:60_000}).toBe(true);
            await returnToTerrain(back);
            for(const kind of ["patrol","medic","merchant"]){
                const figure=page.locator('[data-life-resident="pilot-'+kind+'"]');
                await expect(figure.locator(".sector-avatar-body img")).toBeVisible();
                await expect(figure.locator(".sector-model-figure")).toHaveCount(0);
            }
            await page.screenshot({path:info.outputPath("portrait-fallback-boot.png")});
            await page.locator('[data-life-resident="pilot-patrol"]').focus();await page.keyboard.press("Enter");
            await expect(page.getByRole("dialog").filter({hasText:/Patrol/})).toBeVisible();
            expect(errors).toEqual([]);
        });
    });
}

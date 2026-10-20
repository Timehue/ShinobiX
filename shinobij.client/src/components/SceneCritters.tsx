/*
 * SceneCritters — characterful ambient wildlife on a single <canvas>, the layer
 * that makes a biome read as a place that's *alive* rather than a still picture:
 * birds gliding over the snow, butterflies wandering the meadow, dragonflies +
 * water ripples on the lagoon, ravens over the ash, and fireflies/spirit-wisps
 * after dark. The cast is chosen by biome AND the real time of day (see
 * lib/day-cycle.ts) so dusk trades butterflies for fireflies.
 *
 * Same discipline as <SceneAmbience>: one absolutely-positioned, pointer-events:
 * none canvas sized to its parent, a single rAF loop that pauses when the tab is
 * hidden, and a single static frame under prefers-reduced-motion. Pure canvas
 * shapes for flyers, plus one small painted atlas at six reviewed wildlife
 * sites. Decoration never touches game state, balance, or saves.
 *
 *   <div style={{ position:'relative' }}>
 *     ...backdrop...
 *     <SceneCritters biome={biome} />
 *   </div>
 */
import { useContext, useEffect, useRef } from "react";
import { WorldPlayerPosition } from '../lib/world-player-position';
import { sectorFloorLayout } from '../lib/sector-floor-layout';
import { sectorRegionKey } from '../../../shared/sector-geo';
import type { Biome } from "../types/core";
import { skyNow, SKY_REFRESH_MS } from "../lib/day-cycle";
import { isLowEndMobile } from "../lib/device-tier";
import { isCoveredByCombat, subscribeCombatCover } from "../lib/combat-cover";
import { lifeActorPosition } from '../../../shared/sector-life-motion';
import type { WildlifeDiscovery } from '../../../shared/sector-life-discovery';
import {serverNow} from '../lib/server-clock';
import {GROUND_HABITATS,GroundWildlifeSession,advanceGroundAnimal,type GroundAnimal} from '../lib/sector-ground-wildlife';
import {drawGroundWildlife,loadGroundWildlifeAtlas} from '../lib/sector-ground-wildlife-render';
import {displayedSectorFloor,subscribeDisplayedSectorFloor} from '../lib/sector-displayed-floor';
import {moonwellLampsLit,lampMothPoint,harborGullPoint,HARBOR_GULL_ROUTE,LOCAL_FAUNA_LIMITS} from '../lib/sector-local-fauna';

const groundVisits=new GroundWildlifeSession();

type Behavior = "glide" | "flutter" | "glow" | "dart" | "ripple";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];
const wrap=(value:number,margin:number,span:number)=>value < -margin ? span+margin : value > span+margin ? -margin : value;

interface Recipe {
    behavior: Behavior;
    /** base count at density 1 on a ~1000px-wide canvas */
    count: number;
    colors: string[];
    size: [number, number];
    /** vertical band of the scene it lives in, as fractions of height */
    band: [number, number];
    speed?: [number, number];
    glow?: boolean;
}

// The full cast. Biomes pick a subset for day vs night below.
const RECIPES: Record<string, Recipe> = {
    bird:      { behavior: "glide",  count: 3, colors: ["rgba(39,49,63,0.76)", "rgba(57,67,79,0.7)", "rgba(88,105,124,0.66)"], size: [8, 13],  band: [0.06, 0.42], speed: [38, 74] },
    gull:      { behavior: "glide", count: 5, colors: ['#d9ded8','#cdd4cf'],size:[8,11],band:[.6,.9]},
    'lamp-moth':{behavior:'flutter',count:8,colors:['#c6bda9','#b8b2a4'],size:[2.5,3.5],band:[.7,.85]},
    raven:     { behavior: "glide",  count: 3, colors: ["#0f1217", "#1a1f29"],            size: [8, 13],  band: [0.08, 0.46], speed: [46, 86] },
    butterfly: { behavior: "flutter",count: 5, colors: ["#f9a8d4", "#fcd34d", "#a5f3fc", "#c084fc", "#fb923c"], size: [4, 7], band: [0.44, 0.9] },
    moth:      { behavior: "flutter",count: 4, colors: ["#fde68a", "#fca5a5", "#fdba74"], size: [3.5, 6], band: [0.4, 0.9] },
    dragonfly: { behavior: "dart",   count: 4, colors: ["#67e8f9", "#5eead4", "#a7f3d0"], size: [5, 8],   band: [0.58, 0.9], speed: [70, 130] },
    firefly:   { behavior: "glow",   count: 24, colors: ["#fff7a8", "#eaff9b", "#fde68a"], size: [1.4, 3], band: [0.22, 0.95], glow: true },
    spirit:    { behavior: "glow",   count: 8, colors: ["#bfe0ff", "#d8c8ff", "#cfe8ff"],  size: [2, 4],   band: [0.3, 0.95], glow: true },
    ripple:    { behavior: "ripple", count: 3, colors: ["rgba(255,255,255,0.5)"],          size: [10, 26], band: [0.7, 0.94] },
};

// Biome → which critters are out, split by time of day. Kept tasteful: a couple
// of flyers + the signature critter, not a swarm.
function castFor(biome: Biome, night: boolean, mode: "scene" | "world"): string[] {
    if (mode === "world") return night ? ["bird"] : ["bird", "bird"]; // a high, sparse flock only
    if (night) {
        switch (biome) {
            case "snow":    return ["spirit"];
            case "volcano": return ["raven", "moth"];
            case "shadow":  return ["firefly", "spirit"];
            default:        return ["firefly"];
        }
    }
    switch (biome) {
        case "snow":    return ["bird"];
        case "volcano": return ["raven"];
        case "shadow": // cherry-blossom temple
        case "forest":  return ["butterfly", "bird"];
        case "central": return ["bird", "dragonfly", "ripple"]; // lagoon/meadow life
        default:        return ["bird", "butterfly"];
    }
}

interface C {
    slot:number;
    kind: string;
    behavior: Behavior;
    x: number; y: number;
    vx: number; vy: number;
    baseY: number; ampY: number;
    size: number; color: string;
    phase: number; flap: number; flapSpeed: number;
    blink: number; blinkSpeed: number; alpha: number;
    dir: number;              // facing for flyers
    life: number; maxLife: number; // ripples
    wanderA: number; wanderB: number;
}

export function SceneCritters({
    biome,
    density = 1,
    mode = "scene",
    className,
    sector,
    discovery,
}: {
    biome: Biome;
    /** scales critter counts (0–1.5). Lower behind menus / on cramped panels. */
    density?: number;
    /** "world" = a sparse high flock only (overworld); "scene" = full biome cast. */
    mode?: "scene" | "world";
    className?: string;
    /** A grounded sector canvas follows the camera and reacts to the real player position. */
    sector?: number;
    discovery?: WildlifeDiscovery;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const worldPlayer = useContext(WorldPlayerPosition);
    const discoveryRef=useRef(discovery);
    useEffect(()=>{discoveryRef.current=discovery;},[discovery]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // Weak phones: ~60% fewer critters, no firefly/spirit glow (shadowBlur is the
        // expensive part), and a 1x backing store (skip the HiDPI fill). Cosmetic —
        // the biome still has a little life.
        const lowEnd = isLowEndMobile();
        const effDensity = density * (lowEnd ? 0.4 : 1);
        const maxDpr = lowEnd ? 1 : 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        let crits: C[] = [];
        let guide:C|undefined,cancelled=0;
        let raf = 0, last = 0, running = true;
        // The named "night" phase (20:00–05:00 in-world) is the same window the
        // server's night gate uses (shared/world-phase, pinned by its test), so
        // night fauna and night-only ninjas and pets arrive and leave together.
        // The continuous sky.night factor crossed 0.5 about an hour earlier.
        let night = skyNow().phase === "night";
        const parent = canvas.parentElement;
        const groundSupported=sector!==undefined&&mode==='scene'&&GROUND_HABITATS.some(site=>site.sector===sector);
        let ground:GroundAnimal|undefined,groundImage:HTMLImageElement|undefined,groundLoading=false,disposed=false,nextGroundCheck=0;
        const groundPlayer={x:0,y:0};
        function refreshGround(now:number){
            if(!groundSupported||sector===undefined)return;
            ground=groundVisits.at(sector,now,night);
            if(!ground){if(canvas!.dataset.groundAction!=='absent')canvas!.dataset.groundAction='absent';delete canvas!.dataset.groundSpecies;}
            if(ground&&!groundImage&&!groundLoading){
                groundLoading=true;
                void loadGroundWildlifeAtlas().then(image=>{if(disposed)return;groundImage=image;if(reduce&&!document.hidden&&!isCoveredByCombat())drawStatic();});
            }
        }
        function renderGround(now:number,dt:number){
            if(!ground||!groundImage)return;
            const player=worldPlayer?.current;
            let nearby:typeof groundPlayer|undefined;
            if(player&&player.sector===sector){groundPlayer.x=(player.col+.5)/12;groundPlayer.y=(player.row+.5)/12;nearby=groundPlayer;}
            if(reduce){
                if(nearby&&Math.hypot(nearby.x-ground.x,nearby.y-ground.y)<1.6/12)ground.hidden=true;
            }else advanceGroundAnimal(ground,dt,nearby);
            const action=ground.hidden?'hidden':ground.escaping?'escaping':'idle';
            if(canvas!.dataset.groundAction!==action)canvas!.dataset.groundAction=action;
            if(canvas!.dataset.groundSpecies!==ground.sighting.habitat.species)canvas!.dataset.groundSpecies=ground.sighting.habitat.species;
            drawGroundWildlife(ctx!,groundImage,ground,now,w,h,reduce);
        }
        function drawStatic(){
            ctx!.clearRect(0,0,w,h);renderGround(serverNow(),0);for(const p of crits)render(p);
        }

        function makeOne(kind: string,slot=0): C {
            const r = RECIPES[kind];
            const band: [number, number] = r.band;
            const baseY = rand(band[0], band[1]) * h;
            const dir = Math.random() < 0.5 ? -1 : 1;
            const sp = r.speed ? rand(r.speed[0], r.speed[1]) : 0;
            return {
                kind,slot, behavior: r.behavior,
                x: rand(0, w), y: baseY,
                vx: dir * sp, vy: 0,
                baseY, ampY: rand(6, 22),
                size: rand(r.size[0], r.size[1])*(kind==='gull'||kind==='lamp-moth'?w/1024:1),
                color: pick(r.colors),
                phase: rand(0, Math.PI * 2),
                flap: rand(0, Math.PI * 2),
                flapSpeed: r.behavior === "glide" ? rand(6, 10) : r.behavior === "dart" ? rand(22, 34) : rand(7, 12),
                blink: rand(0, Math.PI * 2),
                blinkSpeed: rand(1.4, 3.2),
                alpha: rand(0.5, 0.95),
                dir,
                life: rand(0, 1), maxLife: rand(2.2, 4),
                wanderA: rand(0.3, 0.8), wanderB: rand(0.5, 1.3),
            };
        }

        function spawn() {
            crits = [];
            if (!w || !h) return;
            const water = sector === undefined ? undefined : sectorFloorLayout(sector)?.hydrology?.waterTiles;
            const region = sector === undefined ? undefined : sectorRegionKey(sector);
            const coastal=sector===2&&!night&&mode==='scene'&&HARBOR_GULL_ROUTE.every(tile=>water?.includes(tile));
            const moonwell=sector===23&&night&&mode==='scene';
            const regionalCast = coastal?['gull']:moonwell?['firefly',...(moonwellLampsLit(sector,night,displayedSectorFloor(sector))?['lamp-moth']:[])]:!night && region === 'midlands' ? ['bird','butterfly']
                : region === 'castle' ? ['bird'] : region === 'festival' && !night ? ['bird','butterfly'] : castFor(biome, night, mode);
            const cast = regionalCast.filter(kind => kind !== 'ripple' || sector === undefined || Boolean(water?.length));
            const widthScale = Math.max(0.5, w / 1000);
            for (const kind of cast) {
                const r = RECIPES[kind];
                const n = Math.min(kind==='gull'?LOCAL_FAUNA_LIMITS.gulls:kind==='lamp-moth'?LOCAL_FAUNA_LIMITS.lampMoths:Infinity,Math.max(1, Math.round(r.count * widthScale * effDensity)));
                for (let i = 0; i < n; i++) {
                    const critter = makeOne(kind,i);
                    if(kind==='gull'){const p=harborGullPoint(i,critter.phase,{x:0,y:0});critter.x=p.x*w;critter.y=p.y*h;}
                    if(kind==='lamp-moth'){const p=lampMothPoint(i,critter.phase);critter.x=p.x*w;critter.y=p.y*h;}
                    if (kind === 'ripple' && water?.length) {
                        const tile = water[i % water.length];
                        critter.x = (tile % 12 + .5) / 12 * w;
                        critter.y = critter.baseY = (Math.floor(tile / 12) + .5) / 12 * h;
                    }
                    crits.push(critter);
                }
            }
            guide=crits.find(p=>p.behavior==='glide'&&p.kind!=='gull');
            canvas!.dataset.localFauna=coastal?'harbor-gulls':moonwell&&crits.some(p=>p.kind==='lamp-moth')?'lamp-moths':'';
            canvas!.dataset.localFaunaCount=String(crits.filter(p=>p.kind==='gull'||p.kind==='lamp-moth').length);
            refreshGround(serverNow());
            if(reduce)drawStatic();
        }

        function resize() {
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            w = rect.width; h = rect.height;
            dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
            canvas!.width = Math.max(1, Math.round(w * dpr));
            canvas!.height = Math.max(1, Math.round(h * dpr));
            canvas!.style.width = w + "px";
            canvas!.style.height = h + "px";
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            spawn();
        }

        // ── draw helpers ─────────────────────────────────────────────────
        function drawBird(p: C) {
            const a = (Math.sin(p.flap) + 1) / 2;           // 0..1 wingbeat
            const wing = p.size;
            const lift = wing * (0.14 + a * 0.44);
            const body = p.kind==='gull'?p.size*.23:Math.max(2, p.size * 0.23);
            ctx!.save();
            if(p.kind==='gull'){
                ctx!.fillStyle='rgba(25,37,40,.14)';ctx!.beginPath();ctx!.ellipse(p.x,p.y+4*w/1024,p.size*.65,p.size*.18,0,0,Math.PI*2);ctx!.fill();ctx!.globalAlpha=.78;
            }
            ctx!.translate(p.x, p.y);
            ctx!.scale(p.dir, 1);
            ctx!.fillStyle = p.color;
            ctx!.strokeStyle = p.color;
            ctx!.lineWidth = Math.max(p.kind==='gull'?.3:.8, p.size * 0.08);
            ctx!.lineJoin = "round";
            ctx!.lineCap = "round";

            for(const side of [-1,1]) {
                ctx!.beginPath();
                ctx!.moveTo(side * body * 0.2, -body * 0.2);
                ctx!.quadraticCurveTo(side * wing * 0.55, -lift, side * wing, lift * 0.22);
                ctx!.quadraticCurveTo(side * wing * 0.5, -lift * 0.32, side * body * 0.25, body * 0.08);
                ctx!.closePath();ctx!.fill();
            }

            ctx!.beginPath();
            ctx!.ellipse(0, 0, body * 1.18, body * 0.46, 0, 0, Math.PI * 2);
            ctx!.fill();

            ctx!.beginPath();
            ctx!.arc(body * 1.12, -body * 0.1, Math.max(p.kind==='gull'?.3:.9, body * 0.34), 0, Math.PI * 2);
            ctx!.fill();

            ctx!.beginPath();
            ctx!.moveTo(-body * 1.0, -body * 0.24);
            ctx!.lineTo(-body * 1.8, -body * 0.62);
            ctx!.lineTo(-body * 1.55, 0);
            ctx!.lineTo(-body * 1.8, body * 0.62);
            ctx!.lineTo(-body * 1.0, body * 0.24);
            ctx!.closePath();
            ctx!.fill();

            ctx!.beginPath();
            ctx!.moveTo(-wing * 0.75, lift * 0.18);
            ctx!.quadraticCurveTo(0, -lift * 0.45, wing * 0.75, lift * 0.18);
            ctx!.stroke();
            if(p.kind==='gull'){
                ctx!.strokeStyle='#626b68';ctx!.lineWidth=Math.max(.25,p.size*.07);
                for(const side of [-1,1]){ctx!.beginPath();ctx!.moveTo(side*wing*.78,lift*.05);ctx!.lineTo(side*wing,lift*.22);ctx!.stroke();}
            }
            ctx!.restore();
        }

        function drawButterfly(p: C) {
            const flap = Math.abs(Math.sin(p.flap));        // 0..1 wings open/closed
            const ww = p.size * (0.32 + 0.68 * flap);
            const tilt = Math.atan2(p.vy, p.vx || p.dir);
            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(tilt);
            ctx!.fillStyle = p.color;
            ctx!.globalAlpha = p.alpha;
            // four wings
            for (const sx of [-1, 1]) {
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.5, -p.size * 0.35, ww, p.size * 0.7, 0, 0, Math.PI * 2);
                ctx!.fill();
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.45, p.size * 0.4, ww * 0.8, p.size * 0.55, 0, 0, Math.PI * 2);
                ctx!.fill();
            }
            // body
            ctx!.fillStyle = "rgba(20,20,28,0.85)";
            ctx!.beginPath();
            ctx!.ellipse(0, 0, p.size * 0.16, p.size * 0.95, 0, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.restore();
        }

        function drawDragonfly(p: C) {
            const flap = Math.abs(Math.sin(p.flap));
            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(p.dir < 0 ? Math.PI : 0);
            ctx!.globalAlpha = p.alpha * 0.85;
            // gossamer wings
            ctx!.fillStyle = "rgba(255,255,255,0.45)";
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.2, sy * p.size * (0.18 + flap * 0.25), p.size * 0.7, p.size * 0.16, sx * 0.5, 0, Math.PI * 2);
                ctx!.fill();
            }
            // slender body
            ctx!.strokeStyle = p.color;
            ctx!.lineWidth = Math.max(1, p.size * 0.22);
            ctx!.beginPath();
            ctx!.moveTo(-p.size * 0.9, 0);
            ctx!.lineTo(p.size * 1.1, 0);
            ctx!.stroke();
            ctx!.restore();
        }

        function drawGlow(p: C) {
            // pulse + occasional blink-off (fireflies)
            const pulse = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(p.blink));
            const blinkOff = p.kind === "firefly" ? Math.max(0, Math.sin(p.blink * 0.37)) : 1;
            ctx!.globalAlpha = p.alpha * pulse * (0.35 + 0.65 * blinkOff);
            ctx!.fillStyle = p.color;
            ctx!.shadowBlur = lowEnd ? 0 : p.size * 4;
            ctx!.shadowColor = p.color;
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.shadowBlur = 0;
        }

        function drawRipple(p: C) {
            const t = p.life / p.maxLife;        // 0..1
            const radius = p.size * (0.3 + t);
            ctx!.globalAlpha = (1 - t) * 0.5;
            ctx!.strokeStyle = "rgba(220,240,255,0.8)";
            ctx!.lineWidth = 1.2;
            ctx!.beginPath();
            ctx!.ellipse(p.x, p.y, radius, radius * 0.42, 0, 0, Math.PI * 2);
            ctx!.stroke();
        }

        function step(p: C, dt: number) {
            p.flap += p.flapSpeed * dt;
            p.blink += p.blinkSpeed * dt;
            p.phase += dt;
            if(p.kind==='lamp-moth'){
                const point=lampMothPoint(p.slot,p.phase);p.vx=(point.x*w-p.x)/Math.max(dt,.001);p.vy=(point.y*h-p.y)/Math.max(dt,.001);
                p.x=point.x*w;p.y=point.y*h;return;
            }
            if(p.kind==='gull'){
                const player=worldPlayer?.current;
                const dx=p.x/w-(player?.col??-100)/12-.5/12,dy=p.y/h-(player?.row??-100)/12-.5/12,distance=Math.hypot(dx,dy);
                const near=player?.sector===sector&&distance<LOCAL_FAUNA_LIMITS.gullNotice&&distance>.0001;
                p.vx=Math.max(-.009,Math.min(.009,p.vx*(1-dt*2)+(near?dx/distance*dt*.03:0)));
                p.vy=Math.max(-.009,Math.min(.009,p.vy*(1-dt*2)+(near?dy/distance*dt*.03:0)));
                const point=harborGullPoint(p.slot,p.phase,{x:p.vx,y:p.vy});p.dir=point.x*w<p.x?-1:1;p.x=point.x*w;p.y=point.y*h;
                if(near)canvas!.dataset.wildlifeReaction=String(Number(canvas!.dataset.wildlifeReaction??0)+1);return;
            }
            const interest=p===guide?discoveryRef.current:undefined,now=interest?serverNow():0;
            if(interest&&sector!==undefined&&now>=interest.motion.start&&now<interest.until&&cancelled!==interest.motion.start) {
                const pose=lifeActorPosition(sector,interest,now),dx=(pose.col+.5+(pose.walking?0:Math.cos(now/650)*.22))/12*w-p.x,dy=(pose.row+.5+(pose.walking?0:Math.sin(now/650)*.22))/12*h-p.y;
                const amount=Math.min(1,dt*w/12*2.4/Math.max(.01,Math.hypot(dx,dy)));
                p.x+=dx*amount;p.y+=dy*amount;p.baseY=p.y;p.phase=0;
                p.dir=dx<0?-1:1;p.vx=p.dir*Math.abs(p.vx);
            } else switch (p.behavior) {
                case "glide": {
                    p.x += p.vx * dt;
                    p.y = p.baseY + Math.sin(p.phase * 0.8) * p.ampY;
                    if (p.vx > 0 && p.x - p.size > w + 40 || p.vx < 0 && p.x + p.size < -40) {
                        p.x=p.vx>0?-40:w+40;p.baseY=rand(RECIPES[p.kind].band[0],RECIPES[p.kind].band[1])*h;
                    }
                    break;
                }
                case "dart": {
                    // quick darts with pauses — erratic dragonfly motion
                    const burst = Math.sin(p.phase * 1.7) > 0.2 ? 1 : 0.12;
                    p.x += p.vx * burst * dt;
                    p.y = p.baseY + Math.sin(p.phase * 2.1) * p.ampY * 0.8;
                    if(p.x>w+30||p.x< -30){p.dir=p.x>0?1:-1;p.x=p.dir>0?-30:w+30;p.vx=p.dir*Math.abs(p.vx);p.baseY=rand(RECIPES[p.kind].band[0],RECIPES[p.kind].band[1])*h;}
                    break;
                }
                case "flutter": {
                    // meander via two summed sines → soft random-walk
                    p.vx = Math.cos(p.phase * p.wanderA) * 26 + Math.cos(p.phase * 1.7) * 10;
                    p.vy = Math.sin(p.phase * p.wanderB) * 18 + Math.sin(p.phase * 2.3) * 8;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.dir = p.vx < 0 ? -1 : 1;
                    p.x=wrap(p.x,30,w);p.y=Math.max(h*.4,Math.min(h*.95,p.y));
                    break;
                }
                case "glow": {
                    p.vx = Math.cos(p.phase * 0.6 + p.flap) * 12;
                    p.vy = Math.sin(p.phase * 0.5) * 9;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.x=wrap(p.x,20,w);p.y=Math.max(h*.18,Math.min(h*.97,p.y));
                    break;
                }
                case "ripple": {
                    p.life += dt;
                    if (p.life >= p.maxLife) { p.life = 0; if (sector === undefined) { p.x = rand(0.1, 0.9) * w; p.baseY = rand(0.7, 0.94) * h; p.y = p.baseY; } p.maxLife = rand(2.2, 4.2); p.size = rand(10, 28); }
                    break;
                }
            }
            const player = worldPlayer?.current;
            if (sector !== undefined && player?.sector === sector && p.behavior !== 'ripple' && p.behavior !== 'glow') {
                const dx = p.x - (player.col + .5) / 12 * w, dy = p.y - (player.row + .5) / 12 * h;
                const distance = Math.hypot(dx, dy), notice = w / 12 * 1.6;
                if (distance < notice && distance > .01) {
                    if(interest)cancelled=interest.motion.start;
                    const speed = w / 12 * 1.8;
                    p.x += dx / distance * speed * dt;
                    p.y += dy / distance * speed * dt;
                    p.baseY += dy / distance * speed * dt;
                    p.dir = dx < 0 ? -1 : 1;
                    if (p.behavior === 'glide' || p.behavior === 'dart') p.vx = p.dir * Math.abs(p.vx);
                    canvas!.dataset.wildlifeReaction = String(Number(canvas!.dataset.wildlifeReaction ?? 0) + 1);
                }
            }
        }

        function render(p: C) {
            ctx!.globalAlpha = 1;
            switch (p.kind) {
                case "butterfly":
                case 'lamp-moth':
                case "moth": drawButterfly(p); break;
                case "dragonfly": drawDragonfly(p); break;
                case "firefly":
                case "spirit": drawGlow(p); break;
                case "ripple": drawRipple(p); break;
                default: drawBird(p); break;
            }
            ctx!.globalAlpha = 1;
        }

        function frame(t: number) {
            if (!running) return;
            // ~30fps is plenty for ambient wildlife and halves the canvas re-presents that
            // the compositor repeats for everything layered over it; `last` stays put on a
            // skipped frame, so `dt` spans the gap and flight speed is unchanged.
            if (last && t - last < 28) { raf = requestAnimationFrame(frame); return; }
            const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
            last = t;
            ctx!.clearRect(0, 0, w, h);
            if(groundSupported){const now=serverNow();if(t>=nextGroundCheck){refreshGround(now);nextGroundCheck=t+1000;}renderGround(now,dt);}
            for (const p of crits) { step(p, dt); render(p); }
            raf = requestAnimationFrame(frame);
        }

        const ro = new ResizeObserver(resize);
        if (parent) ro.observe(parent);
        resize();
        const stopFloor=sector===23?subscribeDisplayedSectorFloor(sector,()=>{if(!disposed&&canvas.isConnected&&!document.hidden&&!isCoveredByCombat())spawn();}):()=>{};

        if (reduce) {
            running = false;
        } else {
            raf = requestAnimationFrame(frame);
        }

        // Re-evaluate the day/night cast on the shared sky cadence (dusk swaps the
        // cast). The old fixed 2-minute poll was fine on a 24-hour day and is not
        // on a 2-hour one: it would leave butterflies out for minutes after dark.
        // Nothing respawns unless the flag actually flips, so the tighter tick is
        // free.
        const dayTimer = window.setInterval(() => {
            if(document.hidden||isCoveredByCombat())return;
            const n = skyNow().phase === "night";
            if (n !== night) { night = n; spawn(); }
            else if(reduce&&groundSupported){refreshGround(serverNow());drawStatic();}
        }, SKY_REFRESH_MS);

        // Draw only while the tab is visible AND no body-portaled fight is
        // covering the page (lib/combat-cover); either signal re-evaluates it.
        let covered = isCoveredByCombat();
        if (covered && running) { running = false; cancelAnimationFrame(raf); }
        function sync() {
            if(!document.hidden&&!covered){
                const currentNight=skyNow().phase==='night';
                if(currentNight!==night||sector===23){night=currentNight;spawn();}
            }
            if (reduce) {if(!document.hidden&&!covered){refreshGround(serverNow());drawStatic();}return;}
            const shouldRun = !document.hidden && !covered;
            if (!shouldRun) { if (running) { running = false; cancelAnimationFrame(raf); } }
            else if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
        }
        function onVis() { sync(); }
        sync();
        document.addEventListener("visibilitychange", onVis);
        const unsubscribeCover = subscribeCombatCover(() => { covered = isCoveredByCombat(); sync(); });

        return () => {
            disposed=true;
            stopFloor();
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.clearInterval(dayTimer);
            document.removeEventListener("visibilitychange", onVis);
            unsubscribeCover();
        };
    }, [biome, density, mode, sector, worldPlayer]);

    return (
        <div className={"scene-critters" + (className ? " " + className : "")} aria-hidden="true">
            <canvas ref={canvasRef} className="scene-critters-canvas" />
        </div>
    );
}

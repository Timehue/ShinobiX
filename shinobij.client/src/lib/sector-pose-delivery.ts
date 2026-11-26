import type { MotionClip } from '../../../shared/sector-model-motion';
import type { SprintStyle } from './player-model';
import { readSectorModelObject, sectorFetchPriority } from './sector-model-object';

export type Page = { file: string; cell: number[]; frames: number; cols: number };
export type SpriteClip = MotionClip & {endView?: number; reverse?: boolean; cell: number[]; cols: number; origins: number[][]; url: string; firstCell?: number; page?: Page};
export type SpriteView = Record<string,SpriteClip>;
export type PackedMotion = {format: 'sector-motion-v2'; mapWidth: number; styles: Record<SprintStyle,string[]>};
export type SheetImage = {image: HTMLImageElement; release: () => void};

// A facing index is small and immutable (named by its hash), and figures only read it. Sharing one
// read means a travel warm-up, a crowd of the same NPC and a remount do not each download, hash and
// gunzip it again. Least-recently-used, with a failed read dropped so the next ask retries.
const FACING_CACHE_LIMIT = 128;
const facings = new Map<string, Promise<SpriteView>>();
export function loadFacing(folder: string, name: string, priority: DecodePriority = 1): Promise<SpriteView> {
    const key = folder + name;
    const existing = facings.get(key);
    if (existing) { facings.delete(key); facings.set(key, existing); return existing; }
    const request = readFacing(folder, name, priority)
        .catch(error => { if (facings.get(key) === request) facings.delete(key); throw error; });
    facings.set(key, request);
    while (facings.size > FACING_CACHE_LIMIT) facings.delete(facings.keys().next().value!);
    return request;
}

async function readFacing(folder: string, name: string, priority: DecodePriority): Promise<SpriteView> {
    const data = await readSectorModelObject(folder,name,'.gz',128*1024,sectorFetchPriority(priority));
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    const {clips,pages} = await new Response(stream).json() as {
        clips: Record<string,MotionClip & {origins:number[][];file:string;firstCell?:number}>; pages:Record<string,Page>
    };
    const view: SpriteView = {};
    for (const [id,clip] of Object.entries(clips)) {
        const page=pages[clip.file];
        if (!page || !Number.isSafeInteger(clip.count) || clip.count<1 || clip.origins.length!==clip.count ||
            (clip.firstCell ?? 0)+clip.count>page.frames || !(clip.period>0)) throw Error('Invalid fitted pose');
        view[id]={...clip,cell:page.cell,cols:page.cols,url:folder+page.file,page};
    }
    return view;
}

/**
 * Decode order. A worker decodes one page at a time, so the order is the
 * difference between your own figure appearing first and appearing after every
 * other figure in a crowded sector.
 *   0 — the player's own figure
 *   1 — every other figure's pages
 *   2 — warm-up: pages decoded ahead of a move that has not happened yet
 * A page already waiting is raised when a more urgent figure asks for it. A
 * decode that has started always finishes; nothing is interrupted.
 */
export type DecodePriority = 0 | 1 | 2;
export type DecodeTicket = {priority: DecodePriority};
type DecodeJob = {ticket: DecodeTicket; start: (lane: number) => Promise<unknown>};

/**
 * Decode lanes that each run one job at a time. Lane `i` starts only jobs at
 * priority `lanes[i]` or more urgent, and always the most urgent of those
 * (oldest first among equals). The default is one lane that takes everything.
 */
export function createDecodeQueue(lanes: readonly DecodePriority[] = [2]) {
    const waiting: DecodeJob[] = [];
    const busy = lanes.map(() => false);
    function pump() {
        for (let lane = 0; lane < lanes.length; lane++) {
            if (busy[lane]) continue;
            let next = -1;
            for (let i = 0; i < waiting.length; i++) {
                const priority = waiting[i]!.ticket.priority;
                if (priority <= lanes[lane]! && (next < 0 || priority < waiting[next]!.ticket.priority)) next = i;
            }
            if (next < 0) continue;
            const [job] = waiting.splice(next, 1);
            busy[lane] = true;
            void job!.start(lane).catch(() => {}).finally(() => { busy[lane] = false; pump(); });
        }
    }
    return {
        run<T>(ticket: DecodeTicket, work: (lane: number) => Promise<T>): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                waiting.push({ticket, start: lane => work(lane).then(resolve, error => { reject(error); })});
                pump();
            });
        },
        /** A waiting ticket was raised: a lane it may now use can start it. */
        pump,
        get waiting() { return waiting.length; },
    };
}

// The player's own figure has a worker of its own. With one shared worker, its
// next page (a start, a turn, the walk loop) waited behind whatever crowd page
// was decoding, and on a phone that wait outlasts the 400 ms the figure holds
// before it moves on a frozen frame: the player glided. The second worker takes
// everything, the player's pages included when the first is busy.
const workers: Array<Worker | undefined> = [];
const decodes = createDecodeQueue([0, 2]);
const spawnDecoder = () => new Worker(new URL('./sector-pose.worker.ts',import.meta.url),{type:'module'});
function unpack(bytes: ArrayBuffer,page: Page,ticket: DecodeTicket) {
    return decodes.run(ticket, lane => new Promise<Blob | ImageData>((resolve,reject)=>{
        // Both start together, so neither lane's first page also waits on its decoder starting up.
        if (!workers[lane]) for (let i = 0; i < 2; i++) workers[i] ??= spawnDecoder();
        const worker = workers[lane]!;
        const reset = () => {worker.terminate();if (workers[lane]===worker) workers[lane]=undefined;reject(Error('Pose decoder unavailable'));};
        const timer = setTimeout(reset,12000);
        worker.onerror=()=>{clearTimeout(timer);reset();};
        worker.onmessage=({data})=>{
            clearTimeout(timer);
            if(data.error) reject(Error(data.error));
            else if(data.blob instanceof Blob) resolve(data.blob);
            else resolve(new ImageData(data.pixels,data.width,data.height));
        };
        worker.postMessage({...page,bytes,encodePng:true},[bytes]);
    }));
}

async function encodePixels(pixels: ImageData): Promise<Blob> {
    const canvas=document.createElement('canvas');
    canvas.width=pixels.width; canvas.height=pixels.height;
    canvas.getContext('2d')!.putImageData(pixels,0,0);
    try {
        return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(data=>data?resolve(data):reject(Error('Empty pose sheet'))));
    } finally {
        canvas.width=canvas.height=0;
    }
}

async function decodeImage(folder: string,page: Page,ticket: DecodeTicket): Promise<SheetImage> {
    const bytes=await readSectorModelObject(folder,page.file,'.264',512*1024,sectorFetchPriority(ticket.priority));
    const decoded=await unpack(bytes,page,ticket);
    const blob=decoded instanceof Blob ? decoded : await encodePixels(decoded);
    const url=URL.createObjectURL(blob), image=new Image();
    try {
        image.src=url;
        await image.decode();
        return {image,release:()=>URL.revokeObjectURL(url)};
    } catch(error) {URL.revokeObjectURL(url);throw error;}
}

type CachedPage = {bytes:number;users:number;pending:Promise<SheetImage>;ready?:SheetImage;ticket:DecodeTicket};
const decodedPages = new Map<string,CachedPage>();
let reservedBytes = 0;
function trim() {
    for (const [key,entry] of decodedPages) {
        if (reservedBytes<=12*1024**2) break;
        if (entry.users || !entry.ready) continue;
        entry.ready.release();
        reservedBytes-=entry.bytes;
        decodedPages.delete(key);
    }
}

/** Figures share a decoded page. The displayed sheet stays valid while unused pages can be evicted. */
export async function loadPackedImage(folder:string,page:Page,priority:DecodePriority=1):Promise<SheetImage> {
    const key=folder+page.file;
    let entry=decodedPages.get(key);
    if (entry) {
        decodedPages.delete(key);
        // Another figure (or a warm-up) asked first: a more urgent ask moves it up.
        if (priority<entry.ticket.priority) {entry.ticket.priority=priority;decodes.pump();}
    } else {
        const bytes=page.cell[0]*page.cols*page.cell[1]*Math.ceil(page.frames/page.cols)*4;
        const ticket:DecodeTicket={priority};
        const pending=decodeImage(folder,page,ticket);
        entry={bytes,users:0,pending,ticket};
        reservedBytes+=bytes;
        const fresh=entry;
        void pending.then(ready=>{fresh.ready=ready;trim();},()=>{
            decodedPages.delete(key);reservedBytes-=bytes;
        });
    }
    decodedPages.set(key,entry);
    entry.users++;
    trim();
    const result=await entry.pending;
    return {image:result.image,release(){entry.users--;trim();}};
}

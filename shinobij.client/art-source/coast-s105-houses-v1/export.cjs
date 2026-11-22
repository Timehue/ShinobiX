// Run from the project with its pinned sharp dependency. Outputs are relative to the supplied folder.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const masters = path.join(__dirname, 'masters');
const source = id => path.join(masters, id + '.png');
const coast = 'coast-map/saltstair-landing/';
const base = path.resolve(__dirname, '../../public/coast-map/s105.webp');
// The HUD fits the complete image into a 36 px phone frame. Keep a bust crop around each face.
const portraits = {
    'unmoored-patrol': { span: .64, centre: .497 },
    'unmoored-courier': { span: .69, centre: .485 },
    'crown-guard': { span: .69, centre: .51 },
    'runner-lookout': { span: .66, centre: .505 },
};

async function bust(id) {
    const original = sharp(source(id));
    const { width } = await original.metadata();
    const framing = portraits[id];
    const cropWidth = Math.round(width * framing.span);
    return original.extract({
        left: Math.round(width * framing.centre - cropWidth / 2), top: 0,
        width: cropWidth, height: Math.round(cropWidth * 1.5),
    }).png().toBuffer();
}

async function sectorFloor() {
    const original = await sharp(base).removeAlpha().raw().toBuffer();
    const clearing = await sharp(source('s105-houses-floor')).resize(1024, 1024).removeAlpha().raw().toBuffer();
    // Blend only the settlement meadow and four brush clearings. All four original road mouths retain their pixels before encoding.
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        const offset = 3 * (y * 1024 + x);
        const blend = Math.max(0, Math.min(1, (x - 109) / 32, (642 - x) / 34, (y - 493) / 35, (857 - y) / 42));
        if (blend > 0) for (let c = 0; c < 3; c++) original[offset + c] += Math.round((clearing[offset + c] - original[offset + c]) * blend);
        // Newly walkable pockets at the meadow edge have short grass and scattered stones.
        for (const [tile, sampleX, sampleY] of [[84,142,530],[96,108,678],[121,204,818],[137,426,878]]) {
            const cx = (tile % 12 + .5) * 1024 / 12, cy = (Math.floor(tile / 12) + .5) * 1024 / 12;
            const a = Math.min(1, Math.max(0, (55 - Math.hypot(x-cx,y-cy)) / 18));
            if (a <= 0) continue;
            const from = 3 * (Math.round(sampleY + y-cy) * 1024 + Math.round(sampleX + x-cx));
            for (let c = 0; c < 3; c++) original[offset+c] += Math.round((clearing[from+c] - original[offset+c]) * a);
        }
    }
    // A tall landmark projects above its occupied ground. Its front steps meet outdoor tile 111.
    const houses = await sharp(source('s105-houses-sprite')).resize(198, 208, {fit:'fill'}).png().toBuffer();
    return sharp(original, {raw:{width:1024,height:1024,channels:3}}).composite([{input:houses,left:169,top:563}]).png().toBuffer();
}

async function run() {
    const output = path.resolve(process.argv[2] || path.join(__dirname,'exports'));
    const assets = [
        ...await Promise.all(Object.keys(portraits).map(async id => [await bust(id), 'portraits/cinematic/coast/'+id+'-v1.webp',733,1100,98_000,true])),
        [source('s105-houses-sprite'),coast+'landmarks/s105-houses-v1.webp',512,512,128_000,true],
        [source('s105-houses-entry'),coast+'scenes/s105-houses-v1.webp',800,450,128_000,false],
        [source('s105-houses-room'),coast+'interiors/s105-houses-floor-v1.webp',1024,1024,250_000,false],
        [await sectorFloor(),coast+'floors/s105-v2.webp',1024,1024,250_000,false],
    ];
    for (const [input,file,width,height,limit,alpha] of assets) {
        let pipeline = sharp(input).resize(width,height,{fit:'fill'});
        if (alpha) {
            const {data,info} = await pipeline.ensureAlpha().raw().toBuffer({resolveWithObject:true});
            for (let i=3;i<data.length;i+=4) data[i]=Math.max(0,Math.min(255,Math.round((data[i]-10)*255/230)));
            pipeline=sharp(data,{raw:info});
        }
        if (!alpha) pipeline.removeAlpha();
        let written=false;
        for (let quality=88;quality>=16;quality-=3) {
            const buffer=await pipeline.clone().webp({quality,alphaQuality:82,effort:5}).toBuffer();
            if (buffer.length>limit) continue;
            const target=path.join(output,file);
            await fs.mkdir(path.dirname(target),{recursive:true});
            await fs.writeFile(target,buffer);
            written=true;
            console.log(file,buffer.length,quality);
            break;
        }
        if (!written) throw Error('Cannot encode within allowance: '+file);
    }
}
run().catch(error=>{console.error(error);process.exitCode=1;});


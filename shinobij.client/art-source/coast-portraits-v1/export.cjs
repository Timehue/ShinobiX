// Recreate the delivered cutouts from the lossless chroma-key masters.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const paintings = require('./portraits.json');

const clamp = value => Math.max(0, Math.min(1, value));
const width = 733, height = 1100;

async function cutout(master, beast, violetCoat) {
    const {data, info} = await sharp(master).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const {width:w, height:h} = info;
    // The backdrop is uniform. Use the measured key so a slightly darker generated
    // backdrop also disappears. Preserve real purple cloth inside the silhouette.
    const keys = [[], [], []];
    for (let x = 0; x < w; x += 4) {
        const i = x * 3;
        if (Math.min(data[i], data[i+2]) - data[i+1] > 140) {
            for (let c = 0; c < 3; c++) keys[c].push(data[i+c]);
        }
    }
    if (keys[0].length < 10) throw Error('Cannot sample chroma backdrop: ' + master);
    const key = keys.map(samples => samples.sort((a,b) => a-b)[Math.floor(samples.length / 2)]);
    const n = w*h, mask = new Uint8Array(n), queue = new Int32Array(n);
    let count = 0;
    for (let j = 0; j < n; j++) {
        const i = j*3;
        if (Math.abs(data[i]-key[0]) < 32 && Math.abs(data[i+1]-key[1]) < 32 && Math.abs(data[i+2]-key[2]) < 32) {
            mask[j] = 2;
            queue[count++] = j;
        }
    }
    function expand(j) {
        if (mask[j]) return;
        const i = 3*j;
        if (Math.min(data[i],data[i+2]) - data[i+1] <= 20) return;
        mask[j] = 1;
        queue[count++] = j;
    }
    // The hound has a naturally violet coat. Restrict edge cleanup to three pixels
    // inward from the fully keyed background so its mane stays opaque.
    let edgeLimit = count, remaining = 3;
    for (let pos = 0; pos < count; pos++) {
        if (violetCoat && pos === edgeLimit) {
            if (--remaining === 0) break;
            edgeLimit = count;
        }
        const j = queue[pos], x = j % w;
        if (x > 0) expand(j-1);
        if (x+1 < w) expand(j+1);
        if (j >= w) expand(j-w);
        if (j+w < n) expand(j+w);
    }
    const rgba = Buffer.alloc(n*4);
    let left=w, right=-1, top=h, bottom=-1;
    for (let j = 0; j < n; j++) {
        if (mask[j] === 2) continue;
        const i = j*3, o = j*4, x=j%w, y=Math.floor(j/w);
        let alpha = 1;
        if (mask[j]) {
            const spill = Math.min(data[i],data[i+2])-data[i+1];
            alpha = clamp(1-spill/(Math.min(key[0],key[2])-key[1]));
        }
        if (alpha < .07) continue;
        for (let c=0;c<3;c++) rgba[o+c] = Math.round(255*clamp((data[i+c]-(1-alpha)*key[c])/(255*alpha)));
        // Hair, cord and worn cloth have fine mixed pixels at the key boundary.
        // Clear residual pink in those pixels without altering solid costume colors.
        const boundary = mask[j] || (x>1 && mask[j-2]) || (x<w-2 && mask[j+2])
            || (y>1 && mask[j-2*w]) || (y<h-2 && mask[j+2*w]);
        const fringe = Math.min(rgba[o],rgba[o+2])-rgba[o+1];
        if (fringe>15 && (boundary || (!violetCoat && fringe>72 && Math.min(rgba[o],rgba[o+2])>153))) {
            rgba[o] -= fringe-10;
            rgba[o+2] -= fringe-10;
        }
        rgba[o+3] = Math.round(255*alpha);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if (right<=left || bottom<=top) throw Error('Empty portrait: '+master);
    const portrait=await sharp(rgba,{raw:{width:w,height:h,channels:4}}).extract({left,top,width:right-left+1,height:bottom-top+1})
        .resize(width-12,height-40,{fit:'inside'}).png().toBuffer({resolveWithObject:true});
    return sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{input:portrait.data,left:Math.floor((width-portrait.info.width)/2),top:beast ? 34 : height-portrait.info.height}]).png().toBuffer();
}

async function main() {
    const dest = path.resolve(process.argv[2] || path.join(__dirname,'../../../output/coast/portraits'));
    await fs.mkdir(dest,{recursive:true});
    let speakerBytes = 0, beastBytes = 0;
    for (const row of paintings) {
        const beast = row.group === 'beast';
        const revision = row.revision ?? 1;
        const filename = row.id+'-v'+revision;
        const master = revision === 1 ? row.id : filename;
        const input = await cutout(path.join(__dirname,'masters',master+'.png'), beast, row.preserveVioletCoat);
        let bytes;
        for (const quality of [89,86,83,80,77,74,71,68]) {
            bytes = await sharp(input).webp({quality,alphaQuality:95,effort:6,smartSubsample:true}).toBuffer();
            if (bytes.length <= (row.maxBytes ?? (beast ? 116660 : 118500))) break;
        }
        if (bytes.length > 130000) throw Error(row.id+' exceeds 130,000 bytes');
        if (beast) beastBytes += bytes.length;
        else speakerBytes += bytes.length;
        await fs.writeFile(path.join(dest,filename+'.webp'),bytes);
        console.log(row.id,bytes.length);
    }
    if (speakerBytes>3000000 || beastBytes>350000) throw Error('Portrait set exceeds its allowance');
    console.log('Speaker bytes',speakerBytes,'beast bytes',beastBytes,'total bytes',speakerBytes+beastBytes);
}
main().catch(error=>{console.error(error);process.exitCode=1});

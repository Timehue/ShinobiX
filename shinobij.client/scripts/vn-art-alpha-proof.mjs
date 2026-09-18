// Diagnostic composites only; never used as game artwork.
import sharp from 'sharp';
import path from 'node:path';
const [output,...files]=process.argv.slice(2);
for(const [index,file] of files.entries()){
    const image=await sharp(file).resize({height:780}).png().toBuffer();
    const meta=await sharp(image).metadata();
    await sharp({create:{width:meta.width,height:meta.height,channels:3,background:'#5685a0'}}).composite([{input:image}]).png().toFile(path.join(output,`alpha-proof-${index}.png`));
}

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
// Dependency-free, reproducible PNG icon generation.
const out = new URL("../artifacts/saad-albaqmi/public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k=0;k<8;k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([len,name,data,crc]);
}
for (const n of [192,512]) {
  const raw = Buffer.alloc(n*(n*4+1));
  for (let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const px=x/n, py=y/n;
    const book = py>0.56 && py<0.72 && px>0.26 && px<0.74 && Math.abs(px-0.5)>0.018;
    const pillar = py>0.33 && py<0.54 && [0.32,0.46,0.60].some(start=>px>start && px<start+0.08);
    const roof = py>0.24 && py<0.32 && Math.abs(px-0.5)<(py-0.22)*2.4;
    const mark=book||pillar||roof;
    const i=y*(n*4+1)+1+x*4;
    raw[i]=mark?214:22; raw[i+1]=mark?184:61; raw[i+2]=mark?119:50; raw[i+3]=255;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(n,0);header.writeUInt32BE(n,4);header[8]=8;header[9]=6;
  writeFileSync(new URL(`icon-${n}.png`,out),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}

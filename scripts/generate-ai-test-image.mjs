import fs from 'node:fs'
import zlib from 'node:zlib'
const width=128,height=64,raw=Buffer.alloc((width*3+1)*height,255)
for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;for(let x=0;x<width;x++)if((y>=12&&y<=18&&x>=43&&x<=85)||(y>=18&&y<=52&&Math.abs(x-(85-(y-18)*.8))<4))for(let c=0;c<3;c++)raw[y*(width*3+1)+1+x*3+c]=0}
function chunk(type,body){const data=Buffer.concat([Buffer.from(type),body]);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const len=Buffer.alloc(4),tail=Buffer.alloc(4);len.writeUInt32BE(body.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,data,tail])}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
fs.writeFileSync(new URL('../src-tauri/src/ai-test-image.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]))

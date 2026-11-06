/**
 * Genera los iconos instalables de la PWA (favicon.svg, icon-192.png, icon-512.png)
 * en la carpeta `public/` sin dependencias externas nativas.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const publicDir = join(process.cwd(), 'public');
mkdirSync(publicDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="38" fill="#0f766e"/>
  <rect x="40" y="32" width="112" height="128" rx="14" fill="#ffffff"/>
  <rect x="56" y="60" width="80" height="10" rx="5" fill="#0f766e"/>
  <rect x="56" y="86" width="80" height="10" rx="5" fill="#0f766e" opacity="0.7"/>
  <rect x="56" y="112" width="52" height="10" rx="5" fill="#0f766e" opacity="0.7"/>
  <circle cx="132" cy="122" r="14" fill="#059669"/>
  <path d="M126 122l4 4 9-9" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

writeFileSync(join(publicDir, 'favicon.svg'), svg, 'utf8');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createSolidPng(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const margin = Math.floor(size * 0.2);

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 4;
      const inPage = x >= margin && x < size - margin && y >= margin && y < size - margin;
      if (inPage) {
        raw[p] = 255;
        raw[p + 1] = 255;
        raw[p + 2] = 255;
        raw[p + 3] = 255;
      } else {
        // #0f766e (15, 118, 110)
        raw[p] = 15;
        raw[p + 1] = 118;
        raw[p + 2] = 110;
        raw[p + 3] = 255;
      }
    }
  }

  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(publicDir, 'icon-192.png'), createSolidPng(192));
writeFileSync(join(publicDir, 'icon-512.png'), createSolidPng(512));
console.log('Iconos PWA generados en public/');

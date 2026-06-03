import sharp from 'sharp';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/icons');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <circle cx="256" cy="256" r="228" fill="#040404"/>
  <defs>
    <linearGradient id="ng" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="42%"  stop-color="#ffffff"/>
      <stop offset="50%"  stop-color="#b0b0b0"/>
      <stop offset="58%"  stop-color="#505050"/>
      <stop offset="65%"  stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <mask id="nm">
      <!-- N built from rectangles so no font dependency -->
      <!-- left bar -->
      <rect x="128" y="128" width="52" height="256" fill="white"/>
      <!-- right bar -->
      <rect x="332" y="128" width="52" height="256" fill="white"/>
      <!-- diagonal: two parallelogram polygons -->
      <polygon points="180,128 232,128 384,384 332,384" fill="white"/>
    </mask>
  </defs>
  <!-- N shape filled with gradient -->
  <rect width="512" height="512" fill="url(#ng)" mask="url(#nm)"/>
</svg>`;

const SIZES = [
  { name: 'favicon-32.png',      size: 32 },
  { name: 'icon-72.png',         size: 72 },
  { name: 'icon-96.png',         size: 96 },
  { name: 'icon-128.png',        size: 128 },
  { name: 'icon-144.png',        size: 144 },
  { name: 'icon-152.png',        size: 152 },
  { name: 'icon-180.png',        size: 180 },
  { name: 'apple-touch-icon.png',size: 180 },
  { name: 'icon-192.png',        size: 192 },
  { name: 'icon-384.png',        size: 384 },
  { name: 'icon-512.png',        size: 512 },
];

for (const { name, size } of SIZES) {
  const outPath = path.join(OUT, name);
  await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`✓ ${name} (${size}x${size})`);
}

// Also write nexus-logo.png at the root (512px)
await sharp(Buffer.from(SVG)).resize(512, 512).png().toFile(path.join(__dirname, '../public/nexus-logo.png'));
console.log('✓ nexus-logo.png (512x512)');

console.log('\nDone — all icons regenerated.');

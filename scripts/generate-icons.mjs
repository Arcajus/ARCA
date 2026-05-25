import sharp from "sharp";
import { mkdir } from "fs/promises";

await mkdir("public/icons", { recursive: true });

// NEXUS icon — blue square with white N
const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

for (const size of sizes) {
  const fontSize = Math.round(size * 0.55);
  const radius = Math.round(size * 0.22);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0F1420"/>
          <stop offset="100%" stop-color="#07090F"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
      <rect x="${size * 0.08}" y="${size * 0.08}" width="${size * 0.84}" height="${size * 0.84}" rx="${radius * 0.8}" fill="#2B78F5" opacity="0.15"/>
      <text
        x="${size / 2}"
        y="${size * 0.68}"
        font-family="Georgia, serif"
        font-size="${fontSize}"
        font-weight="900"
        fill="#FFFFFF"
        text-anchor="middle"
        dominant-baseline="auto"
        letter-spacing="-2"
      >N</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(`public/icons/icon-${size}.png`);

  console.log(`✓ icon-${size}.png`);
}

// Apple touch icon (180x180)
const appleSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <rect width="180" height="180" rx="40" fill="#07090F"/>
    <rect x="14" y="14" width="152" height="152" rx="34" fill="#2B78F5" opacity="0.15"/>
    <text x="90" y="122" font-family="Georgia,serif" font-size="100" font-weight="900" fill="#FFFFFF" text-anchor="middle" dominant-baseline="auto">N</text>
  </svg>
`;
await sharp(Buffer.from(appleSvg)).png().toFile("public/icons/apple-touch-icon.png");
console.log("✓ apple-touch-icon.png");

// Favicon 32x32
const faviconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#07090F"/>
    <text x="16" y="24" font-family="Georgia,serif" font-size="20" font-weight="900" fill="#2B78F5" text-anchor="middle">N</text>
  </svg>
`;
await sharp(Buffer.from(faviconSvg)).png().toFile("public/icons/favicon-32.png");
console.log("✓ favicon-32.png");

console.log("\n✅ Toutes les icônes générées !");

// One-off / re-runnable helper: renders the app's one sport-neutral icon (a
// white check-in-a-ring on the app green, --green in globals.css) to every
// icon file the app serves:
//   src/app/icon.svg          browser-tab icon (scalable)
//   src/app/favicon.ico       16/32/48 fallback for browsers without SVG favicons
//   src/app/apple-icon.png    180×180, iOS "Add to Home Screen"
//   public/icons/icon-192.png, icon-512.png                  manifest "any"
//   public/icons/maskable-192.png, maskable-512.png          manifest "maskable"
// (the src/app files are Next.js metadata file conventions, so Next adds the
// <link> tags itself; the public/icons ones are listed in src/app/manifest.ts).
// The PNGs are fully opaque on purpose: iOS renders transparent pixels as black.
//
// Run with: node scripts/make-app-icons.mjs  (uses sharp, a Next.js dependency)

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

// --green: oklch(0.68 0.19 142) from globals.css, converted to sRGB hex.
const GREEN = "#43b43a";

// The mark on a 512×512 canvas, centered at (256, 256). `scale` shrinks it
// around the center (used for the maskable variant).
function iconSvg({ scale = 1, rounded = false } = {}) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${GREEN}"${rounded ? ' rx="96"' : ""}/>
  <g transform="${t}" fill="none" stroke="#fff">
    <circle cx="256" cy="256" r="150" stroke-width="34"/>
    <path d="M184 262 L236 312 L332 206" stroke-width="40"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;
}

// Full-size mark: the ring's outer radius is 167/512 ≈ 33% of the icon.
const STANDARD = iconSvg();
// Maskable: Android crops these to a circle/squircle/etc. and only guarantees
// the central 80% (a circle of radius 40%) survives. Shrinking the mark to 80%
// puts the ring's outer edge at ≈26% radius — well inside the safe zone — on
// a full-bleed green background, so nothing important can be cropped.
const MASKABLE = iconSvg({ scale: 0.8 });
// Tab icon: rounded corners look better in a tab strip. Transparency is fine
// here (unlike the home-screen PNGs).
const TAB = iconSvg({ rounded: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = (file) => path.join(root, file);
await mkdir(out("public/icons"), { recursive: true });

/** Opaque PNG buffer of `svg` at `size`×`size`. */
function png(svg, size, { opaque = true } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (opaque) img = img.flatten({ background: GREEN }); // drop the alpha channel
  return img.png().toBuffer();
}

/**
 * Minimal .ico writer: a 6-byte header, one 16-byte directory entry per image,
 * then the images themselves as embedded PNGs (supported by every browser and
 * by Windows since Vista). sharp can't write .ico itself.
 */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colors
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const pngOutputs = [
  ["src/app/apple-icon.png", STANDARD, 180],
  ["public/icons/icon-192.png", STANDARD, 192],
  ["public/icons/icon-512.png", STANDARD, 512],
  ["public/icons/maskable-192.png", MASKABLE, 192],
  ["public/icons/maskable-512.png", MASKABLE, 512],
];
for (const [file, svg, size] of pngOutputs) {
  await writeFile(out(file), await png(svg, size));
  console.log(`  ${file} (${size}×${size})`);
}

await writeFile(out("src/app/icon.svg"), TAB);
console.log("  src/app/icon.svg");

const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await png(TAB, size, { opaque: false }) }))
);
await writeFile(out("src/app/favicon.ico"), ico(icoImages));
console.log(`  src/app/favicon.ico (${icoSizes.join("/")})`);

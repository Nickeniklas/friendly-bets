// One-off / re-runnable helper: copies the flag SVGs we need (per the codes
// in src/lib/flags.ts) from the flag-icons package into public/flags/, so
// the app serves them as static assets without depending on node_modules at
// runtime.
//
// Run with: node scripts/copy-flags.mjs
// If TEAM_FLAG_CODES in src/lib/flags.ts gains a new code (e.g. once a
// knockout placeholder resolves to a country not already in the map), add
// it to FLAG_CODES below too and re-run.

import { mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FLAG_CODES = [
  "dz", "ar", "au", "at", "be", "ba", "br", "ca", "cv", "co",
  "hr", "cw", "cz", "cd", "ec", "eg", "gb-eng", "fr", "de", "gh",
  "ht", "ir", "iq", "ci", "jp", "jo", "mx", "ma", "nl", "nz",
  "no", "pa", "py", "pt", "qa", "sa", "gb-sct", "sn", "za", "kr",
  "es", "se", "ch", "tn", "tr", "us", "uy", "uz",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "node_modules", "flag-icons", "flags", "4x3");
const destDir = path.join(root, "public", "flags");

await mkdir(destDir, { recursive: true });

let copied = 0;
for (const code of FLAG_CODES) {
  await copyFile(
    path.join(srcDir, `${code}.svg`),
    path.join(destDir, `${code}.svg`)
  );
  copied++;
}

console.log(`Copied ${copied} flag SVGs to public/flags/`);

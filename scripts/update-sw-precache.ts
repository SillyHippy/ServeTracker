import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const projectDir = join(__dirname, "..");
const distAssetsDir = join(projectDir, "dist/assets");
const publicSwPath = join(projectDir, "public/sw.js");
const distSwPath = join(projectDir, "dist/sw.js");

const basePrecache = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
];

let assets: string[] = [];
if (existsSync(distAssetsDir)) {
  const files = readdirSync(distAssetsDir);
  assets = files.map((f) => `/assets/${f}`);
}

const allPrecache = Array.from(new Set([...basePrecache, ...assets]));
const cacheVersion = `servetracker-v${Date.now()}`;

console.log(`[PWA Precache] Found ${assets.length} assets in dist/assets. Total precached URLs: ${allPrecache.length}`);

function patchSw(filePath: string) {
  if (!existsSync(filePath)) return;
  let code = readFileSync(filePath, "utf8");

  // Replace CACHE_NAME
  code = code.replace(
    /const CACHE_NAME = ['"][^'"]+['"];/,
    `const CACHE_NAME = '${cacheVersion}';`
  );

  // Replace PRECACHE_ASSETS array
  const formattedArray = JSON.stringify(allPrecache, null, 2);
  code = code.replace(
    /const PRECACHE_ASSETS = \[[^\]]*\];/s,
    `const PRECACHE_ASSETS = ${formattedArray};`
  );

  writeFileSync(filePath, code, "utf8");
  console.log(`[PWA Precache] Updated ${filePath} with ${allPrecache.length} precache items and version ${cacheVersion}`);
}

patchSw(distSwPath);
patchSw(publicSwPath);

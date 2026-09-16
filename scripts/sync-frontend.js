// Copies the game's index.html (and its vendored assets) into frontend/,
// which is the isolated web-assets folder Tauri bundles. index.html and
// vendor/ at the project root remain the single source of truth for the
// game code; this script just keeps frontend/ in sync with them before
// dev/build.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const destDir = path.join(root, "frontend");

fs.mkdirSync(destDir, { recursive: true });

const htmlSrc = path.join(root, "index.html");
const htmlDest = path.join(destDir, "index.html");
fs.copyFileSync(htmlSrc, htmlDest);
console.log(`Synced ${htmlSrc} -> ${htmlDest}`);

const vendorSrc = path.join(root, "vendor");
const vendorDest = path.join(destDir, "vendor");
fs.cpSync(vendorSrc, vendorDest, { recursive: true });
console.log(`Synced ${vendorSrc} -> ${vendorDest}`);

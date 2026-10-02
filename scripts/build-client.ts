// Builds the dashboard into dist/app.js. npm runs this before packing (the prepack
// script), so the published package serves it as-is and doesn't need React installed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildClientBundle, PREBUILT_CLIENT } from "../src/clientBuild.ts";

const code = await buildClientBundle();
mkdirSync(dirname(PREBUILT_CLIENT), { recursive: true });
writeFileSync(PREBUILT_CLIENT, code, "utf8");
console.log(`Built ${PREBUILT_CLIENT} (${Math.round(Buffer.byteLength(code) / 1024)} KB)`);

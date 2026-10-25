import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { logoSvgFile } from "../src/client/logoMark.ts";
import { appleTouchIconPng, faviconIco } from "../src/icons.ts";

// Builds the live demo: the real dashboard with sample data, as static files for GitHub Pages.
// bun demo/build.ts, then serve demo/dist/ from any static host.

const root = resolve(import.meta.dir, "..");
const clientDir = join(root, "src/client");
const outDir = join(import.meta.dir, "dist");
const { version } = await Bun.file(join(root, "package.json")).json();

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "main.ts")],
  target: "browser",
  format: "esm",
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    DEMO_VERSION: JSON.stringify(version),
  },
});
if (!result.success || !result.outputs[0]) {
  throw new Error(`Demo build failed:\n${result.logs.map((log) => log.message).join("\n")}`);
}

const banner = `
    <style>
      .demo-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 14px; padding: 9px 16px; background: var(--accent); color: var(--accent-ink); font: 500 14px/1.4 var(--font); text-align: center; }
      .demo-banner a { color: inherit; font-weight: 650; text-underline-offset: 3px; }
      .demo-banner code { font: 600 13px var(--mono); padding: 1px 6px; border-radius: 4px; background: rgb(255 255 255 / 16%); }
    </style>
    <div class="demo-banner" role="note">
      <span>Live demo with made-up numbers. See your own with <code>bunx token-larper</code></span>
      <a href="https://github.com/YarooqH/token-larper">Get it on GitHub</a>
    </div>`;

// Pages serves the demo from a sub-path, so asset links have to be relative.
const html = (await Bun.file(join(clientDir, "index.html")).text())
  .replace(/(href|src)="\/(?!\/)/g, '$1="./')
  .replace("<title>Token Larper — Usage overview</title>", "<title>Token Larper — Live demo</title>")
  .replace('<div id="root"></div>', `${banner}\n    <div id="root"></div>`);
if (!html.includes("demo-banner") || html.includes('="/')) throw new Error("index.html changed shape; update demo/build.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await Promise.all([
  Bun.write(join(outDir, "index.html"), html),
  Bun.write(join(outDir, "app.js"), await result.outputs[0].text()),
  Bun.write(join(outDir, "styles.css"), Bun.file(join(clientDir, "styles.css"))),
  Bun.write(join(outDir, "logo.svg"), logoSvgFile()),
  Bun.write(join(outDir, "favicon.ico"), faviconIco()),
  Bun.write(join(outDir, "apple-touch-icon.png"), appleTouchIconPng()),
  // Without this, Pages runs the files through Jekyll.
  Bun.write(join(outDir, ".nojekyll"), ""),
]);

console.log(`Built the live demo (v${version}) into ${outDir}`);

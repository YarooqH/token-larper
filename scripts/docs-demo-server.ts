import { join, resolve } from "node:path";
import { dashboardFixture, limitsFixture, throughputFixture } from "../demo/fixtures.ts";

// A self-contained sample dashboard for documentation captures. It never reads local usage files.
// The sample data is shared with the live demo (demo/).
const clientDir = resolve(import.meta.dir, "../src/client");
const port = Number(process.env.DOCS_DEMO_PORT || 4280);

const bundle = Bun.build({
  entrypoints: [join(clientDir, "main.tsx")], target: "browser", format: "esm", minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
}).then(async (result) => {
  if (!result.success || !result.outputs[0]) throw new Error("Could not build the dashboard client");
  return result.outputs[0].text();
});
const sample = dashboardFixture();
const speeds = throughputFixture();

Bun.serve({
  port, hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/index.html") return new Response(Bun.file(join(clientDir, "index.html")), { headers: { "Content-Type": "text/html" } });
    if (path === "/styles.css") return new Response(Bun.file(join(clientDir, "styles.css")), { headers: { "Content-Type": "text/css" } });
    if (path === "/logo.svg") return new Response(Bun.file(join(clientDir, "logo.svg")), { headers: { "Content-Type": "image/svg+xml" } });
    if (path === "/app.js") return new Response(await bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/api/usage") return Response.json(sample);
    if (path === "/api/throughput") return Response.json(speeds);
    if (path === "/api/limits") return Response.json(limitsFixture());
    if (path === "/api/startup" && request.method === "GET") return Response.json({ enabled: false, openBrowserOnBoot: false, port, registryValue: null, launcherPath: "Sample dashboard" });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Documentation sample dashboard: http://localhost:${port}`);

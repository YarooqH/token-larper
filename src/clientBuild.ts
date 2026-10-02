import { join, resolve } from "node:path";

const CLIENT_DIR = join(import.meta.dir, "client");

/** The dashboard bundle that the published package ships (see scripts/build-client.ts). */
export const PREBUILT_CLIENT = resolve(import.meta.dir, "..", "dist", "app.js");

/** Bundle src/client for the browser. Needs React, a dev dependency, to be installed. */
export async function buildClientBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(CLIENT_DIR, "main.tsx")],
    target: "browser",
    format: "esm",
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success || result.outputs.length === 0) {
    const logs = result.logs.map((l) => l.message).join("\n");
    throw new Error(`Client bundle build failed:\n${logs}`);
  }

  return await result.outputs[0]!.text();
}

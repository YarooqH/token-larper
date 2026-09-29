import { appendFileSync, writeFileSync } from "node:fs";

// When the CLI starts the server in the background it has no terminal, so the server
// writes its own output to the file named in TOKEN_LARPER_LOG_FILE (the CLI reads it
// to learn the URL). Imported first by server.ts so nothing is missed.

const file = process.env.TOKEN_LARPER_LOG_FILE;

if (file) {
  try {
    writeFileSync(file, "");
  } catch {
    // Logging is best effort.
  }
  const write = (args: unknown[]) => {
    try {
      appendFileSync(file, args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" ") + "\n");
    } catch {
      // Logging is best effort.
    }
  };
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(args);
      original(...args);
    };
  }
  process.on("uncaughtException", (error) => {
    write(["Token Larper stopped:", error]);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    write(["Token Larper stopped:", reason]);
    process.exit(1);
  });
}

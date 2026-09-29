import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startTrayThemeSync } from "./lib/trayTheme.ts";

startTrayThemeSync();

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

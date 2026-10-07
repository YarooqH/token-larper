import { startSystemTray as startWindowsTray, stopSystemTray as stopWindowsTray } from "./windows.ts";

// Only Windows has a tray today; other platforms intentionally do nothing.
export async function startSystemTray(port: number): Promise<void> {
  if (process.env.NO_TRAY === "1") return;
  if (process.platform === "win32") await startWindowsTray(port);
}

export function stopSystemTray(): void {
  if (process.platform === "win32") stopWindowsTray();
}

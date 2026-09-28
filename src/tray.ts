import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const SCRIPTS_DIR = join(ROOT_DIR, "scripts");
const TRAY_PS1_PATH = join(SCRIPTS_DIR, "tray-host.ps1");
const TRAY_LAUNCHER_PS1 = join(SCRIPTS_DIR, "launch-on-default-desktop.ps1");

let trayPid: number | null = null;

export function generateTrayScript(port: number, serverPid: number): string {
  mkdirSync(SCRIPTS_DIR, { recursive: true });

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ServerPort = ${port}
$ServerPid = ${serverPid}
$BaseUrl = "http://127.0.0.1:$ServerPort"

# Opt into DPI awareness so the icon is drawn at the tray's real pixel size
# (20px at 125%, 24px at 150%) instead of being drawn at 16px and blurred up.
Add-Type -Namespace TokenLarper -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[TokenLarper.Dpi]::SetProcessDPIAware() | Out-Null

# The t. monogram from src/client/logo.svg, drawn in its 64-unit coordinates.
$iconSize = [Math]::Max(16, [System.Windows.Forms.SystemInformation]::SmallIconSize.Width)
$bmp = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.ScaleTransform($iconSize / 64, $iconSize / 64)

$green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 47, 90, 67))
$cream = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 243, 227, 191))
$gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 225, 183, 92))

# Rounded square: x 3, y 3, size 58, corner radius 14.
$tile = New-Object System.Drawing.Drawing2D.GraphicsPath
$tile.AddArc(3, 3, 28, 28, 180, 90)
$tile.AddArc(33, 3, 28, 28, 270, 90)
$tile.AddArc(33, 33, 28, 28, 0, 90)
$tile.AddArc(3, 33, 28, 28, 90, 90)
$tile.CloseFigure()
$g.FillPath($green, $tile)

# Letter t: a stem with a curved foot, plus the crossbar.
$stem = New-Object System.Drawing.Drawing2D.GraphicsPath
$stem.AddLine(20, 12, 28, 12)
$stem.AddLine(28, 12, 28, 43.5)
$stem.AddBezier(28, 43.5, 28, 45.2, 28.8, 46, 30.5, 46)
$stem.AddLine(30.5, 46, 35, 46)
$stem.AddLine(35, 46, 35, 53)
$stem.AddLine(35, 53, 28.5, 53)
$stem.AddBezier(28.5, 53, 22.8, 53, 20, 50.2, 20, 44.5)
$stem.CloseFigure()
$g.FillPath($cream, $stem)
$g.FillRectangle($cream, 13, 21, 22, 7)

# The dot.
$g.FillEllipse($gold, 39.5, 42, 11, 11)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Token Larper - AI Coding Telemetry (Port $ServerPort)"
$notifyIcon.Visible = $true

# Compact left-click popup. Its values come from the same local status endpoint as the menu.
$popup = New-Object System.Windows.Forms.Form
$popup.Text = "Token Larper"
$popup.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$popup.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$popup.ShowInTaskbar = $false
$popup.TopMost = $true
$popup.KeyPreview = $true
$popup.ClientSize = New-Object System.Drawing.Size(300, 226)
$popup.BackColor = [System.Drawing.Color]::FromArgb(23, 35, 29)

$popupText = [System.Drawing.Color]::FromArgb(244, 242, 233)
$popupMuted = [System.Drawing.Color]::FromArgb(177, 192, 181)
$popupAccent = [System.Drawing.Color]::FromArgb(169, 219, 182)

$popupTitle = New-Object System.Windows.Forms.Label
$popupTitle.Text = "Token Larper"
$popupTitle.Location = New-Object System.Drawing.Point(18, 15)
$popupTitle.Size = New-Object System.Drawing.Size(264, 22)
$popupTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$popupTitle.ForeColor = $popupText
$popup.Controls.Add($popupTitle)

$popupCaption = New-Object System.Windows.Forms.Label
$popupCaption.Text = "Total tokens"
$popupCaption.Location = New-Object System.Drawing.Point(18, 52)
$popupCaption.Size = New-Object System.Drawing.Size(264, 19)
$popupCaption.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$popupCaption.ForeColor = $popupMuted
$popup.Controls.Add($popupCaption)

$popupTokens = New-Object System.Windows.Forms.Label
$popupTokens.Text = "Loading..."
$popupTokens.Location = New-Object System.Drawing.Point(16, 71)
$popupTokens.Size = New-Object System.Drawing.Size(266, 43)
$popupTokens.Font = New-Object System.Drawing.Font("Segoe UI", 23, [System.Drawing.FontStyle]::Bold)
$popupTokens.ForeColor = $popupText
$popup.Controls.Add($popupTokens)

$popupRule = New-Object System.Windows.Forms.Panel
$popupRule.Location = New-Object System.Drawing.Point(18, 123)
$popupRule.Size = New-Object System.Drawing.Size(264, 1)
$popupRule.BackColor = [System.Drawing.Color]::FromArgb(57, 72, 62)
$popup.Controls.Add($popupRule)

$verifiedCaption = New-Object System.Windows.Forms.Label
$verifiedCaption.Text = "Verified cost"
$verifiedCaption.Location = New-Object System.Drawing.Point(18, 136)
$verifiedCaption.Size = New-Object System.Drawing.Size(126, 18)
$verifiedCaption.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$verifiedCaption.ForeColor = $popupMuted
$popup.Controls.Add($verifiedCaption)

$popupVerified = New-Object System.Windows.Forms.Label
$popupVerified.Text = "—"
$popupVerified.Location = New-Object System.Drawing.Point(18, 153)
$popupVerified.Size = New-Object System.Drawing.Size(126, 25)
$popupVerified.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$popupVerified.ForeColor = $popupText
$popup.Controls.Add($popupVerified)

$estimatedCaption = New-Object System.Windows.Forms.Label
$estimatedCaption.Text = "LARP value"
$estimatedCaption.Location = New-Object System.Drawing.Point(154, 136)
$estimatedCaption.Size = New-Object System.Drawing.Size(128, 18)
$estimatedCaption.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$estimatedCaption.ForeColor = $popupMuted
$popup.Controls.Add($estimatedCaption)

$popupEstimated = New-Object System.Windows.Forms.Label
$popupEstimated.Text = "—"
$popupEstimated.Location = New-Object System.Drawing.Point(154, 153)
$popupEstimated.Size = New-Object System.Drawing.Size(128, 25)
$popupEstimated.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$popupEstimated.ForeColor = $popupText
$popup.Controls.Add($popupEstimated)

$popupOpen = New-Object System.Windows.Forms.Button
$popupOpen.Text = "Open dashboard"
$popupOpen.Location = New-Object System.Drawing.Point(18, 187)
$popupOpen.Size = New-Object System.Drawing.Size(264, 30)
$popupOpen.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$popupOpen.FlatAppearance.BorderSize = 0
$popupOpen.BackColor = [System.Drawing.Color]::FromArgb(47, 90, 67)
$popupOpen.ForeColor = $popupText
$popupOpen.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$popupOpen.Cursor = [System.Windows.Forms.Cursors]::Hand
$popup.Controls.Add($popupOpen)

function Open-Dashboard {
  $popup.Hide()
  try {
    Start-Process -FilePath $BaseUrl -ErrorAction Stop
  } catch {
    $notifyIcon.ShowBalloonTip(4000, "Token Larper", "Could not open the browser. Visit $BaseUrl manually.", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
}

$popupOpen.Add_Click({ Open-Dashboard })
$popup.Add_KeyDown({
  param($sender, $eventArgs)
  if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $popup.Hide()
    $eventArgs.Handled = $true
  }
})
$script:lastPopupDismissedAt = -1000
$popup.Add_Deactivate({
  if ($popup.Visible) {
    $popup.Hide()
    $script:lastPopupDismissedAt = [Environment]::TickCount
  }
})

function Show-StatusPopup {
  $cursor = [System.Windows.Forms.Cursor]::Position
  $area = [System.Windows.Forms.Screen]::FromPoint($cursor).WorkingArea
  $x = [Math]::Max($area.Left + 8, [Math]::Min($cursor.X - $popup.Width + 24, $area.Right - $popup.Width - 8))
  if ($cursor.Y -ge $area.Bottom) {
    $y = $area.Bottom - $popup.Height - 8
  } elseif ($cursor.Y -lt $area.Top) {
    $y = $area.Top + 8
  } else {
    $y = [Math]::Max($area.Top + 8, [Math]::Min($cursor.Y - $popup.Height - 12, $area.Bottom - $popup.Height - 8))
  }
  $popup.Location = New-Object System.Drawing.Point($x, $y)
  $popup.Show()
  $popup.Activate() | Out-Null
  $popupOpen.Focus() | Out-Null
}

# Context Menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemHeader = New-Object System.Windows.Forms.ToolStripMenuItem("Token Larper Telemetry")
$itemHeader.Enabled = $false
$menu.Items.Add($itemHeader) | Out-Null

$itemStats = New-Object System.Windows.Forms.ToolStripMenuItem("Loading usage stats...")
$itemStats.Enabled = $false
$menu.Items.Add($itemStats) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem("Open Dashboard (http://localhost:$ServerPort)")
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemOpen.Add_Click({ Open-Dashboard })
$menu.Items.Add($itemOpen) | Out-Null

$itemSync = New-Object System.Windows.Forms.ToolStripMenuItem("Sync Harnesses Now (ccusage)")
$itemSync.Add_Click({
  try {
    $notifyIcon.ShowBalloonTip(2000, "Token Larper", "Syncing coding harnesses via ccusage...", [System.Windows.Forms.ToolTipIcon]::Info)
    Invoke-RestMethod -Uri "$BaseUrl/api/usage?refresh=1" -Method Get -TimeoutSec 20 | Out-Null
    Update-TrayStatus
    $notifyIcon.ShowBalloonTip(2500, "Token Larper Synced", $itemStats.Text, [System.Windows.Forms.ToolTipIcon]::Info)
  } catch {
    $notifyIcon.ShowBalloonTip(2500, "Token Larper", "Failed to sync harnesses.", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
})
$menu.Items.Add($itemSync) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemBoot = New-Object System.Windows.Forms.ToolStripMenuItem("Start on Windows Boot")
$itemBoot.CheckOnClick = $false
$itemBoot.Add_Click({
  try {
    $nextState = -not $itemBoot.Checked
    $body = @{ enabled = $nextState; openBrowserOnBoot = $itemOpenOnBoot.Checked } | ConvertTo-Json
    $res = Invoke-RestMethod -Uri "$BaseUrl/api/startup" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
    $itemBoot.Checked = [bool]$res.enabled
    $itemOpenOnBoot.Checked = [bool]$res.openBrowserOnBoot
  } catch {}
})
$menu.Items.Add($itemBoot) | Out-Null

$itemOpenOnBoot = New-Object System.Windows.Forms.ToolStripMenuItem("Auto-Open Browser on Boot")
$itemOpenOnBoot.CheckOnClick = $false
$itemOpenOnBoot.Add_Click({
  try {
    $nextOpen = -not $itemOpenOnBoot.Checked
    $body = @{ enabled = $itemBoot.Checked; openBrowserOnBoot = $nextOpen } | ConvertTo-Json
    $res = Invoke-RestMethod -Uri "$BaseUrl/api/startup" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
    $itemBoot.Checked = [bool]$res.enabled
    $itemOpenOnBoot.Checked = [bool]$res.openBrowserOnBoot
  } catch {}
})
$menu.Items.Add($itemOpenOnBoot) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemQuit = New-Object System.Windows.Forms.ToolStripMenuItem("Quit Token Larper")
$itemQuit.Add_Click({
  $notifyIcon.Visible = $false
  $popup.Close()
  $popup.Dispose()
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/shutdown" -Method Post -ContentType "application/json" -TimeoutSec 3 | Out-Null
  } catch {}
  try {
    Stop-Process -Id $ServerPid -Force -ErrorAction SilentlyContinue
  } catch {}
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($itemQuit) | Out-Null

$notifyIcon.ContextMenuStrip = $menu

# Left-click toggles the status popup; right-click keeps the context menu.
$notifyIcon.Add_MouseClick({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    if ($popup.Visible) {
      $popup.Hide()
    } elseif ([Environment]::TickCount - $script:lastPopupDismissedAt -gt 250) {
      Show-StatusPopup
    }
  } elseif ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
    $popup.Hide()
  }
})

function Update-TrayStatus {
  try {
    $st = Invoke-RestMethod -Uri "$BaseUrl/api/tray-status" -Method Get -TimeoutSec 4
    if ($null -ne $st) {
      $itemStats.Text = $st.summaryText
      $tooltip = "Token Larper: $($st.shortTooltip)"
      if ($tooltip.Length -gt 63) {
        $tooltip = $tooltip.Substring(0, 63)
      }
      $notifyIcon.Text = $tooltip
      $popupTokens.Text = $st.totalTokensText
      $popupVerified.Text = $st.verifiedCostText
      $popupEstimated.Text = $st.estimatedCostText
      $itemBoot.Checked = [bool]$st.bootEnabled
      $itemOpenOnBoot.Checked = [bool]$st.openBrowserOnBoot
    }
  } catch {
    $popupTokens.Text = "Unavailable"
    $popupVerified.Text = "—"
    $popupEstimated.Text = "—"
  }
}

# Timer to check parent Bun server health & update stats
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$script:tickCount = 0
$timer.Add_Tick({
  $proc = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    $notifyIcon.Visible = $false
    $popup.Close()
    $popup.Dispose()
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
    return
  }
  $script:tickCount++
  if ($script:tickCount -eq 1 -or ($script:tickCount % 3 -eq 0)) {
    Update-TrayStatus
  }
})
$timer.Start()

Update-TrayStatus
$notifyIcon.ShowBalloonTip(2500, "Token Larper Running", "Left-click the t. icon for usage; right-click for options.", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
`.trim();

  writeFileSync(TRAY_PS1_PATH, psScript, "utf8");

  // Generate WinSta0\Default desktop trampoline so even sandboxed terminals attach to Explorer's tray
  const launcherScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DefaultDesktopLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public short wShowWindow; public short cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    public static int LaunchOnDefaultDesktop(string cmdLine, string workDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "WinSta0\\\\Default";
        si.dwFlags = 1;
        si.wShowWindow = 0;
        PROCESS_INFORMATION pi;
        uint CREATE_NO_WINDOW = 0x08000000;
        bool ok = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW, IntPtr.Zero, workDir, ref si, out pi);
        if (!ok) return -Marshal.GetLastWin32Error();
        return pi.dwProcessId;
    }
}
"@
$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File \`"${TRAY_PS1_PATH}\`""
$launchedPid = [DefaultDesktopLauncher]::LaunchOnDefaultDesktop($cmd, "${ROOT_DIR}")
Write-Output $launchedPid
`.trim();

  writeFileSync(TRAY_LAUNCHER_PS1, launcherScript, "utf8");
  return TRAY_LAUNCHER_PS1;
}

export async function startSystemTray(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  if (process.env.NO_TRAY === "1") return;

  try {
    const launcherPath = generateTrayScript(port, process.pid);
    const proc = Bun.spawn(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcherPath,
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      }
    );
    const out = (await new Response(proc.stdout).text()).trim();
    const parsedPid = Number(out);
    if (Number.isFinite(parsedPid) && parsedPid > 0) {
      trayPid = parsedPid;
    }
  } catch (err) {
    console.error("Failed to launch system tray icon:", err);
  }
}

export function stopSystemTray(): void {
  if (trayPid && trayPid > 0) {
    try {
      Bun.spawnSync(["taskkill.exe", "/PID", String(trayPid), "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      // ignore
    }
    trayPid = null;
  }
}

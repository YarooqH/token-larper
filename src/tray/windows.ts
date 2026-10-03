import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { flattenPath, LOGO_PATHS } from "../client/logoMark.ts";

const ROOT_DIR = resolve(import.meta.dir, "..", "..");
const SCRIPTS_DIR = join(ROOT_DIR, "scripts");
const TRAY_PS1_PATH = join(SCRIPTS_DIR, "tray-host.ps1");
const TRAY_LAUNCHER_PS1 = join(SCRIPTS_DIR, "launch-on-default-desktop.ps1");

let trayPid: number | null = null;

export function generateTrayScript(port: number, serverPid: number): string {
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  const logoPolygons = [LOGO_PATHS.t, LOGO_PATHS.flame]
    .flatMap((d) => flattenPath(d))
    .map((poly) => `  @(${poly.flat().map((n) => n.toFixed(2)).join(", ")})`)
    .join(",\n");

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

# The Burning t. logo from src/client/logoMark.ts, flattened to polygons in 64-unit
# coordinates. It has no background, so it is black on a light taskbar and white on a
# dark one, and redrawn if that Windows setting changes.
Add-Type -Namespace TokenLarper -Name IconNative -MemberDefinition '[DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);'
$LogoPolygons = @(
${logoPolygons}
)

function Test-LightTaskbar {
  try {
    $value = Get-ItemPropertyValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" -Name SystemUsesLightTheme -ErrorAction Stop
    return ($value -eq 1)
  } catch {
    return $false
  }
}

function New-LogoIcon([bool]$light) {
  $size = [Math]::Max(16, [System.Windows.Forms.SystemInformation]::SmallIconSize.Width)
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform($size / 64, $size / 64)
  $color = if ($light) { [System.Drawing.Color]::FromArgb(255, 20, 20, 20) } else { [System.Drawing.Color]::FromArgb(255, 245, 245, 245) }
  $brush = New-Object System.Drawing.SolidBrush($color)
  # Alternate (even-odd) filling cuts the flame's core out of the flame.
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath([System.Drawing.Drawing2D.FillMode]::Alternate)
  foreach ($poly in $LogoPolygons) {
    $count = [int]($poly.Length / 2)
    $points = New-Object 'System.Drawing.PointF[]' $count
    for ($i = 0; $i -lt $count; $i++) {
      $points[$i] = New-Object System.Drawing.PointF([single]$poly[2 * $i], [single]$poly[2 * $i + 1])
    }
    $path.AddPolygon($points)
  }
  $g.FillPath($brush, $path)
  $path.Dispose()
  $brush.Dispose()
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $bmp.Dispose()
  return $icon
}

$script:lightTaskbar = Test-LightTaskbar
$icon = New-LogoIcon $script:lightTaskbar

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Token Larper - AI Coding Telemetry (Port $ServerPort)"
$notifyIcon.Visible = $true

# Compact left-click popup. Every string comes from /api/tray-status, and its colors come
# from the dashboard's current theme (sent to the server whenever the theme changes).
Add-Type -Namespace TokenLarper -Name Dwm -MemberDefinition '[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);'

function New-PopupLabel([string]$text, [int]$x, [int]$y, [int]$w, [int]$h, [float]$size, [bool]$bold, [string]$align) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($w, $h)
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $label.Font = New-Object System.Drawing.Font("Segoe UI", $size, $style)
  $label.TextAlign = [System.Drawing.ContentAlignment]::$align
  $label.AutoEllipsis = $true
  $popup.Controls.Add($label)
  return $label
}

$popup = New-Object System.Windows.Forms.Form
$popup.Text = "Token Larper"
$popup.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$popup.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$popup.ShowInTaskbar = $false
$popup.TopMost = $true
$popup.KeyPreview = $true
$popup.ClientSize = New-Object System.Drawing.Size(300, 222)

$popupTitle = New-PopupLabel "Token Larper" 20 16 170 22 10 $true "MiddleLeft"
$popupLevel = New-PopupLabel "" 190 16 90 22 9 $true "MiddleRight"
$popupTodayCaption = New-PopupLabel "Today" 20 50 260 18 9 $false "MiddleLeft"
$popupTodayTokens = New-PopupLabel "Loading..." 17 68 160 40 21 $true "MiddleLeft"
$popupTodayCost = New-PopupLabel "" 160 76 120 28 12 $true "MiddleRight"
$popupRule = New-Object System.Windows.Forms.Panel
$popupRule.Location = New-Object System.Drawing.Point(20, 118)
$popupRule.Size = New-Object System.Drawing.Size(260, 1)
$popup.Controls.Add($popupRule)
$popupWeekCaption = New-PopupLabel "Last 7 days" 20 128 110 22 9 $false "MiddleLeft"
$popupWeek = New-PopupLabel "" 120 128 160 22 9 $true "MiddleRight"
$popupAllCaption = New-PopupLabel "All time" 20 152 110 22 9 $false "MiddleLeft"
$popupAll = New-PopupLabel "" 120 152 160 22 9 $true "MiddleRight"
$popupUpdated = New-PopupLabel "" 150 186 130 22 8 $false "MiddleRight"

# A text link instead of a filled button bar; it takes focus so Enter opens the dashboard.
$popupOpen = New-Object System.Windows.Forms.LinkLabel
$popupOpen.Text = "Open dashboard"
$popupOpen.Location = New-Object System.Drawing.Point(20, 186)
$popupOpen.Size = New-Object System.Drawing.Size(130, 22)
$popupOpen.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$popupOpen.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$popupOpen.LinkBehavior = [System.Windows.Forms.LinkBehavior]::HoverUnderline
$popupOpen.TabStop = $true
$popup.Controls.Add($popupOpen)

$script:popupThemeKey = ""
function Set-PopupTheme($theme) {
  # Defaults match the Pine dark theme until the dashboard reports its colors.
  $t = @{ surface = "#1b221e"; text = "#e8eee7"; text2 = "#b5c1b7"; text3 = "#98a59b"; border = "#2e3932"; accent = "#9fcaa8"; gold = "#e1b75c" }
  if ($null -ne $theme) { foreach ($key in @($t.Keys)) { if ($theme.$key) { $t[$key] = [string]$theme.$key } } }
  $key = ($t.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Value }) -join ","
  if ($key -eq $script:popupThemeKey) { return }
  $script:popupThemeKey = $key

  $c = @{}
  foreach ($name in $t.Keys) { $c[$name] = [System.Drawing.ColorTranslator]::FromHtml($t[$name]) }
  $popup.BackColor = $c.surface
  foreach ($label in @($popupTitle, $popupTodayTokens, $popupTodayCost, $popupWeek, $popupAll)) { $label.ForeColor = $c.text }
  foreach ($label in @($popupTodayCaption, $popupWeekCaption, $popupAllCaption, $popupUpdated)) { $label.ForeColor = $c.text3 }
  $popupLevel.ForeColor = $c.gold
  $popupRule.BackColor = $c.border
  $popupOpen.LinkColor = $c.accent
  $popupOpen.ActiveLinkColor = $c.text
  $popupOpen.VisitedLinkColor = $c.accent
  Set-PopupChrome $c.border
}

# Windows 11 draws rounded corners and a hairline border in the theme color; older
# versions ignore both attributes and keep a square window.
function Set-PopupChrome([System.Drawing.Color]$border) {
  try {
    $round = 2
    [TokenLarper.Dwm]::DwmSetWindowAttribute($popup.Handle, 33, [ref]$round, 4) | Out-Null
    $colorRef = [int]$border.R -bor ([int]$border.G -shl 8) -bor ([int]$border.B -shl 16)
    [TokenLarper.Dwm]::DwmSetWindowAttribute($popup.Handle, 34, [ref]$colorRef, 4) | Out-Null
  } catch {}
}
Set-PopupTheme $null

function Open-Dashboard {
  $popup.Hide()
  try {
    Start-Process -FilePath $BaseUrl -ErrorAction Stop
  } catch {
    $notifyIcon.ShowBalloonTip(4000, "Token Larper", "Could not open the browser. Visit $BaseUrl manually.", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
}

$popupOpen.Add_LinkClicked({ Open-Dashboard })
$popup.Add_KeyDown({
  param($sender, $eventArgs)
  if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $popup.Hide()
    $eventArgs.Handled = $true
  } elseif ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    Open-Dashboard
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
  # Refresh first so the numbers and colors are current when it appears.
  Update-TrayStatus
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
      $popupLevel.Text = $st.levelText
      $popupTodayCaption.Text = $st.todayCaptionText
      $popupTodayTokens.Text = $st.todayTokensText
      $popupTodayCost.Text = $st.todayCostText
      $popupWeek.Text = $st.weekText
      $popupAll.Text = $st.allTimeText
      $popupUpdated.Text = $st.updatedText
      Set-PopupTheme $st.theme
      $itemBoot.Checked = [bool]$st.bootEnabled
      $itemOpenOnBoot.Checked = [bool]$st.openBrowserOnBoot
    }
  } catch {
    $popupTodayTokens.Text = "Unavailable"
    $popupTodayCost.Text = ""
    $popupWeek.Text = "--"
    $popupAll.Text = "--"
    $popupUpdated.Text = ""
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
  $nowLight = Test-LightTaskbar
  if ($nowLight -ne $script:lightTaskbar) {
    $script:lightTaskbar = $nowLight
    $oldIcon = $notifyIcon.Icon
    $notifyIcon.Icon = New-LogoIcon $nowLight
    [TokenLarper.IconNative]::DestroyIcon($oldIcon.Handle) | Out-Null
  }
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
        windowsHide: true,
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
        windowsHide: true,
      });
    } catch {
      // ignore
    }
    trayPid = null;
  }
}

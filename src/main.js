const { app, BrowserWindow, clipboard, ipcMain } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'Discord Zoom Messenger',
    backgroundColor: '#17181f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const utf8Script = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $OutputEncoding = [System.Text.Encoding]::UTF8
      ${script}
    `;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', utf8Script],
      { windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function listWindows() {
  const script = `
    Add-Type @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class Win32Rect {
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
      [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
      [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
      [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    }
    public struct RECT {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }
"@
    $items = New-Object System.Collections.Generic.List[object]
    $callback = [Win32Rect+EnumWindowsProc]{
      param([IntPtr]$hWnd, [IntPtr]$lParam)

      if (-not [Win32Rect]::IsWindowVisible($hWnd)) { return $true }

      $len = [Win32Rect]::GetWindowTextLength($hWnd)
      if ($len -le 0) { return $true }

      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [Win32Rect]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
      $title = $sb.ToString().Trim()
      if (-not $title) { return $true }

      $windowPid = 0
      [Win32Rect]::GetWindowThreadProcessId($hWnd, [ref]$windowPid) | Out-Null
      if ($windowPid -le 0) { return $true }

      try { $process = Get-Process -Id $windowPid -ErrorAction Stop } catch { return $true }

      $rect = New-Object RECT
      $hasRect = [Win32Rect]::GetWindowRect($hWnd, [ref]$rect)
      $width = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
      $height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }

      $items.Add([PSCustomObject]@{
        Id = $windowPid
        Hwnd = $hWnd.ToInt64()
        ProcessName = $process.ProcessName
        MainWindowTitle = $title
        Left = if ($hasRect) { $rect.Left } else { 0 }
        Top = if ($hasRect) { $rect.Top } else { 0 }
        Width = $width
        Height = $height
        IsMinimized = [Win32Rect]::IsIconic($hWnd)
        IsMaximized = [Win32Rect]::IsZoomed($hWnd)
      })
      return $true
    }
    [Win32Rect]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    $items |
      Sort-Object ProcessName, MainWindowTitle |
      ConvertTo-Json -Depth 3
  `;
  const out = await runPowerShell(script);
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

ipcMain.handle('windows:list', async () => {
  return listWindows();
});

ipcMain.handle('app:diagnostics', async () => {
  const windows = await listWindows();
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: require('os').release(),
    timestamp: new Date().toISOString(),
    windows,
  };
});

ipcMain.handle('clipboard:writeText', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('windows:detectTargets', async () => {
  const windows = (await listWindows()).filter((w) =>
    !/electron/i.test(w.ProcessName || '') &&
    !/Discord Zoom Messenger/i.test(w.MainWindowTitle || '')
  );
  return {
    discord: windows.filter((w) =>
      /discord/i.test(w.ProcessName || '') || /discord/i.test(w.MainWindowTitle || '')
    ),
    zoom: windows.filter((w) =>
      /zoom/i.test(w.ProcessName || '') || /zoom/i.test(w.MainWindowTitle || '')
    ),
  };
});

ipcMain.handle('windows:focus', async (_event, { pid, hwnd }) => {
  const numericPid = Number(pid);
  const numericHwnd = Number(hwnd);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { ok: false, error: 'Invalid PID' };
  }
  const hasValidHwnd = Number.isInteger(numericHwnd) && numericHwnd > 0;

  const script = `
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
      [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    }
"@
    $p = Get-Process -Id ${numericPid} -ErrorAction Stop
    $targetHwnd = ${hasValidHwnd ? `[IntPtr]${numericHwnd}` : '$p.MainWindowHandle'}
    if ($targetHwnd -eq [IntPtr]::Zero) { throw "Window handle is empty" }
    if ([Win32]::IsIconic($targetHwnd)) {
      [Win32]::ShowWindowAsync($targetHwnd, 9) | Out-Null
    }
    [Win32]::SetForegroundWindow($targetHwnd) | Out-Null
    [PSCustomObject]@{ ok = $true; id = $p.Id; title = $p.MainWindowTitle } | ConvertTo-Json -Depth 3
  `;

  try {
    const out = await runPowerShell(script);
    return JSON.parse(out);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('discord:sendTest', async (_event, { pid, hwnd, message }) => {
  const numericPid = Number(pid);
  const numericHwnd = Number(hwnd);
  const text = String(message || '').trim();

  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { ok: false, error: 'Invalid PID' };
  }
  if (!text) {
    return { ok: false, error: 'Message is empty' };
  }
  const hasValidHwnd = Number.isInteger(numericHwnd) && numericHwnd > 0;

  clipboard.writeText(text);

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32Send {
      [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
      [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
      [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    }
    public struct RECT {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }
"@
    $p = Get-Process -Id ${numericPid} -ErrorAction Stop
    $targetHwnd = ${hasValidHwnd ? `[IntPtr]${numericHwnd}` : '$p.MainWindowHandle'}
    if ($targetHwnd -eq [IntPtr]::Zero) { throw "Window handle is empty" }
    $wasMaximized = [Win32Send]::IsZoomed($targetHwnd)
    if ([Win32Send]::IsIconic($targetHwnd)) {
      [Win32Send]::ShowWindowAsync($targetHwnd, 9) | Out-Null
      Start-Sleep -Milliseconds 250
    }
    if (-not [Win32Send]::IsZoomed($targetHwnd)) {
      [Win32Send]::ShowWindowAsync($targetHwnd, 3) | Out-Null
      Start-Sleep -Milliseconds 350
    }
    [Win32Send]::SetForegroundWindow($targetHwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    $foregroundOk = ([Win32Send]::GetForegroundWindow() -eq $targetHwnd)

    $rect = New-Object RECT
    $hasRect = [Win32Send]::GetWindowRect($targetHwnd, [ref]$rect)
    if (-not $hasRect) { throw "GetWindowRect failed" }

    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $x = [int]($rect.Left + ($width * 0.55))
    $y = [int]($rect.Bottom - 45)

    [Win32Send]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 80
    [Win32Send]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [Win32Send]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120

    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")

    [PSCustomObject]@{
      ok = $true
      id = $p.Id
      title = $p.MainWindowTitle
      hwnd = $targetHwnd.ToInt64()
      foregroundOk = $foregroundOk
      wasMaximized = $wasMaximized
      maximizedForSend = (-not $wasMaximized)
      clickX = $x
      clickY = $y
      width = $width
      height = $height
    } | ConvertTo-Json -Depth 3
  `;

  try {
    const out = await runPowerShell(script);
    return JSON.parse(out);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('zoom:sendTest', async (_event, { pid, hwnd, message, requireConfirmation }) => {
  const numericPid = Number(pid);
  const numericHwnd = Number(hwnd);
  const text = String(message || '').trim();

  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { ok: false, error: 'Invalid PID' };
  }
  if (!text) {
    return { ok: false, error: 'Message is empty' };
  }
  const hasValidHwnd = Number.isInteger(numericHwnd) && numericHwnd > 0;
  const mustConfirm = Boolean(requireConfirmation);

  clipboard.writeText(text);

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class Win32ZoomSend {
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
      [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
      [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
      [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
      [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    }
    public struct RECT {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }
"@

    function Get-ZoomTopWindowsForPid([int]$targetPid) {
      $items = New-Object System.Collections.Generic.List[object]
      $callback = [Win32ZoomSend+EnumWindowsProc]{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32ZoomSend]::IsWindowVisible($hWnd)) { return $true }
        $len = [Win32ZoomSend]::GetWindowTextLength($hWnd)
        if ($len -le 0) { return $true }

        $windowPid = 0
        [Win32ZoomSend]::GetWindowThreadProcessId($hWnd, [ref]$windowPid) | Out-Null
        if ($windowPid -ne $targetPid) { return $true }

        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [Win32ZoomSend]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        $title = $sb.ToString().Trim()
        if (-not $title) { return $true }

        $r = New-Object RECT
        $hasRect = [Win32ZoomSend]::GetWindowRect($hWnd, [ref]$r)
        [void]$items.Add([PSCustomObject]@{
          Title = $title
          Width = if ($hasRect) { $r.Right - $r.Left } else { 0 }
          Height = if ($hasRect) { $r.Bottom - $r.Top } else { 0 }
        })
        return $true
      }
      [Win32ZoomSend]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
      return $items.ToArray()
    }

    function Test-SeparateZoomChat([int]$targetPid) {
      $wins = Get-ZoomTopWindowsForPid $targetPid
      foreach ($w in $wins) {
        if (($w.Title -match 'chat|チャット|ミーティング チャット|ミーティングチャット') -and ($w.Width -gt 120) -and ($w.Height -gt 120)) {
          return $true
        }
      }
      return $false
    }

    function Test-IntegratedChatInput([IntPtr]$hwnd) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { return $false }

        $editCondition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        foreach ($edit in $edits) {
          $name = [string]$edit.Current.Name
          $rect = $edit.Current.BoundingRectangle
          if ($rect.Width -gt 120 -and $rect.Height -gt 20 -and ($name -match 'message|Message|メッセージ|送信|全員')) {
            return $true
          }
        }

        $textCondition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Text
        )
        $texts = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
        foreach ($textElement in $texts) {
          $name = [string]$textElement.Current.Name
          $rect = $textElement.Current.BoundingRectangle
          if ($rect.Width -gt 120 -and $rect.Height -gt 20 -and ($name -match 'メッセージを送信|message')) {
            return $true
          }
        }
      } catch {
        return $false
      }
      return $false
    }

    function Get-ZoomChatInputPoint([IntPtr]$hwnd) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { return $null }

        $windowRect = $root.Current.BoundingRectangle
        $rightPanelLeft = $windowRect.Left + ($windowRect.Width * 0.55)
        $inputAreaTop = $windowRect.Bottom - 190

        $allElements = $root.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants,
          [System.Windows.Automation.Condition]::TrueCondition
        )

        $best = $null
        $bestScore = -1
        foreach ($element in $allElements) {
          try {
            $rect = $element.Current.BoundingRectangle
            if ($rect.Width -lt 80 -or $rect.Height -lt 18) { continue }
            if ($rect.Left -lt $rightPanelLeft) { continue }
            if ($rect.Top -lt $inputAreaTop) { continue }
            if ($rect.Bottom -gt ($windowRect.Bottom + 8)) { continue }

            $name = [string]$element.Current.Name
            $controlType = $element.Current.ControlType.ProgrammaticName
            $score = 0
            if ($controlType -match 'Edit|Document|Text') { $score += 20 }
            if ($name -match 'message|send|everyone|繝｡繝・そ繝ｼ繧ｸ|騾∽ｿ｡|蜈ｨ蜩｡') { $score += 40 }
            $score += [int]($rect.Width / 20)
            $score += [int](200 - [Math]::Abs(($windowRect.Bottom - 80) - (($rect.Top + $rect.Bottom) / 2)))

            if ($score -gt $bestScore) {
              $bestScore = $score
              $best = [PSCustomObject]@{
                x = [int]($rect.Left + ($rect.Width / 2))
                y = [int]($rect.Top + ($rect.Height / 2))
                name = $name
                controlType = $controlType
                width = [int]$rect.Width
                height = [int]$rect.Height
                score = $score
              }
            }
          } catch {
            continue
          }
        }
        return $best
      } catch {
        return $null
      }
    }

    function Invoke-ZoomClick([int]$clickX, [int]$clickY) {
      [Win32ZoomSend]::SetCursorPos($clickX, $clickY) | Out-Null
      Start-Sleep -Milliseconds 80
      [Win32ZoomSend]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 40
      [Win32ZoomSend]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 160
    }

    function Normalize-ZoomText([string]$textValue) {
      if ($null -eq $textValue) { return "" }
      $crlf = [string][char]13 + [string][char]10
      $lf = [string][char]10
      $cr = [string][char]13
      return $textValue.Replace($crlf, $lf).Replace($cr, $lf).Trim()
    }

    function Test-ZoomPastedMessage([string]$expectedText) {
      $sentinel = "__DZNM_SENTINEL_" + [Guid]::NewGuid().ToString("N")
      Set-Clipboard -Value $sentinel
      Start-Sleep -Milliseconds 80
      [System.Windows.Forms.SendKeys]::SendWait("^a")
      Start-Sleep -Milliseconds 80
      [System.Windows.Forms.SendKeys]::SendWait("^c")
      Start-Sleep -Milliseconds 160
      $copiedText = Get-Clipboard -Raw
      $normalizedCopied = Normalize-ZoomText $copiedText
      $normalizedExpected = Normalize-ZoomText $expectedText
      $confirmed = ($normalizedCopied -and $normalizedExpected -and $normalizedCopied.Contains($normalizedExpected))
      if ($confirmed) {
        Set-Clipboard -Value $expectedText
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 160
      }
      return $confirmed
    }

    function Test-ZoomChatPanelOpen([IntPtr]$hwnd) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { return $false }

        $windowRect = $root.Current.BoundingRectangle
        $rightPanelLeft = $windowRect.Left + ($windowRect.Width * 0.58)
        $bottomToolbarTop = $windowRect.Bottom - 130

        $allElements = $root.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants,
          [System.Windows.Automation.Condition]::TrueCondition
        )

        $rightPanelVisibleElementCount = 0
        foreach ($element in $allElements) {
          try {
            $name = [string]$element.Current.Name
            if ($name -and $name -match 'メッセージを送信|メッセージは誰に表示|新しいチャット|ミーティング チャット|全員 にメッセージ|send.*message|message.*send|Who can see') {
              return $true
            }

            $rect = $element.Current.BoundingRectangle
            $isRightPanel = $rect.Left -ge $rightPanelLeft -and $rect.Top -lt $bottomToolbarTop
            if (-not $isRightPanel) { continue }
            if ($rect.Width -lt 40 -or $rect.Height -lt 8) { continue }

            $rightPanelVisibleElementCount++
            if ($rightPanelVisibleElementCount -ge 8) {
              return $true
            }

            if ($name -and $name -match 'メッセージ|全員|チャット|message|chat|everyone') {
              return $true
            }
          } catch {
            continue
          }
        }
      } catch {
        return $false
      }
      return $false
    }

    function Get-ZoomChatButtonState([IntPtr]$hwnd) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { return "unknown" }

        $windowRect = $root.Current.BoundingRectangle
        $bottomToolbarTop = $windowRect.Bottom - 130
        $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Button
        )
        $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)

        foreach ($button in $buttons) {
          try {
            $name = [string]$button.Current.Name
            if (-not $name -or $name -notmatch 'チャット|chat') { continue }

            $rect = $button.Current.BoundingRectangle
            if ($rect.Top -lt $bottomToolbarTop) { continue }
            if ($rect.Width -lt 20 -or $rect.Height -lt 20) { continue }

            $pattern = $null
            if ($button.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
              if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { return "open" }
              if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) { return "closed" }
            }

            $selectionPattern = $null
            if ($button.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
              if ($selectionPattern.Current.IsSelected) { return "open" }
              return "closed"
            }
          } catch {
            continue
          }
        }
      } catch {
        return "unknown"
      }
      return "unknown"
    }

    $p = Get-Process -Id ${numericPid} -ErrorAction Stop
    $targetHwnd = ${hasValidHwnd ? `[IntPtr]${numericHwnd}` : '$p.MainWindowHandle'}
    if ($targetHwnd -eq [IntPtr]::Zero) { throw "Window handle is empty" }
    $wasMaximized = [Win32ZoomSend]::IsZoomed($targetHwnd)
    if ([Win32ZoomSend]::IsIconic($targetHwnd)) {
      [Win32ZoomSend]::ShowWindowAsync($targetHwnd, 9) | Out-Null
      Start-Sleep -Milliseconds 250
    }
    if (-not [Win32ZoomSend]::IsZoomed($targetHwnd)) {
      [Win32ZoomSend]::ShowWindowAsync($targetHwnd, 3) | Out-Null
      Start-Sleep -Milliseconds 350
    }
    [Win32ZoomSend]::SetForegroundWindow($targetHwnd) | Out-Null
    Start-Sleep -Milliseconds 400
    $foregroundOk = ([Win32ZoomSend]::GetForegroundWindow() -eq $targetHwnd)

    $rect = New-Object RECT
    $hasRect = [Win32ZoomSend]::GetWindowRect($targetHwnd, [ref]$rect)
    if (-not $hasRect) { throw "GetWindowRect failed" }

    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 640 -or $height -lt 420) {
      throw "Zoom window is too small. Please restore the normal Zoom meeting window."
    }

    if (Test-SeparateZoomChat $p.Id) {
      throw "Zoom chat is detached. Please merge the chat panel into the right side of the main meeting window."
    }

    $x = [int]($rect.Left + ($width * 0.82))
    $y = [int]($rect.Bottom - 75)

    $chatButtonState = Get-ZoomChatButtonState $targetHwnd
    $messageText = Get-Clipboard -Raw
    $directInputWorked = $false
    $inputPoint = Get-ZoomChatInputPoint $targetHwnd
    $inputPointSource = "fallback"
    if ($null -ne $inputPoint) {
      $x = [int]$inputPoint.x
      $y = [int]$inputPoint.y
      $inputPointSource = "uia"
    }

    Invoke-ZoomClick $x $y
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 160

    $directInputWorked = Test-ZoomPastedMessage $messageText

    if ($directInputWorked) {
      $chatWasOpen = $true
    } elseif ($chatButtonState -eq "open") {
      $chatWasOpen = $true
    } elseif ($chatButtonState -eq "closed") {
      $chatWasOpen = $false
    } else {
      $chatWasOpen = $false
    }
    $openedChat = $false
    if (-not $chatWasOpen) {
      Set-Clipboard -Value $messageText
      [System.Windows.Forms.SendKeys]::SendWait("%h")
      $openedChat = $true
      Start-Sleep -Milliseconds 900

      if (Test-SeparateZoomChat $p.Id) {
        throw "Zoom chat opened as a separate window. Please merge the chat panel into the right side of the main meeting window."
      }

      $chatButtonState = Get-ZoomChatButtonState $targetHwnd
      $inputPoint = Get-ZoomChatInputPoint $targetHwnd
      if ($null -ne $inputPoint) {
        $x = [int]$inputPoint.x
        $y = [int]$inputPoint.y
        $inputPointSource = "uia-after-open"
      }

      Invoke-ZoomClick $x $y
      [System.Windows.Forms.SendKeys]::SendWait("^v")
      Start-Sleep -Milliseconds 160
      $directInputWorked = Test-ZoomPastedMessage $messageText
    $chatWasOpen = $directInputWorked
    }
    $sentWithoutConfirmation = (-not $directInputWorked)
    if (-not $directInputWorked) {
      if (${mustConfirm ? '$true' : '$false'}) {
        throw "Zoom chat input was not confirmed before Enter. inputPointSource=$inputPointSource click=($x,$y). For simultaneous send, Discord was not sent."
      }
      Set-Clipboard -Value $messageText
      Invoke-ZoomClick $x $y
      Start-Sleep -Milliseconds 120
    }
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")

    [PSCustomObject]@{
      ok = $true
      id = $p.Id
      title = $p.MainWindowTitle
      hwnd = $targetHwnd.ToInt64()
      foregroundOk = $foregroundOk
      wasMaximized = $wasMaximized
      maximizedForSend = (-not $wasMaximized)
      clickX = $x
      clickY = $y
      width = $width
      height = $height
      openedChat = $openedChat
      chatInputDetected = $chatWasOpen
      chatButtonState = $chatButtonState
      directInputWorked = $directInputWorked
      sentWithoutConfirmation = $sentWithoutConfirmation
      inputPointSource = $inputPointSource
      inputPoint = $inputPoint
    } | ConvertTo-Json -Depth 3
  `;

  try {
    const out = await runPowerShell(script);
    return JSON.parse(out);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

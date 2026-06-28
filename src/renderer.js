const refreshBtn = document.getElementById('refreshBtn');
const sendBothBtn = document.getElementById('sendBothBtn');
const sendBtn = document.getElementById('sendBtn');
const zoomSendBtn = document.getElementById('zoomSendBtn');
const messageInput = document.getElementById('messageInput');
const discordList = document.getElementById('discordList');
const zoomList = document.getElementById('zoomList');
const allWindows = document.getElementById('allWindows');
const statusLog = document.getElementById('statusLog');
const copyDiagnosticsBtn = document.getElementById('copyDiagnosticsBtn');

let selectedDiscord = null;
let selectedZoom = null;
let separateZoomChat = null;
let zoomMiniWindow = null;
let lastAction = {
  type: 'none',
  at: null,
  messageLength: 0,
  result: null,
};

function logStatus(message) {
  const line = document.createElement('div');
  line.textContent = message;
  statusLog.appendChild(line);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function getStatusLines() {
  return Array.from(statusLog.children).map((line) => line.textContent || '');
}

function rememberAction(type, message, result) {
  lastAction = {
    type,
    at: new Date().toISOString(),
    messageLength: message.length,
    result,
  };
}

function setSendButtonState() {
  const disabled = !messageInput.value.trim();
  sendBothBtn.disabled = disabled;
  sendBtn.disabled = disabled;
  zoomSendBtn.disabled = disabled;
}

function getWindowStateText(win) {
  const size = `${win.Width || 0}x${win.Height || 0}`;
  const state = win.IsMinimized ? '最小化' : win.IsMaximized ? '最大化' : '通常';
  return `${size} / ${state} / x:${win.Left ?? 0}, y:${win.Top ?? 0}`;
}

function isZoomSeparateChatWindow(win) {
  const title = win.MainWindowTitle || '';
  return /zoom/i.test(win.ProcessName || '') && /chat|チャット|ミーティング チャット|ミーティングチャット/i.test(title);
}

function isZoomHelperWindow(win) {
  const title = win.MainWindowTitle || '';
  return /zoom/i.test(win.ProcessName || '') && (
    /^ZPToolBarParentWnd$/i.test(title)
    || /^VideoFrameWnd$/i.test(title)
    || ((win.Width || 0) === 0 && (win.Height || 0) === 0)
  );
}

function isZoomHomeWindow(win) {
  const title = win.MainWindowTitle || '';
  return /zoom/i.test(win.ProcessName || '') && /^Zoom Workplace$/i.test(title);
}

function isZoomMeetingWindow(win) {
  const title = win.MainWindowTitle || '';
  if (!/zoom/i.test(win.ProcessName || '')) return false;
  if (isZoomSeparateChatWindow(win) || isLikelyZoomMiniWindow(win) || isZoomHelperWindow(win) || isZoomHomeWindow(win)) return false;
  return /ミーティング|meeting/i.test(title);
}

function isLikelyZoomMiniWindow(win) {
  return /zoom/i.test(win.ProcessName || '')
    && !isZoomHelperWindow(win)
    && !isZoomSeparateChatWindow(win)
    && !isZoomHomeWindow(win)
    && ((win.Width || 0) < 640 || (win.Height || 0) < 420);
}

function selectZoomMeetingWindow(windows) {
  return windows.find(isZoomMeetingWindow)
    || windows.find((win) => !isZoomSeparateChatWindow(win) && !isLikelyZoomMiniWindow(win) && !isZoomHelperWindow(win) && !isZoomHomeWindow(win))
    || null;
}

function createWindowItem(win, { focusable = false, compactWarnings = false } = {}) {
  const item = document.createElement('div');
  item.className = 'window-item';

  const title = document.createElement('div');
  title.className = 'window-title';
  title.textContent = win.MainWindowTitle || '(タイトルなし)';

  const meta = document.createElement('div');
  meta.className = 'window-meta';
  meta.textContent = `${win.ProcessName} / PID ${win.Id}`;

  const geometry = document.createElement('div');
  geometry.className = isLikelyZoomMiniWindow(win) ? 'window-geometry warn' : 'window-geometry';
  geometry.textContent = getWindowStateText(win);

  item.append(title, meta, geometry);

  if (!compactWarnings && isLikelyZoomMiniWindow(win)) {
    appendWarning(item, 'Zoomミニウィンドウの可能性があります。通常ウィンドウに戻してください。');
  }

  if (!compactWarnings && isZoomSeparateChatWindow(win)) {
    appendWarning(item, 'Zoomチャット別窓です。メインウィンドウ右側に統合してください。');
  }

  if (focusable) {
    const actions = document.createElement('div');
    actions.className = 'window-actions';

    const focusButton = document.createElement('button');
    focusButton.className = 'secondary';
    focusButton.textContent = '前面に出す';
    focusButton.addEventListener('click', async () => {
      focusButton.disabled = true;
      focusButton.textContent = '実行中...';
      try {
          const result = await window.nativeMessenger.focusWindow(win);
        focusButton.textContent = result.ok ? '前面化OK' : '失敗';
        if (!result.ok) logStatus(`前面化失敗: ${result.error}`);
      } finally {
        setTimeout(() => {
          focusButton.disabled = false;
          focusButton.textContent = '前面に出す';
        }, 1200);
      }
    });

    actions.appendChild(focusButton);
    item.appendChild(actions);
  }

  return item;
}

function appendWarning(container, message) {
  const warning = document.createElement('div');
  warning.className = 'window-warning';
  warning.textContent = message;
  container.appendChild(warning);
}

function renderWindowList(container, windows, emptyText, options = {}) {
  container.innerHTML = '';

  if (!windows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  for (const win of windows) {
    container.appendChild(createWindowItem(win, options));
  }
}

function renderZoomCandidates(windows) {
  zoomList.innerHTML = '';

  if (!windows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Zoomらしいウィンドウが見つかりません';
    zoomList.appendChild(empty);
    return;
  }

  if (selectedZoom) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '送信対象';
    zoomList.appendChild(label);
    zoomList.appendChild(createWindowItem(selectedZoom, { focusable: true, compactWarnings: true }));
  }

  const warnings = [];
  if (zoomMiniWindow) warnings.push({ win: zoomMiniWindow, text: 'Zoomがミニウィンドウです。通常ウィンドウに戻してください。' });
  if (separateZoomChat) warnings.push({ win: separateZoomChat, text: 'Zoomチャットが別窓です。メインウィンドウ右側に統合してください。' });

  if (warnings.length) {
    const label = document.createElement('div');
    label.className = 'section-label warning-label';
    label.textContent = '送信を止める可能性がある状態';
    zoomList.appendChild(label);

    for (const warning of warnings) {
      const item = createWindowItem(warning.win, { focusable: true, compactWarnings: true });
      appendWarning(item, warning.text);
      zoomList.appendChild(item);
    }
  }

  if (!selectedZoom && !warnings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Zoomの通常ミーティングウィンドウが見つかりません';
    zoomList.appendChild(empty);
  }
}

async function detectAndRender({ clearLog = false } = {}) {
  if (clearLog) statusLog.innerHTML = '';

  const [targets, windows] = await Promise.all([
    window.nativeMessenger.detectTargets(),
    window.nativeMessenger.listWindows(),
  ]);

  selectedDiscord = targets.discord[0] || null;
  separateZoomChat = targets.zoom.find(isZoomSeparateChatWindow) || null;
  zoomMiniWindow = targets.zoom.find(isLikelyZoomMiniWindow) || null;
  selectedZoom = selectZoomMeetingWindow(targets.zoom);

  renderWindowList(discordList, targets.discord, 'Discordらしいウィンドウが見つかりません', { focusable: true });
  renderZoomCandidates(targets.zoom);
  renderWindowList(allWindows, windows, '表示中のウィンドウがありません');

  if (selectedZoom) logStatus(`Zoom候補: ${selectedZoom.MainWindowTitle}`);
  if (selectedDiscord) logStatus(`Discord候補: ${selectedDiscord.MainWindowTitle}`);
  if (zoomMiniWindow) logStatus('Zoomが小さいウィンドウです。通常ウィンドウに戻してから送信してください。');
  if (separateZoomChat) logStatus('Zoomチャットが別窓です。メインウィンドウ右側に統合してください。');
  if (!selectedZoom || !selectedDiscord) logStatus('ZoomとDiscordの両方が必要です。');

  setSendButtonState();
  return { targets, windows };
}

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '検出中...';
  selectedDiscord = null;
  selectedZoom = null;
  separateZoomChat = null;
  zoomMiniWindow = null;

  try {
    await detectAndRender({ clearLog: true });
  } catch (error) {
    renderWindowList(discordList, [], '検出エラー');
    renderWindowList(zoomList, [], error.message);
    renderWindowList(allWindows, [], error.stack || error.message);
    logStatus(`検出エラー: ${error.message}`);
  } finally {
    setSendButtonState();
    refreshBtn.disabled = false;
    refreshBtn.textContent = '再検出';
  }
}

async function runDiscordSendTest() {
  const message = messageInput.value.trim();
  if (!message) {
    setSendButtonState();
    return;
  }

  sendBtn.disabled = true;
  statusLog.innerHTML = '';
  logStatus('送信前チェック: 最新のウィンドウ状態を再検出します。');

  try {
    await detectAndRender({ clearLog: false });

    if (!selectedDiscord) {
      logStatus('中止: Discordウィンドウが見つかりません。');
      rememberAction('discord-only', message, { ok: false, error: 'Discordウィンドウが見つかりません' });
      return;
    }

    logStatus('Discordへ送信します。');
    const result = await window.nativeMessenger.sendDiscordTest(selectedDiscord, message);

    if (!result.ok) {
      logStatus(`Discord送信失敗: ${result.error}`);
      rememberAction('discord-only', message, result);
      return;
    }

    logStatus(`Discord送信完了: click(${result.clickX}, ${result.clickY})`);
    logStatus(`Discord前面化: ${result.foregroundOk ? 'OK' : 'NG'}`);
    rememberAction('discord-only', message, result);
  } finally {
    setSendButtonState();
  }
}

function shouldBlockZoomSend() {
  if (!selectedZoom) {
    return 'Zoom通常ウィンドウが見つかりません。Zoomを通常ウィンドウで開いてください。';
  }
  if (zoomMiniWindow && selectedZoom.Id === zoomMiniWindow.Id && selectedZoom.MainWindowTitle === zoomMiniWindow.MainWindowTitle) {
    return 'Zoomがミニウィンドウの可能性があります。通常ウィンドウに戻してください。';
  }
  if (separateZoomChat) {
    return 'Zoomチャットが別窓です。メインウィンドウ右側に統合してください。';
  }
  return '';
}

async function runZoomSendTest() {
  const message = messageInput.value.trim();
  if (!message) {
    setSendButtonState();
    return;
  }

  zoomSendBtn.disabled = true;
  sendBtn.disabled = true;
  statusLog.innerHTML = '';
  logStatus('送信前チェック: 最新のウィンドウ状態を再検出します。');

  try {
    await detectAndRender({ clearLog: false });

    const blockReason = shouldBlockZoomSend();
    if (blockReason) {
      logStatus(`中止: ${blockReason}`);
      rememberAction('zoom-only', message, { ok: false, error: blockReason });
      return;
    }

    logStatus('Zoomへ送信します。チャット欄が閉じている場合は開いてから送信します。');
    const result = await window.nativeMessenger.sendZoomTest(selectedZoom, message);

    if (!result.ok) {
      logStatus(`Zoom送信失敗: ${result.error}`);
      rememberAction('zoom-only', message, result);
      return;
    }

    logStatus(`Zoomチャットボタン状態: ${result.chatButtonState || 'unknown'}`);
    logStatus(`Zoom入力欄直接確認: ${result.directInputWorked ? 'OK' : 'NG'}`);
    if (result.inputPointSource) logStatus(`Zoom入力欄座標: ${result.inputPointSource}`);
    if (result.sentWithoutConfirmation) logStatus('注意: Zoom入力欄の確認はできませんでしたが、Enter送信まで実行しました。');
    if (result.openedChat) logStatus('Zoomチャット欄を開きました。');
    if (!result.chatInputDetected) logStatus('注意: Zoomの入力欄をUI検出できませんでした。座標クリックで送信を試しました。');
    logStatus(`Zoom前面化: ${result.foregroundOk ? 'OK' : 'NG'}`);
    logStatus(`Zoom送信操作を実行しました: click(${result.clickX}, ${result.clickY})`);
    rememberAction('zoom-only', message, result);
  } finally {
    setSendButtonState();
  }
}

async function runCombinedSendTest() {
  const message = messageInput.value.trim();
  if (!message) {
    setSendButtonState();
    return;
  }

  sendBothBtn.disabled = true;
  sendBtn.disabled = true;
  zoomSendBtn.disabled = true;
  statusLog.innerHTML = '';
  logStatus('同時送信前チェック: 最新のウィンドウ状態を再検出します。');

  try {
    await detectAndRender({ clearLog: false });

    const blockReason = shouldBlockZoomSend();
    if (blockReason) {
      logStatus(`中止: ${blockReason}`);
      rememberAction('both', message, { ok: false, stage: 'precheck', error: blockReason });
      return;
    }
    if (!selectedDiscord) {
      logStatus('中止: Discordウィンドウが見つかりません。');
      rememberAction('both', message, { ok: false, stage: 'precheck', error: 'Discordウィンドウが見つかりません' });
      return;
    }

    logStatus('1. Zoomへ送信します。');
    const zoomResult = await window.nativeMessenger.sendZoomTest(selectedZoom, message, { requireConfirmation: true });
    if (!zoomResult.ok) {
      logStatus(`Zoom送信失敗: ${zoomResult.error}`);
      logStatus('Discordには送信しません。');
      rememberAction('both', message, { ok: false, stage: 'zoom', zoomResult });
      return;
    }
    logStatus(`Zoomチャットボタン状態: ${zoomResult.chatButtonState || 'unknown'}`);
    logStatus(`Zoom入力欄直接確認: ${zoomResult.directInputWorked ? 'OK' : 'NG'}`);
    if (zoomResult.inputPointSource) logStatus(`Zoom入力欄座標: ${zoomResult.inputPointSource}`);
    if (zoomResult.sentWithoutConfirmation) logStatus('注意: Zoom入力欄の確認はできませんでしたが、Enter送信まで実行しました。');
    if (zoomResult.openedChat) logStatus('Zoomチャット欄を開きました。');
    if (!zoomResult.chatInputDetected) logStatus('注意: Zoomの入力欄をUI検出できませんでした。座標クリックで送信を試しました。');
    logStatus(`Zoom前面化: ${zoomResult.foregroundOk ? 'OK' : 'NG'}`);
    logStatus(`Zoom送信操作を実行しました: click(${zoomResult.clickX}, ${zoomResult.clickY})`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    logStatus('2. Discordへ送信します。');
    const discordResult = await window.nativeMessenger.sendDiscordTest(selectedDiscord, message);
    if (!discordResult.ok) {
      logStatus(`Discord送信失敗: ${discordResult.error}`);
      logStatus('Zoom送信後にDiscord送信で停止しました。必要ならDiscordだけ送信で再試行してください。');
      rememberAction('both', message, { ok: false, stage: 'discord', zoomResult, discordResult });
      return;
    }
    logStatus(`Discord送信完了: click(${discordResult.clickX}, ${discordResult.clickY})`);
    logStatus(`Discord前面化: ${discordResult.foregroundOk ? 'OK' : 'NG'}`);
    logStatus('同時送信完了。');
    rememberAction('both', message, { ok: true, zoomResult, discordResult });
  } finally {
    setSendButtonState();
  }
}

function simplifyWindow(win) {
  return {
    title: win.MainWindowTitle || '',
    process: win.ProcessName || '',
    pid: win.Id,
    hwnd: win.Hwnd,
    size: `${win.Width || 0}x${win.Height || 0}`,
    x: win.Left ?? 0,
    y: win.Top ?? 0,
    minimized: Boolean(win.IsMinimized),
    maximized: Boolean(win.IsMaximized),
    flags: {
      zoomMeeting: isZoomMeetingWindow(win),
      zoomHome: isZoomHomeWindow(win),
      zoomMini: isLikelyZoomMiniWindow(win),
      zoomSeparateChat: isZoomSeparateChatWindow(win),
      zoomHelper: isZoomHelperWindow(win),
    },
  };
}

async function copyDiagnostics() {
  copyDiagnosticsBtn.disabled = true;
  copyDiagnosticsBtn.textContent = 'コピー中...';

  try {
    const diagnostics = await window.nativeMessenger.getDiagnostics();
    const targets = await window.nativeMessenger.detectTargets();
    const report = {
      generatedAt: new Date().toISOString(),
      app: {
        name: diagnostics.appName,
        version: diagnostics.appVersion,
        electron: diagnostics.electronVersion,
        chrome: diagnostics.chromeVersion,
        node: diagnostics.nodeVersion,
        platform: diagnostics.platform,
        arch: diagnostics.arch,
        osRelease: diagnostics.osRelease,
      },
      currentSelection: {
        discord: selectedDiscord ? simplifyWindow(selectedDiscord) : null,
        zoom: selectedZoom ? simplifyWindow(selectedZoom) : null,
        zoomMiniWindow: zoomMiniWindow ? simplifyWindow(zoomMiniWindow) : null,
        separateZoomChat: separateZoomChat ? simplifyWindow(separateZoomChat) : null,
      },
      detectedTargets: {
        discord: targets.discord.map(simplifyWindow),
        zoom: targets.zoom.map(simplifyWindow),
      },
      lastAction,
      statusLog: getStatusLines(),
      allWindows: diagnostics.windows.map(simplifyWindow),
      note: '送信メッセージ本文は含めていません。messageLengthのみ記録しています。',
    };

    const text = [
      'Discord Zoom Messenger 診断ログ',
      '```json',
      JSON.stringify(report, null, 2),
      '```',
    ].join('\n');

    await window.nativeMessenger.writeClipboardText(text);
    logStatus('診断ログをクリップボードにコピーしました。');
    copyDiagnosticsBtn.textContent = 'コピーしました';
  } catch (error) {
    logStatus(`診断ログコピー失敗: ${error.message}`);
    copyDiagnosticsBtn.textContent = 'コピー失敗';
  } finally {
    setTimeout(() => {
      copyDiagnosticsBtn.disabled = false;
      copyDiagnosticsBtn.textContent = '診断ログをコピー';
    }, 1400);
  }
}

refreshBtn.addEventListener('click', refresh);
sendBothBtn.addEventListener('click', runCombinedSendTest);
sendBtn.addEventListener('click', runDiscordSendTest);
zoomSendBtn.addEventListener('click', runZoomSendTest);
copyDiagnosticsBtn.addEventListener('click', copyDiagnostics);
messageInput.addEventListener('input', setSendButtonState);
refresh();

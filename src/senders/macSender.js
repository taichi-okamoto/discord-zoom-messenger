function notImplemented() {
  return {
    ok: false,
    error: 'macOS sender is not implemented yet.',
  };
}

function registerHandlers({ app, clipboard, ipcMain }) {
  ipcMain.handle('windows:list', async () => []);

  ipcMain.handle('app:diagnostics', async () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: require('os').release(),
    timestamp: new Date().toISOString(),
    windows: [],
    note: 'macOS sender is not implemented yet.',
  }));

  ipcMain.handle('clipboard:writeText', async (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('windows:detectTargets', async () => ({
    discord: [],
    zoom: [],
  }));

  ipcMain.handle('windows:focus', async () => notImplemented());
  ipcMain.handle('discord:sendTest', async () => notImplemented());
  ipcMain.handle('zoom:sendTest', async () => notImplemented());
}

module.exports = {
  registerHandlers,
};

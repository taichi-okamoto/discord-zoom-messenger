const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeMessenger', {
  listWindows: () => ipcRenderer.invoke('windows:list'),
  detectTargets: () => ipcRenderer.invoke('windows:detectTargets'),
  focusWindow: (target) => ipcRenderer.invoke('windows:focus', {
    pid: typeof target === 'object' ? target.Id : target,
    hwnd: typeof target === 'object' ? target.Hwnd : undefined,
  }),
  sendDiscordTest: (target, message) => ipcRenderer.invoke('discord:sendTest', {
    pid: typeof target === 'object' ? target.Id : target,
    hwnd: typeof target === 'object' ? target.Hwnd : undefined,
    message,
  }),
  sendZoomTest: (target, message, options = {}) => ipcRenderer.invoke('zoom:sendTest', {
    pid: typeof target === 'object' ? target.Id : target,
    hwnd: typeof target === 'object' ? target.Hwnd : undefined,
    message,
    requireConfirmation: Boolean(options.requireConfirmation),
  }),
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
});

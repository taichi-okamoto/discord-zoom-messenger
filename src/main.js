const { app, BrowserWindow, clipboard, ipcMain } = require('electron');
const path = require('path');

const sender = process.platform === 'darwin'
  ? require('./senders/macSender')
  : require('./senders/windowsSender');

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

sender.registerHandlers({ app, clipboard, ipcMain });

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

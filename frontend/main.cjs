const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide the menu bar
  mainWindow.setMenuBarVisibility(false);

  // Load the live UI running at the specified address
  mainWindow.loadURL('http://14.195.152.244:9013');

  // Implement the will-download session handler
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    // Get default download location and filename
    const defaultPath = path.join(app.getPath('downloads'), item.getFilename());

    // Prompt the user with a system Save As dialog
    const filePath = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save File As',
      defaultPath: defaultPath,
    });

    if (filePath) {
      item.setSavePath(filePath);
    } else {
      // If the user cancels the dialog, cancel the download
      item.cancel();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

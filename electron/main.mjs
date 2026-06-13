import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopSyncService } from './desktop-service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const appRoot = path.resolve(__dirname, '..');

app.setName('ClipVault');
if (process.platform === 'win32') {
  app.setAppUserModelId('io.clipvault.desktop');
}
app.setPath('userData', path.join(app.getPath('appData'), 'ClipVault'));

let mainWindow = null;
let tray = null;
let forceQuit = false;
let service = null;

const logStartupError = async (error) => {
  const logPath = path.join(app.getPath('userData'), 'clipvault-startup.log');
  const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `[${new Date().toISOString()}]\n${message}\n\n`, 'utf8');
};

const getAutostartPath = () => path.join(os.homedir(), '.config', 'autostart', 'clipvault.desktop');

const applyDesktopAutostart = async (settings) => {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      path: process.execPath,
    });
    return;
  }

  if (process.platform !== 'linux') {
    return;
  }

  const filePath = getAutostartPath();
  if (!settings.launchAtStartup) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ClipVault',
    `Exec=${process.execPath}`,
    'X-GNOME-Autostart-enabled=true',
  ].join('\n');
  await fs.writeFile(filePath, desktopEntry, 'utf8');
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1180,
    minHeight: 780,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    icon: service.getTrayIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (forceQuit || !service?.getState().settings.minimizeToTray) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('minimize', (event) => {
    if (!service?.getState().settings.minimizeToTray) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  try {
    if (isDev) {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'dist', 'index.html')
        : path.join(appRoot, 'dist', 'index.html');
      await mainWindow.loadFile(indexPath);
    }
  } catch (error) {
    await logStartupError(error);
    mainWindow.show();
    throw error;
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
};

const buildTray = () => {
  tray = new Tray(service.getTrayIcon());
  const openWindow = () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  };

  tray.setToolTip('ClipVault');
  tray.on('double-click', openWindow);

  const refreshMenu = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开主界面', click: openWindow },
        { label: '断开全部连接', click: () => void service.disconnectAll() },
        { type: 'separator' },
        {
          label: '退出 ClipVault',
          click: () => {
            forceQuit = true;
            app.quit();
          },
        },
      ]),
    );
  };

  refreshMenu();
};

const wireIpc = () => {
  ipcMain.handle('clipvault:start', async () => service.getState());
  ipcMain.handle('clipvault:get-state', async () => service.getState());
  ipcMain.handle('clipvault:refresh-pairing', async () => service.refreshPairing());
  ipcMain.handle('clipvault:connect', async (_event, payload) => service.connectWithPayload(payload));
  ipcMain.handle('clipvault:disconnect-peer', async (_event, peerId) => service.disconnectPeer(peerId));
  ipcMain.handle('clipvault:disconnect-all', async () => service.disconnectAll());
  ipcMain.handle('clipvault:copy-history', async (_event, entryId) => service.copyHistory(entryId));
  ipcMain.handle('clipvault:delete-history', async (_event, entryId) => service.deleteHistory(entryId));
  ipcMain.handle('clipvault:clear-history', async () => service.clearHistory());
  ipcMain.handle('clipvault:update-settings', async (_event, patch) => service.updateSettings(patch));
  ipcMain.handle('clipvault:open-permission-guide', async () => service.openPermissionGuide());
};

const registerHotkey = () => {
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
};

app.whenReady().then(async () => {
  service = new DesktopSyncService({
    dataRoot: path.join(app.getPath('userData'), 'clipvault'),
    appName: 'ClipVault',
    onSettingsChanged: applyDesktopAutostart,
  });
  await service.init();
  await applyDesktopAutostart(service.getState().settings);
  wireIpc();
  await createWindow();
  buildTray();
  registerHotkey();

  service.on('stateChanged', (state) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('clipvault:state-changed', state);
    });
  });
}).catch((error) => {
  void logStartupError(error).finally(() => app.quit());
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
    return;
  }
  mainWindow?.show();
});

app.on('before-quit', () => {
  forceQuit = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

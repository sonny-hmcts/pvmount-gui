import path from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron';
import { AppController } from './services/app-controller.js';
import { AzureKeyVaultSyncService } from './services/azure-key-vault-sync-service.js';
import { FileSystemEnvironmentStore } from './services/file-system-environment-store.js';
import { MacOsPrivilegeService } from './services/macos-privilege-service.js';
import { buildAppPaths } from './services/path-utils.js';
import { registerIpc } from './ipc/register-ipc.js';
import { Logger } from './utils/logger.js';
import { MacOsMountService } from './platforms/macos/macos-mount-service.js';
import { LinuxMountService } from './platforms/linux/linux-mount-service.js';

async function bootstrap(): Promise<void> {
  app.setName('PVMount GUI');
  await app.whenReady();
  setDevelopmentDockIcon();

  const logger = new Logger();
  const paths = buildAppPaths(app.getPath('userData'));
  const syncService = new AzureKeyVaultSyncService();
  const store = new FileSystemEnvironmentStore(paths);
  const mountService = process.platform === 'darwin'
    ? new MacOsMountService(new MacOsPrivilegeService(), logger)
    : new LinuxMountService();
  const controller = new AppController(syncService, store, mountService, logger);

  setApplicationMenu(paths);
  registerIpc(controller);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

function setDevelopmentDockIcon(): void {
  if (process.platform !== 'darwin' || !process.env.VITE_DEV_SERVER_URL || !app.dock) {
    return;
  }

  const iconPath = path.join(app.getAppPath(), 'build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

function setApplicationMenu(paths: { dataRoot: string; logsRoot: string }): void {
  const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${app.name}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${app.name}` }
      ]
    },
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => BrowserWindow.getFocusedWindow()?.reload()
        },
        {
          label: 'Open App Data Folder',
          click: () => {
            void shell.openPath(paths.dataRoot);
          }
        },
        {
          label: 'Open Logs Folder',
          click: () => {
            void shell.openPath(paths.logsRoot);
          }
        },
        ...(isDevelopment
          ? [
              { type: 'separator' as const },
              {
                label: 'Toggle Developer Tools',
                accelerator: 'Alt+Command+I',
                click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
              }
            ]
          : [])
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    title: 'PVMount GUI',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
}

void bootstrap();

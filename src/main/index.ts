import path from 'node:path';
import { app, BrowserWindow } from 'electron';
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
  await app.whenReady();

  const logger = new Logger();
  const paths = buildAppPaths(app.getPath('userData'));
  const syncService = new AzureKeyVaultSyncService();
  const store = new FileSystemEnvironmentStore(paths);
  const mountService = process.platform === 'darwin'
    ? new MacOsMountService(new MacOsPrivilegeService(), logger)
    : new LinuxMountService();
  const controller = new AppController(syncService, store, mountService, logger);

  registerIpc(controller);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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

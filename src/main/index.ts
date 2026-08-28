import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
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

const APP_DESCRIPTION = 'Local macOS-first GUI for syncing Azure Key Vault secrets into the pvmount workspace contract.';
const APP_REPOSITORY_URL = 'https://github.com/sonny-hmcts/pvmount-gui';
const USER_DATA_FOLDER_NAME = 'pvmount-gui';
const DEVELOPMENT_SESSION_DATA_FOLDER_NAME = 'pvmount-gui-dev-session';
const OPEN_DEVTOOLS_ENV = 'PVMOUNT_OPEN_DEVTOOLS';
let aboutWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  app.setName('PVMount GUI');
  configureDevelopmentSessionDataPath();
  await app.whenReady();
  await configureUserDataPath();
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

async function configureUserDataPath(): Promise<void> {
  const currentUserDataPath = app.getPath('userData');
  const stableUserDataPath = path.join(app.getPath('appData'), USER_DATA_FOLDER_NAME);

  if (currentUserDataPath === stableUserDataPath) {
    return;
  }

  const stableDataRoot = path.join(stableUserDataPath, 'data');
  const currentDataRoot = path.join(currentUserDataPath, 'data');
  if (!(await pathExists(stableDataRoot)) && await pathExists(currentDataRoot)) {
    await fs.mkdir(stableUserDataPath, { recursive: true });
    await fs.cp(currentDataRoot, stableDataRoot, { recursive: true });
  }

  app.setPath('userData', stableUserDataPath);
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
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => {
            void showAboutWindow();
          }
        },
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
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
        }
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

async function showAboutWindow(): Promise<void> {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const aboutIconPath = path.join(app.getAppPath(), 'build/icon.png');
  const aboutIcon = nativeImage.createFromPath(aboutIconPath);
  const iconUrl = aboutIcon.isEmpty() ? '' : aboutIcon.toDataURL();
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>About ${escapeHtml(app.name)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --surface: rgba(255, 252, 246, 0.92);
        --text: #173229;
        --muted: #50665e;
        --accent: #0e6a4a;
        --border: rgba(23, 50, 41, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(14, 106, 74, 0.16), transparent 36%),
          linear-gradient(180deg, #fbf6ed 0%, var(--bg) 100%);
        color: var(--text);
      }
      .shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(520px, 100%);
        padding: 28px;
        border-radius: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow: 0 18px 44px rgba(23, 50, 41, 0.12);
      }
      .hero {
        display: flex;
        gap: 18px;
        align-items: center;
        margin-bottom: 20px;
      }
      .hero img {
        width: 72px;
        height: 72px;
        border-radius: 18px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }
      .version {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      p {
        margin: 0 0 16px;
        line-height: 1.55;
      }
      .meta {
        display: grid;
        gap: 10px;
        margin: 18px 0 22px;
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.6);
        border: 1px solid var(--border);
      }
      .meta strong {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      a:hover { text-decoration: underline; }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: #fff;
        color: var(--text);
        cursor: pointer;
        font: inherit;
      }
      .button-primary {
        background: var(--accent);
        color: #fff;
        border-color: transparent;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        <div class="hero">
          <img src="${iconUrl}" alt="${escapeHtml(app.name)} icon" />
          <div>
            <h1>${escapeHtml(app.name)}</h1>
            <p class="version">Version ${escapeHtml(app.getVersion())}</p>
          </div>
        </div>
        <p>${escapeHtml(APP_DESCRIPTION)}</p>
        <div class="meta">
          <div>
            <strong>Repository</strong>
            <a href="${APP_REPOSITORY_URL}">${APP_REPOSITORY_URL}</a>
          </div>
          <div>
            <strong>Author</strong>
            <span>Sonny Lloyd</span>
          </div>
        </div>
        <div class="actions">
          <button class="button" id="close-button" type="button">Close</button>
          <a class="button button-primary" href="${APP_REPOSITORY_URL}">Open Repository</a>
        </div>
      </section>
    </main>
    <script>
      document.getElementById('close-button')?.addEventListener('click', () => window.close());
    </script>
  </body>
</html>`;

  aboutWindow = new BrowserWindow({
    width: 620,
    height: 500,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${app.name}`,
    ...(parentWindow ? { parent: parentWindow, modal: true } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== aboutWindow?.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  await aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  aboutWindow.show();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
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
    if (process.env[OPEN_DEVTOOLS_ENV] === '1') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
}

void bootstrap();

function configureDevelopmentSessionDataPath(): void {
  if (!process.env.VITE_DEV_SERVER_URL) {
    return;
  }

  const sessionDataPath = path.join(app.getPath('appData'), DEVELOPMENT_SESSION_DATA_FOLDER_NAME);
  mkdirSync(sessionDataPath, { recursive: true });
  app.setPath('sessionData', sessionDataPath);
}

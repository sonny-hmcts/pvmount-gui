import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc.js';
import type { AppController } from '../services/app-controller.js';

export function registerIpc(controller: AppController): void {
  ipcMain.handle(IPC_CHANNELS.getDashboardState, () => controller.getDashboardState());
  ipcMain.handle(IPC_CHANNELS.runSetupChecks, () => controller.runSetupChecks());
  ipcMain.handle(IPC_CHANNELS.ensureMountReady, () => controller.ensureMountReady());
  ipcMain.handle(IPC_CHANNELS.listSubscriptions, () => controller.listSubscriptions());
  ipcMain.handle(IPC_CHANNELS.discoverNamespaces, (_event, subscriptionId) => controller.discoverNamespaces(subscriptionId));
  ipcMain.handle(IPC_CHANNELS.syncEnvironment, (_event, input) => controller.syncEnvironment(input));
  ipcMain.handle(IPC_CHANNELS.deleteNamespace, (_event, input) => controller.deleteNamespace(input));
  ipcMain.handle(IPC_CHANNELS.deleteEnvironment, (_event, input) => controller.deleteEnvironment(input));
  ipcMain.handle(IPC_CHANNELS.createVariant, (_event, input) => controller.createVariant(input));
  ipcMain.handle(IPC_CHANNELS.renameVariant, (_event, input) => controller.renameVariant(input));
  ipcMain.handle(IPC_CHANNELS.deleteVariant, (_event, input) => controller.deleteVariant(input));
  ipcMain.handle(IPC_CHANNELS.activateTarget, (_event, input) => controller.activateTarget(input));
  ipcMain.handle(IPC_CHANNELS.listSecrets, (_event, input) => controller.listSecrets(input));
  ipcMain.handle(IPC_CHANNELS.disableSecret, (_event, input) => controller.disableSecret(input));
  ipcMain.handle(IPC_CHANNELS.restoreSecret, (_event, input) => controller.restoreSecret(input));
  ipcMain.handle(IPC_CHANNELS.diagnostics, () => controller.getDiagnostics());
}

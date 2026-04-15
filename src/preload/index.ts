import { contextBridge, ipcRenderer } from 'electron';
import type { PvmountApi } from '../shared/types.js';

const IPC_CHANNELS = {
  getDashboardState: 'app:get-dashboard-state',
  runSetupChecks: 'app:run-setup-checks',
  ensureMountReady: 'app:ensure-mount-ready',
  listSubscriptions: 'app:list-subscriptions',
  discoverNamespaces: 'app:discover-namespaces',
  syncEnvironment: 'app:sync-environment',
  deleteNamespace: 'app:delete-namespace',
  deleteEnvironment: 'app:delete-environment',
  createVariant: 'app:create-variant',
  renameVariant: 'app:rename-variant',
  deleteVariant: 'app:delete-variant',
  activateTarget: 'app:activate-target',
  listSecrets: 'app:list-secrets',
  disableSecret: 'app:disable-secret',
  restoreSecret: 'app:restore-secret',
  diagnostics: 'app:get-diagnostics'
} as const;

const api: PvmountApi = {
  getDashboardState: () => ipcRenderer.invoke(IPC_CHANNELS.getDashboardState),
  runSetupChecks: () => ipcRenderer.invoke(IPC_CHANNELS.runSetupChecks),
  ensureMountReady: () => ipcRenderer.invoke(IPC_CHANNELS.ensureMountReady),
  listSubscriptions: () => ipcRenderer.invoke(IPC_CHANNELS.listSubscriptions),
  discoverNamespaces: (subscriptionId) => ipcRenderer.invoke(IPC_CHANNELS.discoverNamespaces, subscriptionId),
  syncEnvironment: (input) => ipcRenderer.invoke(IPC_CHANNELS.syncEnvironment, input),
  deleteNamespace: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteNamespace, input),
  deleteEnvironment: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteEnvironment, input),
  createVariant: (input) => ipcRenderer.invoke(IPC_CHANNELS.createVariant, input),
  renameVariant: (input) => ipcRenderer.invoke(IPC_CHANNELS.renameVariant, input),
  deleteVariant: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteVariant, input),
  activateTarget: (input) => ipcRenderer.invoke(IPC_CHANNELS.activateTarget, input),
  listSecrets: (input) => ipcRenderer.invoke(IPC_CHANNELS.listSecrets, input),
  disableSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.disableSecret, input),
  restoreSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.restoreSecret, input),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics)
};

contextBridge.exposeInMainWorld('pvmount', api);

declare global {
  interface Window {
    pvmount?: PvmountApi;
  }
}

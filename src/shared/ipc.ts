export const IPC_CHANNELS = {
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

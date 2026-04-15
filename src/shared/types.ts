export type PlatformId = 'macos' | 'linux';

export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  action?: string;
}

export interface SetupState {
  platform: PlatformId;
  checks: SetupCheck[];
  requiresAdmin: boolean;
}

export interface SyncSummary {
  startedAt: string;
  completedAt: string;
  secretCount: number;
  vaultName: string;
}

export interface EnvironmentRef {
  namespace: string;
  environment: string;
}

export interface VariantRef extends EnvironmentRef {
  variant: string;
}

export interface BaseEnvironmentRecord {
  kind: 'base';
  namespace: string;
  environment: string;
  vaultName: string;
  filesPath: string;
  lastSyncedAt?: string;
  lastSyncResult?: SyncSummary;
  secretCount: number;
}

export interface VariantRecord {
  kind: 'variant';
  namespace: string;
  environment: string;
  variant: string;
  filesPath: string;
  baseFilesPath: string;
  disabledSecretNames: string[];
  createdAt: string;
  updatedAt: string;
}

export type EnvironmentTargetRecord = BaseEnvironmentRecord | VariantRecord;

export type SecretState = 'present' | 'disabled' | 'changed';

export interface SecretItem {
  name: string;
  state: SecretState;
  presentInBase: boolean;
  presentInTarget: boolean;
}

export interface NamespaceOverview {
  namespace: string;
  activeTargetPath?: string;
  activeLabel?: string;
  environments: BaseEnvironmentRecord[];
  variants: VariantRecord[];
}

export interface DashboardState {
  setup: SetupState;
  namespaces: NamespaceOverview[];
  logs: LogEntry[];
}

export interface SyncEnvironmentInput extends EnvironmentRef {
  vaultName?: string;
}
export interface DeleteEnvironmentInput extends EnvironmentRef {}
export interface DeleteNamespaceInput {
  namespace: string;
}

export interface AzureSubscription {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface DiscoveredEnvironment {
  environment: string;
  vaultName: string;
}

export interface DiscoveredNamespace {
  namespace: string;
  environments: DiscoveredEnvironment[];
}

export interface CreateVariantInput extends EnvironmentRef {
  variant: string;
}

export interface RenameVariantInput extends VariantRef {
  nextVariant: string;
}

export interface DeleteVariantInput extends VariantRef {}

export interface ActivateTargetInput {
  namespace: string;
  target:
    | { type: 'base'; environment: string }
    | { type: 'variant'; environment: string; variant: string };
}

export interface SecretMutationInput extends VariantRef {
  secretName: string;
}

export interface DiagnosticsState {
  platform: PlatformId;
  mountRoot: string;
  expectedApplicationPath: string;
  syntheticAliasPath?: string;
  isReady: boolean;
  detail: string;
  activeTargets: Record<string, string>;
  lastSyncResults: Record<string, SyncSummary | undefined>;
}

export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, string>;
}

export interface PvmountApi {
  getDashboardState(): Promise<DashboardState>;
  runSetupChecks(): Promise<SetupState>;
  ensureMountReady(): Promise<DiagnosticsState>;
  listSubscriptions(): Promise<AzureSubscription[]>;
  discoverNamespaces(subscriptionId?: string): Promise<DiscoveredNamespace[]>;
  syncEnvironment(input: SyncEnvironmentInput): Promise<DashboardState>;
  deleteNamespace(input: DeleteNamespaceInput): Promise<DashboardState>;
  deleteEnvironment(input: DeleteEnvironmentInput): Promise<DashboardState>;
  createVariant(input: CreateVariantInput): Promise<DashboardState>;
  renameVariant(input: RenameVariantInput): Promise<DashboardState>;
  deleteVariant(input: DeleteVariantInput): Promise<DashboardState>;
  activateTarget(input: ActivateTargetInput): Promise<DashboardState>;
  listSecrets(target: ActivateTargetInput['target'] & { namespace: string }): Promise<SecretItem[]>;
  disableSecret(input: SecretMutationInput): Promise<SecretItem[]>;
  restoreSecret(input: SecretMutationInput): Promise<SecretItem[]>;
  getDiagnostics(): Promise<DiagnosticsState>;
}

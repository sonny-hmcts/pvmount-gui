import type {
  ActivateTargetInput,
  AzureSubscription,
  BaseEnvironmentRecord,
  SyncEnvironmentInput,
  DiscoveredNamespace,
  DiagnosticsState,
  EnvironmentRef,
  SecretItem,
  SetupState,
  SyncSummary,
  VariantRecord,
  VariantRef
} from '../../shared/types.js';

export interface AppPaths {
  dataRoot: string;
  logsRoot: string;
}

export interface SyncedSecret {
  name: string;
  value: string;
}

export interface SyncResult {
  vaultName: string;
  secrets: SyncedSecret[];
  summary: SyncSummary;
}

export interface SecretSyncService {
  syncEnvironment(input: SyncEnvironmentInput): Promise<SyncResult>;
  isAzureCliAvailable(): Promise<boolean>;
  isAzureLoggedIn(): Promise<boolean>;
  listSubscriptions(): Promise<AzureSubscription[]>;
  discoverNamespaces(subscriptionId?: string): Promise<DiscoveredNamespace[]>;
}

export interface EnvironmentStore {
  listBases(namespace?: string): Promise<BaseEnvironmentRecord[]>;
  listVariants(namespace?: string): Promise<VariantRecord[]>;
  saveBaseSync(input: EnvironmentRef, syncResult: SyncResult): Promise<BaseEnvironmentRecord>;
  deleteNamespace(namespace: string): Promise<void>;
  deleteEnvironment(input: EnvironmentRef): Promise<void>;
  createVariant(input: VariantRef): Promise<VariantRecord>;
  renameVariant(input: VariantRef, nextVariant: string): Promise<VariantRecord>;
  deleteVariant(input: VariantRef): Promise<void>;
  getBase(input: EnvironmentRef): Promise<BaseEnvironmentRecord>;
  getVariant(input: VariantRef): Promise<VariantRecord>;
  getTargetFilesPath(target: ActivateTargetInput['target'] & { namespace: string }): Promise<string>;
  listSecrets(target: ActivateTargetInput['target'] & { namespace: string }): Promise<SecretItem[]>;
  disableSecret(input: VariantRef & { secretName: string }): Promise<SecretItem[]>;
  restoreSecret(input: VariantRef & { secretName: string }): Promise<SecretItem[]>;
  listLastSyncResults(): Promise<Record<string, SyncSummary | undefined>>;
}

export interface MountPlan {
  mountRoot: string;
  applicationPath: string;
  syntheticAliasPath?: string;
  needsSyntheticAlias: boolean;
}

export interface PlatformMountService {
  getPlan(): MountPlan;
  runChecks(): Promise<SetupState>;
  ensureReady(): Promise<DiagnosticsState>;
  activateNamespace(namespace: string, targetPath: string): Promise<void>;
  deactivateNamespace(namespace: string): Promise<void>;
  getActiveTargets(): Promise<Record<string, string>>;
}

export interface PrivilegeService {
  ensureMountRoot(plan: MountPlan): Promise<void>;
}

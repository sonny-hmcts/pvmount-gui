import os from 'node:os';
import type {
  ActivateTargetInput,
  DashboardState,
  DiagnosticsState,
  EnvironmentRef,
  SecretItem,
  SyncEnvironmentInput,
  SetupState
} from '../../shared/types.js';
import { AppError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';
import type { EnvironmentStore, PlatformMountService, SecretSyncService } from './contracts.js';

export class AppController {
  public constructor(
    private readonly syncService: SecretSyncService,
    private readonly store: EnvironmentStore,
    private readonly mountService: PlatformMountService,
    private readonly logger: Logger
  ) {}

  public async getDashboardState(): Promise<DashboardState> {
    return {
      setup: await this.runSetupChecks(),
      namespaces: await this.buildNamespaces(),
      logs: this.logger.list()
    };
  }

  public async runSetupChecks(): Promise<SetupState> {
    const mountChecks = await this.mountService.runChecks();
    const azureCliAvailable = await this.syncService.isAzureCliAvailable();
    const azureLoggedIn = azureCliAvailable ? await this.syncService.isAzureLoggedIn() : false;
    return {
      platform: os.platform() === 'darwin' ? 'macos' : 'linux',
      requiresAdmin: mountChecks.requiresAdmin,
      checks: [
        {
          key: 'azure-cli',
          label: 'Azure CLI installed',
          ok: azureCliAvailable,
          detail: azureCliAvailable ? 'The az command is available.' : 'Install Azure CLI before syncing secrets.',
          ...(!azureCliAvailable ? { action: 'Install Azure CLI' } : {})
        },
        {
          key: 'azure-login',
          label: 'Azure login state',
          ok: azureLoggedIn,
          detail: azureLoggedIn ? 'Azure CLI account is authenticated.' : "Run 'az login' in a terminal.",
          ...(!azureLoggedIn ? { action: 'Run az login' } : {})
        },
        ...mountChecks.checks
      ]
    };
  }

  public async ensureMountReady(): Promise<DiagnosticsState> {
    const diagnostics = await this.mountService.ensureReady();
    diagnostics.lastSyncResults = await this.store.listLastSyncResults();
    return diagnostics;
  }

  public async listSubscriptions() {
    return this.syncService.listSubscriptions();
  }

  public async discoverNamespaces(subscriptionId?: string) {
    return this.syncService.discoverNamespaces(subscriptionId);
  }

  public async syncEnvironment(input: SyncEnvironmentInput): Promise<DashboardState> {
    const canonicalInput = canonicalizeSyncInput(input);
    this.logger.info('Sync started', { namespace: canonicalInput.namespace, environment: canonicalInput.environment });
    const result = await this.syncService.syncEnvironment(canonicalInput);
    await this.store.saveBaseSync(canonicalInput, result);
    this.logger.info('Sync completed', {
      namespace: canonicalInput.namespace,
      environment: canonicalInput.environment,
      secretCount: String(result.summary.secretCount)
    });
    return this.getDashboardState();
  }

  public async deleteNamespace(input: { namespace: string }): Promise<DashboardState> {
    const activeTargets = await this.mountService.getActiveTargets();
    if (activeTargets[input.namespace]) {
      await this.mountService.deactivateNamespace(input.namespace);
      this.logger.info('Namespace activation removed before local namespace deletion', {
        namespace: input.namespace
      });
    }

    await this.store.deleteNamespace(input.namespace);
    this.logger.info('Local namespace deleted', {
      namespace: input.namespace
    });
    return this.getDashboardState();
  }

  public async deleteEnvironment(input: EnvironmentRef): Promise<DashboardState> {
    const [base, variants, activeTargets] = await Promise.all([
      this.store.getBase(input),
      this.store.listVariants(input.namespace),
      this.mountService.getActiveTargets()
    ]);

    const relatedVariantPaths = new Set(
      variants
        .filter((variant) => variant.environment === input.environment)
        .map((variant) => variant.filesPath)
    );

    const activeTargetPath = activeTargets[input.namespace];
    if (activeTargetPath === base.filesPath || (activeTargetPath && relatedVariantPaths.has(activeTargetPath))) {
      await this.mountService.deactivateNamespace(input.namespace);
      this.logger.info('Namespace activation removed before local environment deletion', {
        namespace: input.namespace,
        environment: input.environment
      });
    }

    await this.store.deleteEnvironment(input);
    this.logger.info('Local environment deleted', {
      namespace: input.namespace,
      environment: input.environment
    });
    return this.getDashboardState();
  }

  public async createVariant(input: { namespace: string; environment: string; variant: string }): Promise<DashboardState> {
    await this.store.createVariant(input);
    this.logger.info('Variant created', input);
    return this.getDashboardState();
  }

  public async renameVariant(input: { namespace: string; environment: string; variant: string; nextVariant: string }): Promise<DashboardState> {
    await this.store.renameVariant(input, input.nextVariant);
    this.logger.info('Variant renamed', input);
    return this.getDashboardState();
  }

  public async deleteVariant(input: { namespace: string; environment: string; variant: string }): Promise<DashboardState> {
    await this.store.deleteVariant(input);
    this.logger.info('Variant deleted', input);
    return this.getDashboardState();
  }

  public async activateTarget(input: ActivateTargetInput): Promise<DashboardState> {
    const targetPath = await this.store.getTargetFilesPath({ namespace: input.namespace, ...input.target });
    const mountChecks = await this.mountService.runChecks();
    if (mountChecks.checks.some((check: SetupState['checks'][number]) => !check.ok)) {
      this.logger.warn('Activation blocked because mount repair has not been explicitly run', {
        namespace: input.namespace
      });
      throw new AppError(
        'MOUNT_NOT_READY',
        'Mount setup is not ready. Use the Repair Mount button and confirm the admin action before activating a target.'
      );
    }
    await this.mountService.activateNamespace(input.namespace, targetPath);
    this.logger.info('Target activated', {
      namespace: input.namespace,
      targetPath
    });
    return this.getDashboardState();
  }

  public async listSecrets(target: ActivateTargetInput['target'] & { namespace: string }): Promise<SecretItem[]> {
    return this.store.listSecrets(target);
  }

  public async disableSecret(input: { namespace: string; environment: string; variant: string; secretName: string }): Promise<SecretItem[]> {
    this.logger.warn('Secret disabled in variant', input);
    return this.store.disableSecret(input);
  }

  public async restoreSecret(input: { namespace: string; environment: string; variant: string; secretName: string }): Promise<SecretItem[]> {
    this.logger.info('Secret restored in variant', input);
    return this.store.restoreSecret(input);
  }

  public async getDiagnostics(): Promise<DiagnosticsState> {
    const plan = this.mountService.getPlan();
    return {
      platform: os.platform() === 'darwin' ? 'macos' : 'linux',
      mountRoot: plan.mountRoot,
      expectedApplicationPath: plan.applicationPath,
      isReady: (await this.mountService.runChecks()).checks.every((check: SetupState['checks'][number]) => check.ok),
      detail: 'Current mount service state',
      activeTargets: await this.mountService.getActiveTargets(),
      lastSyncResults: await this.store.listLastSyncResults(),
      ...(plan.syntheticAliasPath ? { syntheticAliasPath: plan.syntheticAliasPath } : {})
    };
  }

  private async buildNamespaces(): Promise<DashboardState['namespaces']> {
    const [bases, variants, activeTargets] = await Promise.all([
      this.store.listBases(),
      this.store.listVariants(),
      this.mountService.getActiveTargets()
    ]);
    const namespaceNames = Array.from(new Set([...bases.map((item) => item.namespace), ...variants.map((item) => item.namespace)])).sort();

    return namespaceNames.map((namespace) => {
      const activeTargetPath = activeTargets[namespace];
      return {
        namespace,
        environments: bases.filter((base) => base.namespace === namespace),
        variants: variants.filter((variant) => variant.namespace === namespace),
        ...(activeTargetPath ? {
          activeTargetPath,
          activeLabel: describeActiveTarget(activeTargetPath, bases, variants)
        } : {})
      };
    });
  }
}

function describeActiveTarget(
  targetPath: string,
  bases: DashboardState['namespaces'][number]['environments'],
  variants: DashboardState['namespaces'][number]['variants']
): string {
  const variant = variants.find((item: DashboardState['namespaces'][number]['variants'][number]) => item.filesPath === targetPath);
  if (variant) {
    return `${variant.environment} / ${variant.variant}`;
  }
  const base = bases.find((item: DashboardState['namespaces'][number]['environments'][number]) => item.filesPath === targetPath);
  if (base) {
    return base.environment;
  }
  return targetPath;
}

function canonicalizeSyncInput(input: SyncEnvironmentInput): SyncEnvironmentInput {
  const normalizedEnvironment = normalizeEnvironmentFromVaultName(input.vaultName) ?? input.environment;
  return {
    namespace: input.namespace,
    environment: normalizedEnvironment,
    ...(input.vaultName ? { vaultName: input.vaultName } : {})
  };
}

function normalizeEnvironmentFromVaultName(vaultName?: string): string | null {
  if (!vaultName) {
    return null;
  }

  if (vaultName.endsWith('-saat')) {
    return 'aat';
  }

  const separatorIndex = vaultName.lastIndexOf('-');
  if (separatorIndex <= 0 || separatorIndex === vaultName.length - 1) {
    return null;
  }

  return vaultName.slice(separatorIndex + 1);
}

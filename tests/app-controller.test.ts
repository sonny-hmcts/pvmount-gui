import { describe, expect, it } from 'vitest';
import { AppController } from '../src/main/services/app-controller.js';
import { Logger } from '../src/main/utils/logger.js';
import { AppError } from '../src/main/utils/errors.js';
import type {
  EnvironmentStore,
  MountPlan,
  PlatformMountService,
  SecretSyncService,
  SyncResult
} from '../src/main/services/contracts.js';
import type {
  ActivateTargetInput,
  BaseEnvironmentRecord,
  DiagnosticsState,
  SecretItem,
  SetupState,
  SyncSummary,
  VariantRecord
} from '../src/shared/types.js';

class FakeSyncService implements SecretSyncService {
  public lastSyncInput: unknown;

  public async syncEnvironment(): Promise<SyncResult> {
    this.lastSyncInput = arguments[0];
    const now = new Date().toISOString();
    return {
      vaultName: 'idam-idam-saat',
      secrets: [],
      summary: {
        startedAt: now,
        completedAt: now,
        secretCount: 0,
        vaultName: 'idam-idam-saat'
      }
    };
  }
  public async isAzureCliAvailable(): Promise<boolean> {
    return true;
  }
  public async isAzureLoggedIn(): Promise<boolean> {
    return true;
  }
}

class FakeStore implements EnvironmentStore {
  public lastSavedBaseInput: unknown;

  public async listBases(): Promise<BaseEnvironmentRecord[]> { return []; }
  public async listVariants(): Promise<VariantRecord[]> { return []; }
  public async saveBaseSync(): Promise<BaseEnvironmentRecord> {
    this.lastSavedBaseInput = arguments[0];
    return {
      kind: 'base',
      namespace: 'idam-idam',
      environment: 'aat',
      vaultName: 'idam-idam-saat',
      filesPath: '/tmp/base',
      secretCount: 0
    };
  }
  public async createVariant(): Promise<VariantRecord> { throw new Error('not used'); }
  public async renameVariant(): Promise<VariantRecord> { throw new Error('not used'); }
  public async deleteVariant(): Promise<void> {}
  public async getBase(): Promise<BaseEnvironmentRecord> { throw new Error('not used'); }
  public async getVariant(): Promise<VariantRecord> { throw new Error('not used'); }
  public async getTargetFilesPath(_target: ActivateTargetInput['target'] & { namespace: string }): Promise<string> {
    return '/tmp/target';
  }
  public async listSecrets(): Promise<SecretItem[]> { return []; }
  public async disableSecret(): Promise<SecretItem[]> { return []; }
  public async restoreSecret(): Promise<SecretItem[]> { return []; }
  public async listLastSyncResults(): Promise<Record<string, SyncSummary | undefined>> { return {}; }
}

class FakeMountService implements PlatformMountService {
  public activated = false;

  public getPlan(): MountPlan {
    return {
      mountRoot: '/Volumes/mnt/secrets',
      applicationPath: '/mnt/secrets',
      syntheticAliasPath: '/mnt',
      needsSyntheticAlias: true
    };
  }

  public async runChecks(): Promise<SetupState> {
    return {
      platform: 'macos',
      requiresAdmin: true,
      checks: [
        {
          key: 'mount-root',
          label: 'Mounted secrets root',
          ok: false,
          detail: 'missing',
          action: 'Run mount setup'
        }
      ]
    };
  }

  public async ensureReady(): Promise<DiagnosticsState> {
    throw new Error('should not be called implicitly');
  }

  public async activateNamespace(): Promise<void> {
    this.activated = true;
  }

  public async getActiveTargets(): Promise<Record<string, string>> {
    return {};
  }
}

describe('AppController activation', () => {
  it('does not trigger mount repair implicitly during activation', async () => {
    const mountService = new FakeMountService();
    const controller = new AppController(
      new FakeSyncService(),
      new FakeStore(),
      mountService,
      new Logger()
    );

    await expect(
      controller.activateTarget({
        namespace: 'aac',
        target: { type: 'base', environment: 'aat' }
      })
    ).rejects.toBeInstanceOf(AppError);

    expect(mountService.activated).toBe(false);
  });
});

describe('AppController sync canonicalization', () => {
  it('stores saat vaults locally as the aat environment', async () => {
    const syncService = new FakeSyncService();
    const store = new FakeStore();
    const controller = new AppController(
      syncService,
      store,
      new FakeMountService(),
      new Logger()
    );

    await controller.syncEnvironment({
      namespace: 'idam-idam',
      environment: 'saat',
      vaultName: 'idam-idam-saat'
    });

    expect(store.lastSavedBaseInput).toEqual({
      namespace: 'idam-idam',
      environment: 'aat',
      vaultName: 'idam-idam-saat'
    });
  });
});

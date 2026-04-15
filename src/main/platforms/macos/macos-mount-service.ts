import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DiagnosticsState, SetupState } from '../../../shared/types.js';
import { AppError } from '../../utils/errors.js';
import { Logger } from '../../utils/logger.js';
import type { MountPlan, PlatformMountService, PrivilegeService } from '../../services/contracts.js';

const CATALINA_KERNEL_MAJOR = 19;

export class MacOsMountService implements PlatformMountService {
  public constructor(
    private readonly privilegeService: PrivilegeService,
    private readonly logger: Logger
  ) {}

  public getPlan(): MountPlan {
    const kernelMajor = Number.parseInt(os.release().split('.')[0] ?? '0', 10);
    const needsSyntheticAlias = kernelMajor >= CATALINA_KERNEL_MAJOR;
    const mountRoot = needsSyntheticAlias ? '/Volumes/mnt/secrets' : '/mnt/secrets';
    return {
      mountRoot,
      applicationPath: '/mnt/secrets',
      ...(needsSyntheticAlias ? { syntheticAliasPath: '/mnt' } : {}),
      needsSyntheticAlias
    };
  }

  public async runChecks(): Promise<SetupState> {
    const plan = this.getPlan();
    const mountRootExists = await exists(plan.mountRoot);
    const appPathExists = await exists(plan.applicationPath);
    const mountRootWritable = mountRootExists ? await writable(plan.mountRoot) : false;
    return {
      platform: 'macos',
      requiresAdmin: !mountRootExists || !mountRootWritable || (plan.needsSyntheticAlias && !appPathExists),
      checks: [
        {
          key: 'mount-root',
          label: 'Mounted secrets root',
          ok: mountRootExists && mountRootWritable,
          detail: !mountRootExists
            ? `${plan.mountRoot} is missing`
            : mountRootWritable
              ? `${plan.mountRoot} is available and writable`
              : `${plan.mountRoot} exists but is not writable by this app`,
          ...(!mountRootExists || !mountRootWritable ? { action: 'Run mount setup' } : {})
        },
        {
          key: 'application-path',
          label: 'Application-facing /mnt path',
          ok: plan.needsSyntheticAlias ? appPathExists : mountRootExists,
          detail: appPathExists ? `${plan.applicationPath} resolves for local apps` : `${plan.applicationPath} is not currently usable`,
          ...(!appPathExists ? { action: 'Repair mount alias' } : {})
        }
      ]
    };
  }

  public async ensureReady(): Promise<DiagnosticsState> {
    const plan = this.getPlan();
    const checks = await this.runChecks();
    if (checks.checks.some((entry) => !entry.ok)) {
      this.logger.info('Mount setup requires repair', { mountRoot: plan.mountRoot });
      await this.privilegeService.ensureMountRoot(plan);
    }

    await fs.mkdir(plan.mountRoot, { recursive: true });

    return {
      platform: 'macos',
      mountRoot: plan.mountRoot,
      expectedApplicationPath: plan.applicationPath,
      isReady: (await this.runChecks()).checks.every((entry: SetupState['checks'][number]) => entry.ok),
      detail: 'Mount root is prepared and ready for namespace activation.',
      activeTargets: await this.getActiveTargets(),
      lastSyncResults: {},
      ...(plan.syntheticAliasPath ? { syntheticAliasPath: plan.syntheticAliasPath } : {})
    };
  }

  public async activateNamespace(namespace: string, targetPath: string): Promise<void> {
    const namespacePath = path.join(this.getPlan().mountRoot, namespace);
    await fs.mkdir(this.getPlan().mountRoot, { recursive: true });
    try {
      await fs.rm(namespacePath, { recursive: true, force: true });
      await fs.symlink(targetPath, namespacePath, 'dir');
    } catch (error) {
      if (isEacces(error)) {
        throw new AppError(
          'MOUNT_NOT_WRITABLE',
          `The mounted secrets root is not writable. Use Repair Mount to fix permissions for ${this.getPlan().mountRoot} and then try Activate again.`
        );
      }
      throw error;
    }
    this.logger.info('Activated namespace target', { namespace, targetPath });
  }

  public async deactivateNamespace(namespace: string): Promise<void> {
    const namespacePath = path.join(this.getPlan().mountRoot, namespace);
    await fs.rm(namespacePath, { recursive: true, force: true });
    this.logger.info('Deactivated namespace target', { namespace });
  }

  public async getActiveTargets(): Promise<Record<string, string>> {
    const root = this.getPlan().mountRoot;
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const result: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          result[entry.name] = await fs.readlink(path.join(root, entry.name));
        }
      }
      return result;
    } catch {
      return {};
    }
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isEacces(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EACCES';
}

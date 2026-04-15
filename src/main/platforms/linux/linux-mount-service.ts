import type { DiagnosticsState, SetupState } from '../../../shared/types.js';
import { AppError } from '../../utils/errors.js';
import type { MountPlan, PlatformMountService } from '../../services/contracts.js';

export class LinuxMountService implements PlatformMountService {
  public getPlan(): MountPlan {
    return {
      mountRoot: '/mnt/secrets',
      applicationPath: '/mnt/secrets',
      needsSyntheticAlias: false
    };
  }

  public async runChecks(): Promise<SetupState> {
    return {
      platform: 'linux',
      requiresAdmin: false,
      checks: [
        {
          key: 'platform',
          label: 'Linux support',
          ok: false,
          detail: 'Ubuntu support is not implemented in this first version.'
        }
      ]
    };
  }

  public async ensureReady(): Promise<DiagnosticsState> {
    throw new AppError('UNSUPPORTED_PLATFORM', 'Linux mount setup is not implemented yet.');
  }

  public async activateNamespace(): Promise<void> {
    throw new AppError('UNSUPPORTED_PLATFORM', 'Linux activation is not implemented yet.');
  }

  public async deactivateNamespace(): Promise<void> {
    throw new AppError('UNSUPPORTED_PLATFORM', 'Linux activation is not implemented yet.');
  }

  public async getActiveTargets(): Promise<Record<string, string>> {
    return {};
  }
}

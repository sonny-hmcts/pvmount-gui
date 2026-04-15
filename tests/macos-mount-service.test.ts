import { describe, expect, it } from 'vitest';
import { MacOsMountService } from '../src/main/platforms/macos/macos-mount-service.js';
import { Logger } from '../src/main/utils/logger.js';
import type { MountPlan, PrivilegeService } from '../src/main/services/contracts.js';

class FakePrivilegeService implements PrivilegeService {
  public async ensureMountRoot(_plan: MountPlan): Promise<void> {}
}

describe('MacOsMountService', () => {
  it('keeps the application-facing path stable at /mnt/secrets', () => {
    const service = new MacOsMountService(new FakePrivilegeService(), new Logger());
    expect(service.getPlan().applicationPath).toBe('/mnt/secrets');
  });
});

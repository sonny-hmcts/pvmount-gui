import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemEnvironmentStore } from '../src/main/services/file-system-environment-store.js';
import type { SyncResult } from '../src/main/services/contracts.js';

const tempRoots: string[] = [];

describe('FileSystemEnvironmentStore', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('creates variants and tracks disabled and restored secrets', async () => {
    const store = new FileSystemEnvironmentStore({ dataRoot: await makeRoot(), logsRoot: await makeRoot() });
    await store.saveBaseSync(
      { namespace: 'aac', environment: 'aat' },
      buildSyncResult('aac-aat', { Alpha: 'one', Beta: 'two' })
    );

    await store.createVariant({ namespace: 'aac', environment: 'aat', variant: 'aat-my-task' });
    let secrets = await store.listSecrets({ namespace: 'aac', type: 'variant', environment: 'aat', variant: 'aat-my-task' });
    expect(secrets.map((item) => item.state)).toEqual(['present', 'present']);

    secrets = await store.disableSecret({ namespace: 'aac', environment: 'aat', variant: 'aat-my-task', secretName: 'Alpha' });
    expect(secrets.find((item) => item.name === 'Alpha')?.state).toBe('disabled');

    secrets = await store.restoreSecret({ namespace: 'aac', environment: 'aat', variant: 'aat-my-task', secretName: 'Alpha' });
    expect(secrets.find((item) => item.name === 'Alpha')?.state).toBe('present');
  });

  it('marks changed files in variants', async () => {
    const dataRoot = await makeRoot();
    const store = new FileSystemEnvironmentStore({ dataRoot, logsRoot: await makeRoot() });
    await store.saveBaseSync(
      { namespace: 'aac', environment: 'dev' },
      buildSyncResult('aac-dev', { Gamma: 'base-value' })
    );
    const variant = await store.createVariant({ namespace: 'aac', environment: 'dev', variant: 'dev-exp' });

    await fs.writeFile(path.join(variant.filesPath, 'Gamma'), 'override', 'utf8');
    const secrets = await store.listSecrets({ namespace: 'aac', type: 'variant', environment: 'dev', variant: 'dev-exp' });
    expect(secrets[0]?.state).toBe('changed');
  });

  it('deletes a base environment and its local variants without touching Azure concepts', async () => {
    const store = new FileSystemEnvironmentStore({ dataRoot: await makeRoot(), logsRoot: await makeRoot() });
    await store.saveBaseSync(
      { namespace: 'aac', environment: 'aat' },
      buildSyncResult('aac-aat', { Alpha: 'one' })
    );
    await store.createVariant({ namespace: 'aac', environment: 'aat', variant: 'aat-my-task' });

    await store.deleteEnvironment({ namespace: 'aac', environment: 'aat' });

    await expect(store.getBase({ namespace: 'aac', environment: 'aat' })).rejects.toBeTruthy();
    const variants = await store.listVariants('aac');
    expect(variants).toEqual([]);
  });
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pvmount-gui-test-'));
  tempRoots.push(root);
  return root;
}

function buildSyncResult(vaultName: string, data: Record<string, string>): SyncResult {
  const now = new Date().toISOString();
  return {
    vaultName,
    secrets: Object.entries(data).map(([name, value]) => ({ name, value })),
    summary: {
      startedAt: now,
      completedAt: now,
      secretCount: Object.keys(data).length,
      vaultName
    }
  };
}

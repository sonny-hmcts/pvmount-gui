import { describe, expect, it } from 'vitest';
import {
  buildAzureCliEnvironment,
  buildExecutableSearchPath,
  isAzureCliForcedUnavailable,
  parseVaultName
} from '../src/main/services/azure-key-vault-sync-service.js';

const pathDelimiter = process.platform === 'win32' ? ';' : ':';

describe('vault name parsing contract', () => {
  it('splits namespace and environment on the last hyphen', () => {
    const parsed = parseVaultName('service-name-aat');
    expect(parsed).toEqual({
      namespace: 'service-name',
      environment: 'aat'
    });
  });

  it('ignores vault names without a namespace-environment separator', () => {
    expect(parseVaultName('invalidvault')).toBeNull();
  });

  it('normalizes saat vaults to the aat environment label', () => {
    expect(parseVaultName('idam-idam-saat')).toEqual({
      namespace: 'idam-idam',
      environment: 'aat'
    });
  });
});

describe('Azure CLI environment', () => {
  it('adds common macOS CLI locations for packaged app launches', () => {
    const searchPath = buildExecutableSearchPath({
      currentPath: '/usr/bin:/bin',
      homeDir: '/Users/example',
      platform: 'darwin'
    }).split(pathDelimiter);

    expect(searchPath).toContain('/opt/homebrew/bin');
    expect(searchPath).toContain('/usr/local/bin');
    expect(searchPath).toContain('/Users/example/.local/bin');
  });

  it('prepends the directory from a configured Azure CLI path', () => {
    const env = buildAzureCliEnvironment({
      env: {
        PATH: '/usr/bin:/bin',
        PVMOUNT_AZ_PATH: '/custom/azure/bin/az'
      },
      homeDir: '/Users/example',
      platform: 'darwin'
    });

    expect(env.PATH?.split(pathDelimiter)[0]).toBe('/custom/azure/bin');
  });

  it('expands a home-relative configured Azure CLI path', () => {
    const env = buildAzureCliEnvironment({
      env: {
        PATH: '/usr/bin:/bin',
        PVMOUNT_AZ_PATH: '~/tools/azure/bin/az'
      },
      homeDir: '/Users/example',
      platform: 'darwin'
    });

    expect(env.PATH?.split(pathDelimiter)[0]).toBe('/Users/example/tools/azure/bin');
  });

  it('deduplicates executable search locations without reordering the first occurrence', () => {
    const searchPath = buildExecutableSearchPath({
      currentPath: '/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin',
      homeDir: '/Users/example',
      platform: 'darwin'
    }).split(pathDelimiter);

    expect(searchPath.filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1);
    expect(searchPath[0]).toBe('/opt/homebrew/bin');
  });

  it('allows Azure CLI detection to be forced off only for dev and test runs', () => {
    expect(isAzureCliForcedUnavailable({
      PVMOUNT_FORCE_AZ_UNAVAILABLE: '1',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173'
    })).toBe(true);
    expect(isAzureCliForcedUnavailable({
      PVMOUNT_FORCE_AZ_UNAVAILABLE: '1',
      NODE_ENV: 'test'
    })).toBe(true);
    expect(isAzureCliForcedUnavailable({
      PVMOUNT_FORCE_AZ_UNAVAILABLE: '1'
    })).toBe(false);
  });
});

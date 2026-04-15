import { describe, expect, it } from 'vitest';
import { parseVaultName } from '../src/main/services/azure-key-vault-sync-service.js';

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

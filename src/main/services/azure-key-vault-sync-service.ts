import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AzureCliCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import type { AzureSubscription, DiscoveredEnvironment, DiscoveredNamespace, EnvironmentRef, SyncEnvironmentInput } from '../../shared/types.js';
import { AppError } from '../utils/errors.js';
import type { SecretSyncService, SyncResult, SyncedSecret } from './contracts.js';

const execFileAsync = promisify(execFile);

export class AzureKeyVaultSyncService implements SecretSyncService {
  public async syncEnvironment(input: SyncEnvironmentInput): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const vaultName = input.vaultName ?? `${input.namespace}-${input.environment}`;
    const credential = new AzureCliCredential();
    const client = new SecretClient(`https://${vaultName}.vault.azure.net/`, credential);
    const secrets: SyncedSecret[] = [];

    try {
      const iterator = client.listPropertiesOfSecrets();
      for await (const property of iterator) {
        const secret = await client.getSecret(property.name);
        secrets.push({
          name: property.name,
          value: secret.value ?? ''
        });
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      if (name === 'CredentialUnavailableError') {
        throw new AppError('AZURE_LOGIN_REQUIRED', "Azure CLI credential is unavailable. Run 'az login' first.");
      }
      throw error;
    }

    const completedAt = new Date().toISOString();
    return {
      vaultName,
      secrets,
      summary: {
        startedAt,
        completedAt,
        secretCount: secrets.length,
        vaultName
      }
    };
  }

  public async isAzureCliAvailable(): Promise<boolean> {
    try {
      await execFileAsync('az', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  public async isAzureLoggedIn(): Promise<boolean> {
    try {
      await execFileAsync('az', ['account', 'show']);
      return true;
    } catch {
      return false;
    }
  }

  public async listSubscriptions(): Promise<AzureSubscription[]> {
    try {
      const { stdout } = await execFileAsync('az', [
        'account',
        'list',
        '--query',
        '[].{id:id,name:name,isDefault:isDefault}',
        '-o',
        'json'
      ]);
      const subscriptions = JSON.parse(stdout) as AzureSubscription[];
      return subscriptions.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError('AZURE_SUBSCRIPTIONS_FAILED', `Unable to list Azure subscriptions from Azure CLI: ${message}`);
    }
  }

  public async discoverNamespaces(subscriptionId?: string): Promise<DiscoveredNamespace[]> {
    try {
      const args = ['keyvault', 'list'];
      if (subscriptionId) {
        args.push('--subscription', subscriptionId);
      }
      args.push('--query', '[].name', '-o', 'tsv');
      const { stdout } = await execFileAsync('az', args);
      const names = stdout
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);

      const grouped = new Map<string, Map<string, DiscoveredEnvironment>>();
      for (const name of names) {
        const parsed = parseVaultName(name);
        if (!parsed) {
          continue;
        }

        const environments = grouped.get(parsed.namespace) ?? new Map<string, DiscoveredEnvironment>();
        environments.set(parsed.environment, {
          environment: parsed.environment,
          vaultName: name
        });
        grouped.set(parsed.namespace, environments);
      }

      return Array.from(grouped.entries())
        .map(([namespace, environments]) => ({
          namespace,
          environments: Array.from(environments.values()).sort((left, right) => left.environment.localeCompare(right.environment))
        }))
        .sort((left, right) => left.namespace.localeCompare(right.namespace));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError('AZURE_DISCOVERY_FAILED', `Unable to discover Key Vault namespaces from Azure CLI: ${message}`);
    }
  }
}

export function parseVaultName(vaultName: string): EnvironmentRef | null {
  const aliased = parseAliasedEnvironmentVaultName(vaultName);
  if (aliased) {
    return aliased;
  }

  const separatorIndex = vaultName.lastIndexOf('-');
  if (separatorIndex <= 0 || separatorIndex === vaultName.length - 1) {
    return null;
  }

  return {
    namespace: vaultName.slice(0, separatorIndex),
    environment: vaultName.slice(separatorIndex + 1)
  };
}

function parseAliasedEnvironmentVaultName(vaultName: string): EnvironmentRef | null {
  const aliases: Array<{ actualSuffix: string; displayedEnvironment: string }> = [
    { actualSuffix: '-saat', displayedEnvironment: 'aat' }
  ];

  for (const alias of aliases) {
    if (vaultName.endsWith(alias.actualSuffix)) {
      const namespace = vaultName.slice(0, vaultName.length - alias.actualSuffix.length);
      if (!namespace) {
        return null;
      }
      return {
        namespace,
        environment: alias.displayedEnvironment
      };
    }
  }

  return null;
}

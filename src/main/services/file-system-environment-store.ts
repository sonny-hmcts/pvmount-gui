import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ActivateTargetInput,
  BaseEnvironmentRecord,
  EnvironmentRef,
  SecretItem,
  SyncSummary,
  VariantRecord,
  VariantRef
} from '../../shared/types.js';
import { AppError } from '../utils/errors.js';
import type { AppPaths, EnvironmentStore, SyncResult } from './contracts.js';

interface BaseMetadata {
  namespace: string;
  environment: string;
  vaultName: string;
  secretCount: number;
  lastSyncedAt?: string;
  lastSyncResult?: SyncSummary;
  checksums: Record<string, string>;
}

interface VariantMetadata {
  namespace: string;
  environment: string;
  variant: string;
  disabledSecretNames: string[];
  createdAt: string;
  updatedAt: string;
}

export class FileSystemEnvironmentStore implements EnvironmentStore {
  public constructor(private readonly paths: AppPaths) {}

  public async listBases(namespace?: string): Promise<BaseEnvironmentRecord[]> {
    const namespaces = namespace ? [namespace] : await this.listNamespaces();
    const records = await Promise.all(namespaces.map(async (name) => {
      const basesDir = path.join(this.namespaceRoot(name), 'bases');
      const entries = await this.listManagedDirectories(basesDir);
      return Promise.all(entries.map(async (entry) => this.readBaseRecordByDirectory({ namespace: name, directoryName: entry.name })));
    }));
    return records.flat().sort((left: BaseEnvironmentRecord, right: BaseEnvironmentRecord) => left.environment.localeCompare(right.environment));
  }

  public async listVariants(namespace?: string): Promise<VariantRecord[]> {
    const namespaces = namespace ? [namespace] : await this.listNamespaces();
    const records = await Promise.all(namespaces.map(async (name) => {
      const variantsDir = path.join(this.namespaceRoot(name), 'variants');
      const entries = await this.listManagedDirectories(variantsDir);
      return Promise.all(entries.map(async (entry) => this.readVariantRecord({ namespace: name, environment: await this.readVariantEnvironment(name, entry.name), variant: entry.name })));
    }));
    return records.flat().sort((left: VariantRecord, right: VariantRecord) => left.variant.localeCompare(right.variant));
  }

  public async saveBaseSync(input: EnvironmentRef, syncResult: SyncResult): Promise<BaseEnvironmentRecord> {
    const root = this.baseRoot(input);
    const filesDir = path.join(root, 'files');
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(filesDir, { recursive: true });

    const checksums: Record<string, string> = {};
    for (const secret of syncResult.secrets) {
      const filePath = path.join(filesDir, secret.name);
      await fs.writeFile(filePath, secret.value, 'utf8');
      checksums[secret.name] = checksum(secret.value);
    }

    const metadata: BaseMetadata = {
      namespace: input.namespace,
      environment: input.environment,
      vaultName: syncResult.vaultName,
      secretCount: syncResult.secrets.length,
      lastSyncedAt: syncResult.summary.completedAt,
      lastSyncResult: syncResult.summary,
      checksums
    };

    await this.writeJson(path.join(root, 'metadata.json'), metadata);
    return this.readBaseRecord(input);
  }

  public async deleteNamespace(namespace: string): Promise<void> {
    await fs.rm(this.namespaceRoot(namespace), { recursive: true, force: true });
  }

  public async deleteEnvironment(input: EnvironmentRef): Promise<void> {
    await fs.rm(this.baseRoot(input), { recursive: true, force: true });

    const variants = await this.listVariants(input.namespace);
    await Promise.all(
      variants
        .filter((variant) => variant.environment === input.environment)
        .map((variant) => fs.rm(this.variantRoot(variant), { recursive: true, force: true }))
    );
  }

  public async createVariant(input: VariantRef): Promise<VariantRecord> {
    const base = await this.readBaseRecord(input);
    const root = this.variantRoot(input);
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    await fs.cp(base.filesPath, path.join(root, 'files'), { recursive: true });

    const now = new Date().toISOString();
    const metadata: VariantMetadata = {
      namespace: input.namespace,
      environment: input.environment,
      variant: input.variant,
      disabledSecretNames: [],
      createdAt: now,
      updatedAt: now
    };
    await this.writeJson(path.join(root, 'metadata.json'), metadata);
    return this.readVariantRecord(input);
  }

  public async renameVariant(input: VariantRef, nextVariant: string): Promise<VariantRecord> {
    const currentRoot = this.variantRoot(input);
    const nextRoot = this.variantRoot({ ...input, variant: nextVariant });
    await fs.rename(currentRoot, nextRoot);
    const metadata = await this.readVariantMetadata({ ...input, variant: nextVariant });
    metadata.variant = nextVariant;
    metadata.updatedAt = new Date().toISOString();
    await this.writeJson(path.join(nextRoot, 'metadata.json'), metadata);
    return this.readVariantRecord({ ...input, variant: nextVariant });
  }

  public async deleteVariant(input: VariantRef): Promise<void> {
    await fs.rm(this.variantRoot(input), { recursive: true, force: true });
  }

  public async getBase(input: EnvironmentRef): Promise<BaseEnvironmentRecord> {
    return this.readBaseRecord(input);
  }

  public async getVariant(input: VariantRef): Promise<VariantRecord> {
    return this.readVariantRecord(input);
  }

  public async getTargetFilesPath(target: ActivateTargetInput['target'] & { namespace: string }): Promise<string> {
    if (target.type === 'base') {
      return (await this.readBaseRecord({ namespace: target.namespace, environment: target.environment })).filesPath;
    }
    return (await this.readVariantRecord({ namespace: target.namespace, environment: target.environment, variant: target.variant })).filesPath;
  }

  public async listSecrets(target: ActivateTargetInput['target'] & { namespace: string }): Promise<SecretItem[]> {
    const baseEnvironment = target.environment;
    const base = await this.readBaseRecord({ namespace: target.namespace, environment: baseEnvironment });
    const baseMetadata = await this.readBaseMetadata({ namespace: target.namespace, environment: baseEnvironment });
    const targetPath = await this.getTargetFilesPath(target);
    const targetEntries = await this.safeReadDir(targetPath);
    const targetNames = new Set(targetEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const baseNames = new Set(Object.keys(baseMetadata.checksums));
    const names = Array.from(new Set([...baseNames, ...targetNames])).sort((left: string, right: string) => left.localeCompare(right));
    const result: SecretItem[] = [];

    for (const name of names) {
      const presentInBase = baseNames.has(name);
      const presentInTarget = targetNames.has(name);
      let state: SecretItem['state'] = 'present';

      if (presentInBase && !presentInTarget) {
        state = 'disabled';
      } else if (presentInBase && presentInTarget) {
        const currentValue = await fs.readFile(path.join(targetPath, name), 'utf8');
        if (checksum(currentValue) !== baseMetadata.checksums[name]) {
          state = 'changed';
        }
      }

      result.push({ name, state, presentInBase, presentInTarget });
    }

    if (target.type === 'base' && base.secretCount === 0) {
      return [];
    }

    return result;
  }

  public async disableSecret(input: VariantRef & { secretName: string }): Promise<SecretItem[]> {
    const metadata = await this.readVariantMetadata(input);
    const filePath = path.join(this.variantRoot(input), 'files', input.secretName);
    await fs.rm(filePath, { force: true });
    if (!metadata.disabledSecretNames.includes(input.secretName)) {
      metadata.disabledSecretNames.push(input.secretName);
    }
    metadata.updatedAt = new Date().toISOString();
    await this.writeJson(path.join(this.variantRoot(input), 'metadata.json'), metadata);
    return this.listSecrets({ namespace: input.namespace, type: 'variant', environment: input.environment, variant: input.variant });
  }

  public async restoreSecret(input: VariantRef & { secretName: string }): Promise<SecretItem[]> {
    const base = await this.readBaseRecord(input);
    const source = path.join(base.filesPath, input.secretName);
    const destination = path.join(this.variantRoot(input), 'files', input.secretName);
    await fs.copyFile(source, destination);

    const metadata = await this.readVariantMetadata(input);
    metadata.disabledSecretNames = metadata.disabledSecretNames.filter((name) => name !== input.secretName);
    metadata.updatedAt = new Date().toISOString();
    await this.writeJson(path.join(this.variantRoot(input), 'metadata.json'), metadata);
    return this.listSecrets({ namespace: input.namespace, type: 'variant', environment: input.environment, variant: input.variant });
  }

  public async listLastSyncResults(): Promise<Record<string, SyncSummary | undefined>> {
    const bases = await this.listBases();
    return Object.fromEntries(
      bases.map((base) => [`${base.namespace}/${base.environment}`, base.lastSyncResult])
    );
  }

  private async readBaseRecord(input: EnvironmentRef): Promise<BaseEnvironmentRecord> {
    const metadata = await this.readBaseMetadata(input);
    return {
      kind: 'base',
      namespace: metadata.namespace,
      environment: metadata.environment,
      vaultName: metadata.vaultName,
      filesPath: path.join(this.baseRoot(input), 'files'),
      secretCount: metadata.secretCount,
      ...(metadata.lastSyncedAt ? { lastSyncedAt: metadata.lastSyncedAt } : {}),
      ...(metadata.lastSyncResult ? { lastSyncResult: metadata.lastSyncResult } : {})
    };
  }

  private async readBaseRecordByDirectory(input: { namespace: string; directoryName: string }): Promise<BaseEnvironmentRecord> {
    const metadata = await this.readJson<BaseMetadata>(
      path.join(this.namespaceRoot(input.namespace), 'bases', input.directoryName, 'metadata.json'),
      `Base environment ${input.namespace}/${input.directoryName} not found`
    );

    return {
      kind: 'base',
      namespace: metadata.namespace,
      environment: metadata.environment,
      vaultName: metadata.vaultName,
      filesPath: path.join(this.namespaceRoot(input.namespace), 'bases', input.directoryName, 'files'),
      secretCount: metadata.secretCount,
      ...(metadata.lastSyncedAt ? { lastSyncedAt: metadata.lastSyncedAt } : {}),
      ...(metadata.lastSyncResult ? { lastSyncResult: metadata.lastSyncResult } : {})
    };
  }

  private async readVariantRecord(input: VariantRef): Promise<VariantRecord> {
    const metadata = await this.readVariantMetadata(input);
    return {
      kind: 'variant',
      namespace: input.namespace,
      environment: input.environment,
      variant: metadata.variant,
      filesPath: path.join(this.variantRoot(input), 'files'),
      baseFilesPath: path.join(this.baseRoot(input), 'files'),
      disabledSecretNames: metadata.disabledSecretNames,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt
    };
  }

  private async readBaseMetadata(input: EnvironmentRef): Promise<BaseMetadata> {
    const filePath = path.join(this.baseRoot(input), 'metadata.json');
    return this.readJson<BaseMetadata>(filePath, `Base environment ${input.namespace}/${input.environment} not found`);
  }

  private async readVariantMetadata(input: VariantRef): Promise<VariantMetadata> {
    const filePath = path.join(this.variantRoot(input), 'metadata.json');
    return this.readJson<VariantMetadata>(filePath, `Variant ${input.namespace}/${input.variant} not found`);
  }

  private async readVariantEnvironment(namespace: string, variant: string): Promise<string> {
    const metadata = await this.readVariantMetadata({ namespace, environment: '', variant });
    return metadata.environment;
  }

  private async listNamespaces(): Promise<string[]> {
    const root = path.join(this.paths.dataRoot, 'namespaces');
    const entries = await this.listManagedDirectories(root);
    return entries.map((entry) => entry.name);
  }

  private namespaceRoot(namespace: string): string {
    return path.join(this.paths.dataRoot, 'namespaces', namespace);
  }

  private baseRoot(input: EnvironmentRef): string {
    return path.join(this.namespaceRoot(input.namespace), 'bases', input.environment);
  }

  private variantRoot(input: VariantRef): string {
    return path.join(this.namespaceRoot(input.namespace), 'variants', input.variant);
  }

  private async writeJson(filePath: string, value: object): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private async readJson<T>(filePath: string, notFoundMessage: string): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch (error) {
      throw new AppError('NOT_FOUND', notFoundMessage);
    }
  }

  private async safeReadDir(dirPath: string): Promise<Dirent<string>[]> {
    try {
      return await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async listManagedDirectories(dirPath: string): Promise<Dirent<string>[]> {
    const entries = await this.safeReadDir(dirPath);
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  }
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

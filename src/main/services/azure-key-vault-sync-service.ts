import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AzureCliCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import type { AzureSubscription, DiscoveredEnvironment, DiscoveredNamespace, EnvironmentRef, SyncEnvironmentInput } from '../../shared/types.js';
import { AppError } from '../utils/errors.js';
import type { SecretSyncService, SyncResult, SyncedSecret } from './contracts.js';

const execFileAsync = promisify(execFile);
const AZ_COMMAND = 'az';
const AZ_PATH_OVERRIDE_ENV = 'PVMOUNT_AZ_PATH';
const AZ_FORCE_UNAVAILABLE_ENV = 'PVMOUNT_FORCE_AZ_UNAVAILABLE';
const SHELL_DISCOVERY_TIMEOUT_MS = 5000;

const COMMON_EXECUTABLE_DIRECTORIES = {
  darwin: [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ],
  linux: [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/sbin',
    '/usr/sbin',
    '/sbin',
    '/snap/bin'
  ]
} as const;

interface AzureCliEnvironmentInput {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export class AzureKeyVaultSyncService implements SecretSyncService {
  private readonly cliEnv: NodeJS.ProcessEnv;
  private resolvedAzCommand: string | null | undefined;
  private resolveAzCommandPromise: Promise<string | null> | undefined;

  public constructor() {
    this.cliEnv = buildAzureCliEnvironment();
    applyAzureCliEnvironment(this.cliEnv);
  }

  public async syncEnvironment(input: SyncEnvironmentInput): Promise<SyncResult> {
    await this.ensureAzureCliAvailable();

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
        throw new AppError('AZURE_LOGIN_REQUIRED', `Azure CLI credential is unavailable. Run 'az login' first. ${describeAzureCliError(error)}`);
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
    return (await this.resolveAzureCliCommand()) !== null;
  }

  public async isAzureLoggedIn(): Promise<boolean> {
    try {
      await this.runAz(['account', 'show']);
      return true;
    } catch {
      return false;
    }
  }

  public async listSubscriptions(): Promise<AzureSubscription[]> {
    try {
      const { stdout } = await this.runAz([
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
      throw new AppError('AZURE_SUBSCRIPTIONS_FAILED', `Unable to list Azure subscriptions from Azure CLI: ${describeAzureCliError(error)}`);
    }
  }

  public async discoverNamespaces(subscriptionId?: string): Promise<DiscoveredNamespace[]> {
    try {
      const args = ['keyvault', 'list'];
      if (subscriptionId) {
        args.push('--subscription', subscriptionId);
      }
      args.push('--query', '[].name', '-o', 'tsv');
      const { stdout } = await this.runAz(args);
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
      throw new AppError('AZURE_DISCOVERY_FAILED', `Unable to discover Key Vault namespaces from Azure CLI: ${describeAzureCliError(error)}`);
    }
  }

  private async runAz(args: string[]) {
    const command = await this.ensureAzureCliAvailable();
    return execFileAsync(command, args, { env: this.cliEnv });
  }

  private async ensureAzureCliAvailable(): Promise<string> {
    const command = await this.resolveAzureCliCommand();
    if (!command) {
      throw new AppError('AZURE_CLI_NOT_FOUND', azureCliNotFoundMessage(this.cliEnv));
    }
    return command;
  }

  private async resolveAzureCliCommand(): Promise<string | null> {
    if (this.resolvedAzCommand !== undefined) {
      return this.resolvedAzCommand;
    }

    this.resolveAzCommandPromise ??= this.resolveAzureCliCommandOnce();
    this.resolvedAzCommand = await this.resolveAzCommandPromise;
    return this.resolvedAzCommand;
  }

  private async resolveAzureCliCommandOnce(): Promise<string | null> {
    if (isAzureCliForcedUnavailable(this.cliEnv)) {
      applyAzureCliEnvironment(this.cliEnv);
      return null;
    }

    const overriddenCommand = resolveConfiguredAzPath(this.cliEnv);
    if (overriddenCommand && await isWorkingAzCommand(overriddenCommand, this.cliEnv)) {
      prependExecutableDirectory(this.cliEnv, overriddenCommand);
      applyAzureCliEnvironment(this.cliEnv);
      return overriddenCommand;
    }

    if (await isWorkingAzCommand(AZ_COMMAND, this.cliEnv)) {
      applyAzureCliEnvironment(this.cliEnv);
      return AZ_COMMAND;
    }

    const discoveredCommand = await discoverAzPathFromUserShell(this.cliEnv);
    if (discoveredCommand && await isWorkingAzCommand(discoveredCommand, this.cliEnv)) {
      prependExecutableDirectory(this.cliEnv, discoveredCommand);
      applyAzureCliEnvironment(this.cliEnv);
      return discoveredCommand;
    }

    applyAzureCliEnvironment(this.cliEnv);
    return null;
  }
}

export function buildAzureCliEnvironment(input: AzureCliEnvironmentInput = {}): NodeJS.ProcessEnv {
  const sourceEnv = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? os.homedir();
  const pathValue = buildExecutableSearchPath({
    currentPath: sourceEnv.PATH,
    configuredAzPath: sourceEnv[AZ_PATH_OVERRIDE_ENV],
    homeDir,
    platform
  });

  return {
    ...sourceEnv,
    PATH: pathValue
  };
}

export function isAzureCliForcedUnavailable(env: NodeJS.ProcessEnv): boolean {
  return env[AZ_FORCE_UNAVAILABLE_ENV] === '1' && (env.NODE_ENV === 'test' || Boolean(env.VITE_DEV_SERVER_URL));
}

export function buildExecutableSearchPath(input: {
  currentPath?: string | undefined;
  configuredAzPath?: string | undefined;
  homeDir?: string | undefined;
  platform?: NodeJS.Platform | undefined;
} = {}): string {
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? os.homedir();
  const pathEntries = [
    ...directoryEntriesForExecutable(input.configuredAzPath, homeDir),
    ...(input.currentPath ?? '').split(path.delimiter),
    ...commonExecutableDirectories(platform),
    ...homeExecutableDirectories(homeDir)
  ];

  return dedupePathEntries(pathEntries).join(path.delimiter);
}

function commonExecutableDirectories(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [...COMMON_EXECUTABLE_DIRECTORIES.darwin];
  }

  if (platform === 'linux') {
    return [...COMMON_EXECUTABLE_DIRECTORIES.linux];
  }

  return [];
}

function homeExecutableDirectories(homeDir: string): string[] {
  if (!homeDir) {
    return [];
  }

  return [
    path.join(homeDir, '.local/bin'),
    path.join(homeDir, 'bin')
  ];
}

function directoryEntriesForExecutable(executablePath: string | undefined, homeDir = os.homedir()): string[] {
  const resolvedPath = expandHomePath(executablePath?.trim(), homeDir);
  if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
    return [];
  }

  return [path.dirname(resolvedPath)];
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of entries) {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    deduped.push(normalizedEntry);
  }

  return deduped;
}

function applyAzureCliEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.PATH) {
    process.env.PATH = env.PATH;
  }
}

function resolveConfiguredAzPath(env: NodeJS.ProcessEnv): string | null {
  const configuredPath = expandHomePath(env[AZ_PATH_OVERRIDE_ENV]?.trim());
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    return null;
  }

  return configuredPath;
}

async function isWorkingAzCommand(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { env });
    return true;
  } catch {
    return false;
  }
}

async function discoverAzPathFromUserShell(env: NodeJS.ProcessEnv): Promise<string | null> {
  const shells = dedupePathEntries([
    process.env.SHELL ?? '',
    os.userInfo().shell ?? '',
    '/bin/zsh',
    '/bin/bash'
  ]);

  for (const shellPath of shells) {
    if (!path.isAbsolute(shellPath) || !(await isExecutableFile(shellPath))) {
      continue;
    }

    const discoveredPath = await runShellCommand(shellPath, ['-lc', `command -v ${AZ_COMMAND}`], env)
      ?? await runShellCommand(shellPath, ['-ilc', `command -v ${AZ_COMMAND}`], env);
    const executablePath = parseFirstAbsolutePath(discoveredPath);
    if (executablePath && await isExecutableFile(executablePath)) {
      return executablePath;
    }
  }

  return null;
}

async function runShellCommand(shellPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(shellPath, args, {
      env,
      timeout: SHELL_DISCOVERY_TIMEOUT_MS
    });
    return stdout;
  } catch {
    return null;
  }
}

function parseFirstAbsolutePath(output: string | null): string | null {
  for (const line of output?.split('\n') ?? []) {
    const value = line.trim();
    if (path.isAbsolute(value)) {
      return value;
    }
  }

  return null;
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function prependExecutableDirectory(env: NodeJS.ProcessEnv, executablePath: string): void {
  if (!path.isAbsolute(executablePath)) {
    return;
  }

  env.PATH = buildExecutableSearchPath({
    currentPath: env.PATH,
    configuredAzPath: executablePath,
    platform: process.platform
  });
}

function expandHomePath(value: string | undefined, homeDir = os.homedir()): string | null {
  if (!value) {
    return null;
  }

  if (value === '~') {
    return homeDir;
  }

  if (value.startsWith('~/')) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
}

function describeAzureCliError(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (isMissingExecutableError(error)) {
    return azureCliNotFoundMessage(process.env);
  }

  return error instanceof Error ? error.message : String(error);
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function azureCliNotFoundMessage(env: NodeJS.ProcessEnv): string {
  const searchedLocations = commonExecutableDirectories(process.platform).join(', ');
  const configuredPath = env[AZ_PATH_OVERRIDE_ENV]?.trim();
  const configuredDetail = configuredPath ? ` ${AZ_PATH_OVERRIDE_ENV} was set to '${configuredPath}', but that executable did not run.` : '';
  return `Azure CLI executable '${AZ_COMMAND}' was not found. The app checks PATH plus common CLI locations${
    searchedLocations ? ` (${searchedLocations})` : ''
  }.${configuredDetail} If Azure CLI is installed in a custom location, set ${AZ_PATH_OVERRIDE_ENV} to the full az executable path.`;
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

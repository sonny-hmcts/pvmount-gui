import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../utils/errors.js';
import type { MountPlan, PrivilegeService } from './contracts.js';

const execFileAsync = promisify(execFile);
const SYNTHETIC_FILE = '/etc/synthetic.conf';
const SYNTHETIC_LINE = 'mnt\t/Volumes/mnt';
const APFS_UTIL = '/System/Library/Filesystems/apfs.fs/Contents/Resources/apfs.util';

export class MacOsPrivilegeService implements PrivilegeService {
  public async ensureMountRoot(plan: MountPlan): Promise<void> {
    const existing = await this.readExistingSyntheticConfig();
    if (plan.needsSyntheticAlias && existing !== null && existing.trim() !== '' && existing.trim() !== SYNTHETIC_LINE) {
      throw new AppError(
        'SYNTHETIC_CONFLICT',
        'Existing /etc/synthetic.conf contains unmanaged content. Review it manually before this app can repair /mnt.'
      );
    }

    const scriptPath = path.join(os.tmpdir(), `pvmount-admin-${Date.now()}.sh`);
    const hadExistingFile = existing !== null;
    const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '';
    const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '';
    const script = [
      '#!/bin/sh',
      'set -eu',
      `mkdir -p ${shellEscape(path.dirname(plan.mountRoot))}`,
      `mkdir -p ${shellEscape(plan.mountRoot)}`,
      uid && gid ? `chown -R ${uid}:${gid} ${shellEscape(plan.mountRoot)}` : ':',
      `chmod 0755 ${shellEscape(plan.mountRoot)}`,
      ...(plan.needsSyntheticAlias
        ? [
            `if [ ! -d /mnt ]; then printf 'mnt\\t/Volumes/mnt\\n' > ${shellEscape(SYNTHETIC_FILE)}; ${shellEscape(APFS_UTIL)} -t; fi`,
            hadExistingFile
              ? `cat <<'EOF' > ${shellEscape(SYNTHETIC_FILE)}\n${existing ?? ''}\nEOF`
              : `rm -f ${shellEscape(SYNTHETIC_FILE)}`
          ]
        : [])
    ].join('\n');

    await fs.writeFile(scriptPath, script, { mode: 0o700 });
    try {
      await execFileAsync('osascript', [
        '-e',
        `do shell script ${appleScriptString(`/bin/sh ${scriptPath}`)} with administrator privileges`
      ]);
    } finally {
      await fs.rm(scriptPath, { force: true });
    }
  }

  private async readExistingSyntheticConfig(): Promise<string | null> {
    try {
      return await fs.readFile(SYNTHETIC_FILE, 'utf8');
    } catch {
      return null;
    }
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

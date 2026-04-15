import path from 'node:path';
import type { AppPaths } from './contracts.js';

export function buildAppPaths(baseRoot: string): AppPaths {
  return {
    dataRoot: path.join(baseRoot, 'data'),
    logsRoot: path.join(baseRoot, 'logs')
  };
}

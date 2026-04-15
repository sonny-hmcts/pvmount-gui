import type { LogEntry } from '../../shared/types.js';

export class Logger {
  private readonly entries: LogEntry[] = [];

  public info(message: string, context?: Record<string, string>): void {
    this.push('info', message, context);
  }

  public warn(message: string, context?: Record<string, string>): void {
    this.push('warn', message, context);
  }

  public error(message: string, context?: Record<string, string>): void {
    this.push('error', message, context);
  }

  public list(): LogEntry[] {
    return [...this.entries].reverse();
  }

  private push(level: LogEntry['level'], message: string, context?: Record<string, string>): void {
    this.entries.unshift({
      at: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {})
    });
    if (this.entries.length > 200) {
      this.entries.length = 200;
    }
  }
}

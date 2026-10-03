import type { AlertSender } from '../email/alerts';

export interface JobRecord {
  id: string;
  kind: string;
  startedAt: Date;
  finishedAt: Date | null;
  quotaUsed: number;
  itemsProcessed: number;
  error: string | null;
}

export interface JobRunner {
  start(kind: string): Promise<JobRecord>;
  finish(id: string, result: { quotaUsed: number; itemsProcessed: number; error?: string }): Promise<void>;
  isLocked(kind: string): Promise<boolean>;
  acquireLock(kind: string): Promise<boolean>;
  releaseLock(kind: string): Promise<void>;
  setAlertSender(sender: AlertSender): void;
  cleanAbandoned(): Promise<number>;
}

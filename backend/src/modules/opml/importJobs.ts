import type { ImportReport } from './opmlImporter.js';
import { randomUUID } from 'node:crypto';

export interface ImportJobState {
  status: 'running' | 'done' | 'error';
  processed: number;
  total: number;
  report?: ImportReport;
  error?: string;
}

const jobs = new Map<string, ImportJobState>();

export function createImportJob(): string {
  const id = randomUUID();
  jobs.set(id, { status: 'running', processed: 0, total: 0 });
  return id;
}

export function updateImportJob(id: string, patch: Partial<ImportJobState>): void {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, ...patch });
}

export function getImportJob(id: string): ImportJobState | undefined {
  return jobs.get(id);
}

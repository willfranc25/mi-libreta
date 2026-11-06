/** Contrato entre el motor de sincronización y el servidor. */
import type { SyncTable } from '../domain/types';

export interface PushOp {
  op_id: string;
  table: SyncTable;
  record_id: string;
  base_version: number;
  payload: Record<string, unknown>;
  device: string | null;
}

export type PushResult =
  | { op_id: string; status: 'applied'; version: number }
  | { op_id: string; status: 'conflict'; record: Record<string, unknown> }
  | { op_id: string; status: 'error'; error: string };

export type PullTable = SyncTable | 'grade_revisions';

export interface Remote {
  /** Aplica operaciones en orden. Debe ser idempotente por op_id. */
  push(ops: PushOp[]): Promise<PushResult[]>;
  /** Registros con server_seq > since, ordenados por server_seq. */
  pull(table: PullTable, since: number, limit: number): Promise<Record<string, unknown>[]>;
}

/** Error de red/conexión: los cambios se quedan en la cola y se reintentan. */
export class OfflineError extends Error {
  constructor(message = 'Sin conexión') {
    super(message);
    this.name = 'OfflineError';
  }
}

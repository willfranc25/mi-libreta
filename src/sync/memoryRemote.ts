/**
 * Servidor simulado en memoria con la MISMA semántica que la función SQL
 * `public.sync_push` (ver supabase/migrations). Se usa en pruebas
 * automáticas para simular varios dispositivos, desconexiones y respuestas
 * perdidas.
 */
import { sameData } from '../db/repo';
import { OfflineError, type PullTable, type PushOp, type PushResult, type Remote } from './remote';

type Row = Record<string, unknown> & { id: string; version: number; server_seq: number };

const SERVER_FIELDS = ['version', 'server_seq', 'owner_id'];

export class MemoryRemote implements Remote {
  tables = new Map<string, Map<string, Row>>();
  processed = new Map<string, PushResult>();
  seq = 0;
  online = true;
  /** Simula que el servidor aplica los cambios pero la respuesta se pierde. */
  loseNextResponse = false;
  pushCalls = 0;

  constructor(public ownerId = 'usuario-1') {}

  private table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  rows(name: string): Row[] {
    return [...this.table(name).values()];
  }

  async push(ops: PushOp[]): Promise<PushResult[]> {
    this.pushCalls++;
    if (!this.online) throw new OfflineError();
    const results = ops.map((op) => this.apply(op));
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new OfflineError('Se perdió la respuesta del servidor');
    }
    return structuredClone(results);
  }

  private apply(op: PushOp): PushResult {
    const done = this.processed.get(op.op_id);
    if (done) return done;

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(op.payload)) if (!SERVER_FIELDS.includes(k)) data[k] = v;

    const t = this.table(op.table);
    const existing = t.get(op.record_id);
    let result: PushResult;

    if (!existing) {
      const row: Row = {
        ...structuredClone(data),
        id: op.record_id,
        owner_id: this.ownerId,
        version: 1,
        server_seq: ++this.seq,
        updated_by_device: op.device,
      };
      t.set(op.record_id, row);
      this.revision(op.table, undefined, row);
      result = { op_id: op.op_id, status: 'applied', version: 1 };
    } else if (existing.version === op.base_version) {
      const row: Row = {
        ...existing,
        ...structuredClone(data),
        id: op.record_id,
        owner_id: this.ownerId,
        version: existing.version + 1,
        server_seq: ++this.seq,
        updated_by_device: op.device,
      };
      t.set(op.record_id, row);
      this.revision(op.table, existing, row);
      result = { op_id: op.op_id, status: 'applied', version: row.version };
    } else if (sameData(existing, data)) {
      // Ambos dispositivos llegaron al mismo valor: no es un conflicto.
      result = { op_id: op.op_id, status: 'applied', version: existing.version };
    } else {
      result = { op_id: op.op_id, status: 'conflict', record: structuredClone(existing) };
    }

    this.processed.set(op.op_id, result);
    return result;
  }

  private revision(table: string, before: Row | undefined, after: Row): void {
    if (table !== 'grades') return;
    const id = crypto.randomUUID();
    this.table('grade_revisions').set(id, {
      id,
      owner_id: this.ownerId,
      grade_id: after.id,
      old_status: (before?.status as string) ?? null,
      old_value: (before?.value as string) ?? null,
      old_qualitative: (before?.qualitative as string) ?? null,
      new_status: after.status as string,
      new_value: (after.value as string) ?? null,
      new_qualitative: (after.qualitative as string) ?? null,
      device: (after.updated_by_device as string) ?? null,
      changed_at: new Date().toISOString(),
      version: 1,
      server_seq: ++this.seq,
    });
  }

  async pull(table: PullTable, since: number, limit: number): Promise<Record<string, unknown>[]> {
    if (!this.online) throw new OfflineError();
    return structuredClone(
      this.rows(table)
        .filter((r) => r.server_seq > since)
        .sort((a, b) => a.server_seq - b.server_seq)
        .slice(0, limit),
    );
  }
}

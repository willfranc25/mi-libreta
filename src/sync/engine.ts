/**
 * Motor de sincronización offline-first.
 *
 * Reglas:
 *  - Un cambio solo se considera sincronizado cuando el servidor lo confirma.
 *  - Cada operación tiene un op_id único: reintentarla nunca duplica datos.
 *  - Si otro dispositivo cambió el mismo registro, NO se sobrescribe:
 *    se crea un conflicto para que la profesora elija el valor correcto.
 *  - Ante cualquier error, las operaciones permanecen en la cola local.
 */
import type { ConflictEntry, LibretaDB, OutboxOp } from '../db/db';
import { DATA_TABLES } from '../db/db';
import { getContext, sameData, toPayload } from '../db/repo';
import type { SyncTable } from '../domain/types';
import { OfflineError, type PullTable, type PushOp, type Remote } from './remote';

export interface SyncReport {
  pushed: number;
  conflicts: number;
  errors: number;
  pulled: number;
}

const PUSH_BATCH = 100;
const PULL_PAGE = 500;
const PULL_TABLES: PullTable[] = [...DATA_TABLES, 'grade_revisions'];

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private db: LibretaDB,
    private remote: Remote,
  ) {}

  /** Ejecuta una sincronización completa (enviar y luego descargar). */
  sync(): Promise<SyncReport> {
    // Evita dos sincronizaciones simultáneas en la misma pestaña.
    if (this.running) return this.running;
    const run = async () => {
      const exec = async () => {
        const report: SyncReport = { pushed: 0, conflicts: 0, errors: 0, pulled: 0 };
        await this.push(report);
        await this.pull(report);
        // Lo descargado pudo cambiar versiones: se intenta enviar lo pendiente otra vez.
        await this.push(report);
        await this.db.setMeta('last_sync_at', new Date().toISOString());
        return report;
      };
      // Entre pestañas del mismo navegador se usa Web Locks si existe.
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (locks) return locks.request(`milibreta-sync-${this.db.name}`, exec) as Promise<SyncReport>;
      return exec();
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Envío
  // -------------------------------------------------------------------------
  async push(report: SyncReport = { pushed: 0, conflicts: 0, errors: 0, pulled: 0 }): Promise<SyncReport> {
    const device = getContext(this.db).deviceLabel;
    const failed = new Set<number>();

    for (;;) {
      const all = await this.db.outbox.orderBy('seq').toArray();
      // Solo la primera operación de cada registro por lote, para que las
      // siguientes usen la versión que devuelva el servidor.
      const seen = new Set<string>();
      const batch: OutboxOp[] = [];
      for (const op of all) {
        if (seen.has(op.record_id)) continue;
        seen.add(op.record_id);
        if (failed.has(op.seq!)) continue;
        batch.push(op);
        if (batch.length >= PUSH_BATCH) break;
      }
      if (batch.length === 0) break;

      // Se marca el intento ANTES de enviar: desde ahora la operación no se fusiona
      // con cambios nuevos (conserva su idempotencia).
      await this.db.transaction('rw', this.db.outbox, async () => {
        for (const op of batch) await this.db.outbox.update(op.seq!, { attempts: op.attempts + 1 });
      });

      const pushOps: PushOp[] = batch.map((op) => ({
        op_id: op.op_id,
        table: op.table,
        record_id: op.record_id,
        base_version: op.base_version,
        payload: op.payload,
        device,
      }));

      let results;
      try {
        results = await this.remote.push(pushOps);
      } catch (e) {
        if (e instanceof OfflineError) throw e;
        throw new OfflineError(e instanceof Error ? e.message : 'Error de conexión');
      }

      let progress = false;
      const tables = [...new Set(batch.map((b) => b.table))].map((t) => this.db.table(t));
      await this.db.transaction('rw', [this.db.outbox, this.db.conflicts, ...tables], async () => {
        for (const result of results) {
          const op = batch.find((b) => b.op_id === result.op_id);
          if (!op) continue;
          const tbl = this.db.table(op.table);

          if (result.status === 'applied') {
            progress = true;
            report.pushed++;
            await this.db.outbox.delete(op.seq!);
            const local = await tbl.get(op.record_id);
            if (local && local.version < result.version) await tbl.update(op.record_id, { version: result.version });
            // Las siguientes operaciones del mismo registro parten de la nueva versión.
            const later = await this.db.outbox.where('record_id').equals(op.record_id).toArray();
            for (const l of later) await this.db.outbox.update(l.seq!, { base_version: result.version });
          } else if (result.status === 'conflict') {
            progress = true;
            report.conflicts++;
            const pending = await this.db.outbox.where('record_id').equals(op.record_id).toArray();
            await this.db.outbox.bulkDelete(pending.map((p) => p.seq!));
            const local = await tbl.get(op.record_id);
            const entry: ConflictEntry = {
              id: `${op.table}:${op.record_id}`,
              table: op.table,
              record_id: op.record_id,
              local_payload: local ? toPayload(local) : op.payload,
              server_record: result.record,
              local_device: device,
              detected_at: new Date().toISOString(),
            };
            await this.db.conflicts.put(entry);
          } else {
            report.errors++;
            failed.add(op.seq!);
            await this.db.outbox.update(op.seq!, { last_error: result.error.slice(0, 300) });
          }
        }
      });
      if (!progress && batch.every((b) => failed.has(b.seq!))) continue;
      if (!progress) break;
    }
    return report;
  }

  // -------------------------------------------------------------------------
  // Descarga
  // -------------------------------------------------------------------------
  async pull(report: SyncReport = { pushed: 0, conflicts: 0, errors: 0, pulled: 0 }): Promise<SyncReport> {
    for (const table of PULL_TABLES) {
      let cursor = (await this.db.getMeta<number>(`cursor:${table}`)) ?? 0;
      for (;;) {
        let rows: Record<string, unknown>[];
        try {
          rows = await this.remote.pull(table, cursor, PULL_PAGE);
        } catch (e) {
          if (e instanceof OfflineError) throw e;
          throw new OfflineError(e instanceof Error ? e.message : 'Error de conexión');
        }
        if (rows.length === 0) break;
        const tbl = this.db.table(table);
        await this.db.transaction('rw', [tbl, this.db.outbox, this.db.conflicts, this.db.meta], async () => {
          for (const row of rows) {
            const id = row.id as string;
            const seq = Number(row.server_seq);
            if (seq > cursor) cursor = seq;
            if (table !== 'grade_revisions') {
              const conflict = await this.db.conflicts.get(`${table}:${id}`);
              if (conflict) {
                // Se actualiza la versión del servidor mostrada en el conflicto.
                if (Number(row.version) >= Number(conflict.server_record.version)) {
                  await this.db.conflicts.update(conflict.id, { server_record: row });
                }
                continue;
              }
              const pendingCount = await this.db.outbox.where('record_id').equals(id).count();
              if (pendingCount > 0) continue; // el envío pendiente resolverá la versión
              const local = await tbl.get(id);
              if (local && Number(local.version) > Number(row.version)) continue;
              if (local && Number(local.version) === Number(row.version) && sameData(local, row)) {
                if (local.server_seq !== seq) await tbl.update(id, { server_seq: seq });
                continue;
              }
            }
            await tbl.put(normalizeRow(row));
            report.pulled++;
          }
          await this.db.setMeta(`cursor:${table}`, cursor);
        });
        if (rows.length < PULL_PAGE) break;
      }
    }
    return report;
  }
}

/** Ajusta tipos que llegan del servidor (fechas, números). */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (out.version !== undefined) out.version = Number(out.version);
  if (out.server_seq !== undefined && out.server_seq !== null) out.server_seq = Number(out.server_seq);
  return out;
}

// ---------------------------------------------------------------------------
// Resolución de conflictos
// ---------------------------------------------------------------------------
export async function resolveConflict(
  db: LibretaDB,
  conflictId: string,
  choice: 'local' | 'server',
): Promise<void> {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) return;
  const tbl = db.table(conflict.table as SyncTable);
  const server = normalizeRow(conflict.server_record);
  const serverVersion = Number(server.version);
  const now = new Date().toISOString();
  const ctx = getContext(db);

  await db.transaction('rw', [tbl, db.outbox, db.conflicts, db.audit_events, db.local_revisions], async () => {
    const local = await tbl.get(conflict.record_id);
    if (choice === 'server') {
      await tbl.put(server);
    } else {
      const row = {
        ...server,
        ...conflict.local_payload,
        version: serverVersion,
        updated_at: now,
        updated_by_device: ctx.deviceLabel,
      };
      await tbl.put(row);
      await db.outbox.add({
        op_id: crypto.randomUUID(),
        table: conflict.table,
        record_id: conflict.record_id,
        payload: toPayload(row),
        base_version: serverVersion,
        created_at: now,
        attempts: 0,
        last_error: null,
      });
    }
    if (conflict.table === 'grades') {
      await db.local_revisions.add({
        table: 'grades',
        record_id: conflict.record_id,
        before: local ?? null,
        after: (await tbl.get(conflict.record_id)) as Record<string, unknown>,
        at: now,
      });
    }
    await db.conflicts.delete(conflictId);
    const auditRow = {
      id: crypto.randomUUID(),
      owner_id: ctx.ownerId,
      version: 0,
      updated_at: now,
      deleted_at: null,
      updated_by_device: ctx.deviceLabel,
      server_seq: null,
      event_type: 'conflict_resolved',
      entity: conflict.table,
      entity_id: conflict.record_id,
      details: { choice },
    };
    await db.audit_events.put(auditRow);
    if (ctx.syncEnabled) {
      await db.outbox.add({
        op_id: crypto.randomUUID(),
        table: 'audit_events',
        record_id: auditRow.id,
        payload: toPayload(auditRow),
        base_version: 0,
        created_at: now,
        attempts: 0,
        last_error: null,
      });
    }
  });
}

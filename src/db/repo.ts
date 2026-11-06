/**
 * Escrituras locales. Cada cambio:
 *  1. se valida con Zod,
 *  2. se guarda en IndexedDB,
 *  3. se agrega a la cola durable de sincronización (si hay cuenta en la nube),
 *  4. queda en el historial local para poder deshacerlo.
 * Todo dentro de UNA transacción: o se guarda todo, o nada.
 */
import type { LibretaDB, OutboxOp } from './db';
import { TABLE_SCHEMAS, type SyncTable, type TableRowMap } from '../domain/types';
import { newId } from '../lib/ids';

export interface DbContext {
  /** Nombre visible de este dispositivo (p. ej. «Celular Android»). */
  deviceLabel: string;
  /** id del usuario de Supabase, o null en modo local/demostración. */
  ownerId: string | null;
  /** true si los cambios deben enviarse al servidor. */
  syncEnabled: boolean;
}

const contexts = new WeakMap<LibretaDB, DbContext>();
const listeners = new Set<() => void>();

export function configureDb(db: LibretaDB, ctx: DbContext): void {
  contexts.set(db, ctx);
}

export function getContext(db: LibretaDB): DbContext {
  return contexts.get(db) ?? { deviceLabel: 'Este dispositivo', ownerId: null, syncEnabled: false };
}

/** Se llama después de cada cambio local (la sincronización lo usa para enviar pronto). */
export function onLocalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Campos que solo administra el servidor y no se envían. */
const SERVER_FIELDS = ['version', 'server_seq', 'owner_id'];
/** Campos que no cuentan como «cambio de datos». */
const NON_DATA_FIELDS = ['version', 'server_seq', 'owner_id', 'updated_at', 'updated_by_device'];

export function toPayload(row: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SERVER_FIELDS.includes(k)) payload[k] = v;
  return payload;
}

export function sameData(a: Record<string, unknown> | undefined | null, b: Record<string, unknown>): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !NON_DATA_FIELDS.includes(k)));
  for (const k of keys) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  }
  return true;
}

type Row<T extends SyncTable> = TableRowMap[T];
type MetaKeys = 'owner_id' | 'version' | 'updated_at' | 'deleted_at' | 'updated_by_device' | 'server_seq';
export type RowInput<T extends SyncTable> = Omit<Row<T>, MetaKeys | 'id'> & { id?: string; deleted_at?: string | null };
export type RowPatch<T extends SyncTable> = Partial<Omit<Row<T>, MetaKeys | 'id'>> & { deleted_at?: string | null };

const MAX_LOCAL_REVISIONS = 1000;

/** Guarda varios registros en una sola transacción. */
export async function saveMany<T extends SyncTable>(
  db: LibretaDB,
  table: T,
  inputs: (RowInput<T> | (RowPatch<T> & { id: string }))[],
): Promise<Row<T>[]> {
  const ctx = getContext(db);
  const tbl = db.table(table);
  const now = new Date().toISOString();
  const saved: Row<T>[] = [];

  await db.transaction('rw', [tbl, db.outbox, db.local_revisions], async () => {
    for (const input of inputs) {
      const id = (input as { id?: string }).id ?? newId();
      const existing = (await tbl.get(id)) as Row<T> | undefined;
      const candidate = {
        ...(existing ?? {}),
        ...input,
        id,
        owner_id: existing?.owner_id ?? ctx.ownerId,
        version: existing?.version ?? 0,
        updated_at: now,
        deleted_at: (input as { deleted_at?: string | null }).deleted_at ?? existing?.deleted_at ?? null,
        updated_by_device: ctx.deviceLabel,
        server_seq: existing?.server_seq ?? null,
      };
      const row = TABLE_SCHEMAS[table].parse(candidate) as Row<T>;

      if (existing && sameData(existing as Record<string, unknown>, row as Record<string, unknown>)) {
        saved.push(existing);
        continue;
      }
      await tbl.put(row);
      saved.push(row);

      if (ctx.syncEnabled) {
        const payload = toPayload(row as Record<string, unknown>);
        // Si ya hay un cambio pendiente que NUNCA se envió, se reemplaza (evita
        // enviar versiones intermedias). Si ya se intentó enviar, se agrega
        // uno nuevo para mantener la idempotencia del anterior.
        const pending = await db.outbox.where('record_id').equals(id).toArray();
        const unsent = pending.find((op) => op.attempts === 0 && op.table === table);
        if (unsent) {
          await db.outbox.update(unsent.seq!, { payload });
        } else {
          const op: OutboxOp = {
            op_id: newId(),
            table,
            record_id: id,
            payload,
            base_version: existing?.version ?? 0,
            created_at: now,
            attempts: 0,
            last_error: null,
          };
          await db.outbox.add(op);
        }
      }

      if (table === 'grades') {
        await db.local_revisions.add({
          table,
          record_id: id,
          before: (existing as Record<string, unknown> | undefined) ?? null,
          after: row as Record<string, unknown>,
          at: now,
        });
      }
    }
  });

  // Limpieza del historial local (fuera de la transacción principal).
  const count = await db.local_revisions.count();
  if (count > MAX_LOCAL_REVISIONS) {
    const old = await db.local_revisions.orderBy('id').limit(count - MAX_LOCAL_REVISIONS).primaryKeys();
    await db.local_revisions.bulkDelete(old);
  }

  listeners.forEach((fn) => fn());
  return saved;
}

export async function save<T extends SyncTable>(
  db: LibretaDB,
  table: T,
  input: RowInput<T> | (RowPatch<T> & { id: string }),
): Promise<Row<T>> {
  const [row] = await saveMany(db, table, [input]);
  return row;
}

/** Eliminación lógica: el registro queda marcado y se sincroniza la eliminación. */
export async function softDelete(db: LibretaDB, table: SyncTable, id: string): Promise<void> {
  await save(db, table, { id, deleted_at: new Date().toISOString() } as never);
}

/** Restaura un registro eliminado lógicamente. */
export async function restore(db: LibretaDB, table: SyncTable, id: string): Promise<void> {
  await save(db, table, { id, deleted_at: null } as never);
}

/** Registra un evento de auditoría sin datos personales. */
export async function audit(
  db: LibretaDB,
  event_type: string,
  details: Record<string, unknown> = {},
  entity: string | null = null,
  entity_id: string | null = null,
): Promise<void> {
  await save(db, 'audit_events', { event_type, entity, entity_id, details });
}

export function isLive<T extends { deleted_at: string | null }>(row: T | undefined | null): row is T {
  return !!row && row.deleted_at === null;
}

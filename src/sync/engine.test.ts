/**
 * Pruebas del motor de sincronización offline-first y de resolución de conflictos.
 * Verifica:
 * - Cola durable en IndexedDB con idempotencia (op_id).
 * - Sincronización entre dos dispositivos ("Celular" y "Computadora").
 * - Pérdida de respuesta del servidor (reintento sin duplicar revisiones ni datos).
 * - Modificación concurrente sin conexión (detección de conflicto, nunca sobrescribe silenciosamente).
 * - Resolución de conflicto conservando historial y auditoría.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LibretaDB } from '../db/db';
import { configureDb, save } from '../db/repo';
import { gradeIdFor } from '../lib/ids';
import { resolveConflict, SyncEngine } from './engine';
import { MemoryRemote } from './memoryRemote';

function createDeviceDb(name: string, deviceLabel: string, ownerId = 'prof-1'): LibretaDB {
  const db = new LibretaDB(`${name}-${crypto.randomUUID()}`);
  configureDb(db, { deviceLabel, ownerId, syncEnabled: true });
  return db;
}

describe('Sincronización offline-first y concurrencia entre dispositivos', () => {
  let remote: MemoryRemote;
  let phoneDb: LibretaDB;
  let pcDb: LibretaDB;
  let phoneSync: SyncEngine;
  let pcSync: SyncEngine;

  beforeEach(() => {
    remote = new MemoryRemote('prof-1');
    phoneDb = createDeviceDb('phone', 'Celular Android');
    pcDb = createDeviceDb('pc', 'Computadora Windows');
    phoneSync = new SyncEngine(phoneDb, remote);
    pcSync = new SyncEngine(pcDb, remote);
  });

  it('sincroniza notas registradas sin internet del celular a la computadora', async () => {
    remote.online = false;

    const gId = await gradeIdFor('eval-1', 'est-1');
    await save(phoneDb, 'grades', {
      id: gId,
      evaluation_id: 'eval-1',
      student_id: 'est-1',
      status: 'graded',
      value: '9.25',
      qualitative: null,
    });

    // Mientras no hay internet, versión es 0 ("Guardado en este dispositivo")
    const localBefore = await phoneDb.grades.get(gId);
    expect(localBefore?.version).toBe(0);
    expect(await phoneDb.outbox.count()).toBe(1);

    await expect(phoneSync.sync()).rejects.toThrow(/Sin conexión/);
    expect(await phoneDb.outbox.count()).toBe(1);

    // Recupera conexión y sincroniza
    remote.online = true;
    const report = await phoneSync.sync();
    expect(report.pushed).toBe(1);
    expect(await phoneDb.outbox.count()).toBe(0);

    const localAfter = await phoneDb.grades.get(gId);
    expect(localAfter?.version).toBe(1);

    // La computadora descarga los cambios
    const pcReport = await pcSync.sync();
    expect(pcReport.pulled).toBeGreaterThanOrEqual(1);
    const onPc = await pcDb.grades.get(gId);
    expect(onPc?.value).toBe('9.25');
    expect(onPc?.version).toBe(1);
    expect(onPc?.updated_by_device).toBe('Celular Android');
  });

  it('es idempotente cuando se pierde la respuesta de red y reintenta sin duplicar', async () => {
    const gId = await gradeIdFor('eval-1', 'est-2');
    await save(phoneDb, 'grades', {
      id: gId,
      evaluation_id: 'eval-1',
      student_id: 'est-2',
      status: 'graded',
      value: '8.5',
      qualitative: null,
    });

    // El servidor aplica la operación pero la respuesta se corta antes de llegar al celular
    remote.loseNextResponse = true;
    await expect(phoneSync.sync()).rejects.toThrow();

    // Sigue en la cola local porque el servidor no confirmó al cliente
    expect(await phoneDb.outbox.count()).toBe(1);

    // Reintento: el servidor reconoce el mismo op_id y devuelve el resultado sin duplicar
    const report = await phoneSync.sync();
    expect(report.pushed).toBe(1);
    expect(await phoneDb.outbox.count()).toBe(0);
    expect((await phoneDb.grades.get(gId))?.version).toBe(1);
    expect(remote.rows('grade_revisions').filter((r) => r.grade_id === gId)).toHaveLength(1);
  });

  it('detecta conflicto cuando celular y computadora editan la misma nota sin conexión y permite resolverlo', async () => {
    const gId = await gradeIdFor('eval-1', 'est-3');
    await save(phoneDb, 'grades', {
      id: gId,
      evaluation_id: 'eval-1',
      student_id: 'est-3',
      status: 'graded',
      value: '7.00',
      qualitative: null,
    });
    await phoneSync.sync();
    await pcSync.sync();

    // Ambos dispositivos se desconectan y modifican la misma nota con valores distintos
    remote.online = false;
    await save(phoneDb, 'grades', {
      id: gId,
      evaluation_id: 'eval-1',
      student_id: 'est-3',
      status: 'graded',
      value: '8.50',
      qualitative: null,
    });
    await save(pcDb, 'grades', {
      id: gId,
      evaluation_id: 'eval-1',
      student_id: 'est-3',
      status: 'graded',
      value: '9.00',
      qualitative: null,
    });

    // Vuelve internet: el celular sincroniza primero (versión pasa a 2 en el servidor)
    remote.online = true;
    await phoneSync.sync();
    expect((await phoneDb.grades.get(gId))?.version).toBe(2);

    // La computadora intenta sincronizar su cambio basado en versión 1 → CONFLICTO
    const pcReport = await pcSync.sync();
    expect(pcReport.conflicts).toBe(1);

    const conflicts = await pcDb.conflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local_payload.value).toBe('9.00');
    expect(conflicts[0].server_record.value).toBe('8.50');
    expect(conflicts[0].server_record.updated_by_device).toBe('Celular Android');
    expect(conflicts[0].local_device).toBe('Computadora Windows');

    // La profesora elige conservar la versión de la computadora (9,00)
    await resolveConflict(pcDb, conflicts[0].id, 'local');
    expect(await pcDb.conflicts.count()).toBe(0);

    // Se sincroniza la resolución y ambos dispositivos quedan en 9,00 (versión 3)
    await pcSync.sync();
    await phoneSync.sync();

    expect((await pcDb.grades.get(gId))?.value).toBe('9.00');
    expect((await phoneDb.grades.get(gId))?.value).toBe('9.00');
    expect((await phoneDb.grades.get(gId))?.version).toBe(3);

    // El historial conserva todas las modificaciones (7.00 → 8.50 → 9.00)
    const revisions = remote.rows('grade_revisions').filter((r) => r.grade_id === gId);
    expect(revisions.map((r) => r.new_value)).toEqual(['7.00', '8.50', '9.00']);
  });
});

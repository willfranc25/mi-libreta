import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LibretaDB } from '../db/db';
import { configureDb } from '../db/repo';
import { seedDemoData } from '../db/seedDemo';
import { createEncryptedBackup, createPlainBackup, restoreBackup, verifyAndParseBackup } from './backup';

describe('Respaldos completos, cifrado AES-GCM y restauración verificada', () => {
  it('exporta, verifica integridad SHA-256 y restaura un respaldo completo tras reinstalación', async () => {
    const dbOrigin = new LibretaDB(`origin-${crypto.randomUUID()}`);
    configureDb(dbOrigin, { deviceLabel: 'Celular', ownerId: null, syncEnabled: false });
    await seedDemoData(dbOrigin);

    const originalGradesCount = await dbOrigin.grades.count();
    expect(originalGradesCount).toBeGreaterThan(20);

    const backup = await createPlainBackup(dbOrigin);
    const json = JSON.stringify(backup);

    // Si alguien altera un byte del archivo, la validación SHA-256 lo rechaza antes de tocar la base
    const tampered = json.replace('9.25', '10.0');
    await expect(verifyAndParseBackup(tampered)).rejects.toThrow(/integridad/);

    // Restauración en un dispositivo limpio (simulando pérdida o cambio de teléfono)
    const dbNewPhone = new LibretaDB(`newphone-${crypto.randomUUID()}`);
    configureDb(dbNewPhone, { deviceLabel: 'Teléfono Nuevo', ownerId: null, syncEnabled: false });

    const counts = await restoreBackup(dbNewPhone, json);
    expect(counts.grades).toBe(originalGradesCount);
    expect(await dbNewPhone.grades.count()).toBe(originalGradesCount);
    expect(await dbNewPhone.students.count()).toBe(await dbOrigin.students.count());
  });

  it('cifra con contraseña (AES-GCM 256) y rechaza contraseñas incorrectas', async () => {
    const db = new LibretaDB(`enc-${crypto.randomUUID()}`);
    configureDb(db, { deviceLabel: 'PC', ownerId: null, syncEnabled: false });
    await seedDemoData(db);

    const encrypted = await createEncryptedBackup(db, 'ClaveColegio2026');
    const raw = JSON.stringify(encrypted);

    // El texto cifrado NO expone nombres de estudiantes en claro
    expect(raw).not.toContain('Alcívar');

    await expect(verifyAndParseBackup(raw, 'ClaveEquivocada')).rejects.toThrow(/Contraseña incorrecta/);

    const dbRestored = new LibretaDB(`enc-restored-${crypto.randomUUID()}`);
    const counts = await restoreBackup(dbRestored, raw, 'ClaveColegio2026');
    expect(counts.students).toBe(11);
  });
});

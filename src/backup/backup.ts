/**
 * Sistema de respaldos seguros y restauración verificada.
 *
 * - Permite exportar un respaldo completo protegido con contraseña (cifrado real
 *   AES-GCM de 256 bits con clave derivada por PBKDF2-SHA256 de 150 000 iteraciones)
 *   o en formato JSON verificado con huella de integridad SHA-256.
 * - Verifica la integridad y el esquema (Zod) antes de restaurar cualquier dato.
 * - Advierte si existen operaciones pendientes de sincronizar antes de reemplazar datos.
 */
import { DATA_TABLES, type LibretaDB } from '../db/db';
import { audit, getContext, toPayload } from '../db/repo';
import { TABLE_SCHEMAS, type SyncTable } from '../domain/types';

export interface PlainBackupBundle {
  format: 'mi-libreta-backup-v1';
  created_at: string;
  device_label: string;
  checksum_sha256: string;
  tables: Record<SyncTable, unknown[]>;
}

export interface EncryptedBackupEnvelope {
  format: 'mi-libreta-encrypted-backup-v1';
  created_at: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt_base64: string;
  iv_base64: string;
  ciphertext_base64: string;
}

export type BackupFileContent = PlainBackupBundle | EncryptedBackupEnvelope;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Construye un respaldo completo con suma de verificación SHA-256. */
export async function createPlainBackup(db: LibretaDB): Promise<PlainBackupBundle> {
  const ctx = getContext(db);
  const tables = {} as Record<SyncTable, unknown[]>;

  for (const t of DATA_TABLES) {
    tables[t] = await db.table(t).toArray();
  }

  const canonical = JSON.stringify(tables);
  const checksum_sha256 = await sha256Hex(canonical);
  const created_at = new Date().toISOString();

  await db.setMeta('last_backup_at', created_at);
  await audit(db, 'backup_exported', { encrypted: false });

  return {
    format: 'mi-libreta-backup-v1',
    created_at,
    device_label: ctx.deviceLabel,
    checksum_sha256,
    tables,
  };
}

/** Construye un respaldo cifrado con AES-GCM-256 a partir de una contraseña de la profesora. */
export async function createEncryptedBackup(
  db: LibretaDB,
  passphrase: string,
): Promise<EncryptedBackupEnvelope> {
  if (passphrase.trim().length < 4) {
    throw new Error('Escriba una contraseña de al menos 4 caracteres para proteger el respaldo.');
  }
  const plain = await createPlainBackup(db);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 150_000;
  const key = await deriveKey(passphrase, salt, iterations);
  const encoded = new TextEncoder().encode(JSON.stringify(plain));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoded),
  );

  const created_at = new Date().toISOString();
  await db.setMeta('last_backup_at', created_at);
  await audit(db, 'backup_exported', { encrypted: true });

  return {
    format: 'mi-libreta-encrypted-backup-v1',
    created_at,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt_base64: bytesToBase64(salt),
    iv_base64: bytesToBase64(iv),
    ciphertext_base64: bytesToBase64(ciphertext),
  };
}

/** Valida la integridad y descifra (si corresponde) un archivo de respaldo sin modificar la base. */
export async function verifyAndParseBackup(
  rawJson: string,
  passphrase?: string,
): Promise<{
  bundle: PlainBackupBundle;
  counts: { students: number; evaluations: number; grades: number; groups: number };
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('El archivo seleccionado no tiene un formato de respaldo válido.');
  }

  if (!parsed || typeof parsed !== 'object' || !('format' in parsed)) {
    throw new Error('Este archivo no parece ser un respaldo de Mi Libreta.');
  }

  let bundle: PlainBackupBundle;
  const format = (parsed as { format: string }).format;

  if (format === 'mi-libreta-encrypted-backup-v1') {
    if (!passphrase) {
      throw new Error('Este respaldo está protegido con contraseña. Escriba la contraseña para abrirlo.');
    }
    const env = parsed as EncryptedBackupEnvelope;
    try {
      const salt = base64ToBytes(env.salt_base64);
      const iv = base64ToBytes(env.iv_base64);
      const cipher = base64ToBytes(env.ciphertext_base64);
      const key = await deriveKey(passphrase, salt, env.iterations || 150_000);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        cipher as BufferSource,
      );
      bundle = JSON.parse(new TextDecoder().decode(decrypted)) as PlainBackupBundle;
    } catch {
      throw new Error('Contraseña incorrecta o archivo de respaldo dañado.');
    }
  } else if (format === 'mi-libreta-backup-v1') {
    bundle = parsed as PlainBackupBundle;
  } else {
    throw new Error('Versión de archivo de respaldo no reconocida.');
  }

  const canonical = JSON.stringify(bundle.tables);
  const actualHash = await sha256Hex(canonical);
  if (actualHash !== bundle.checksum_sha256) {
    throw new Error('La verificación de integridad falló: el archivo fue modificado o está incompleto.');
  }

  // Validación estricta con Zod de cada registro antes de tocar la base local
  for (const table of DATA_TABLES) {
    const rows = bundle.tables[table] ?? [];
    if (!Array.isArray(rows)) {
      throw new Error(`La tabla ${table} del respaldo es inválida.`);
    }
    const schema = TABLE_SCHEMAS[table];
    for (const row of rows) {
      const res = schema.safeParse(row);
      if (!res.success) {
        throw new Error(`El respaldo contiene datos inválidos en ${table}.`);
      }
    }
  }

  return {
    bundle,
    counts: {
      students: (bundle.tables.students ?? []).length,
      evaluations: (bundle.tables.evaluations ?? []).length,
      grades: (bundle.tables.grades ?? []).length,
      groups: (bundle.tables.class_groups ?? []).length,
    },
  };
}

/** Restaura un respaldo previamente verificado en una sola transacción atómica. */
export async function restoreBackup(
  db: LibretaDB,
  rawJson: string,
  passphrase?: string,
): Promise<{ students: number; evaluations: number; grades: number; groups: number }> {
  const { bundle, counts } = await verifyAndParseBackup(rawJson, passphrase);
  const ctx = getContext(db);
  const now = new Date().toISOString();

  const tables = DATA_TABLES.map((t) => db.table(t));
  await db.transaction('rw', [...tables, db.outbox, db.conflicts, db.meta], async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
    }
    await db.outbox.clear();
    await db.conflicts.clear();

    for (const t of DATA_TABLES) {
      const rows = (bundle.tables[t] ?? []) as Record<string, unknown>[];
      const validated = rows.map((r) => TABLE_SCHEMAS[t].parse(r));
      if (validated.length > 0) {
        await db.table(t).bulkPut(validated);
      }
      if (ctx.syncEnabled) {
        for (const r of validated) {
          const rec = r as Record<string, unknown>;
          await db.outbox.add({
            op_id: crypto.randomUUID(),
            table: t,
            record_id: rec.id as string,
            payload: toPayload(rec),
            base_version: Number(rec.version ?? 0),
            created_at: now,
            attempts: 0,
            last_error: null,
          });
        }
      }
    }
    await db.setMeta('setup_completed', true);
    await db.setMeta('last_restored_at', now);
  });

  await audit(db, 'backup_restored', counts);
  return counts;
}

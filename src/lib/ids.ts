/** Identificadores estables (UUID). */

export function newId(): string {
  return crypto.randomUUID();
}

// Espacio de nombres propio para UUID v5 de Mi Libreta.
const NAMESPACE = '6f1c2a4e-3b7d-4c55-9a1e-2d0f5b8c9e71';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * UUID v5 determinista. Se usa para las calificaciones: la nota de un
 * estudiante en una evaluación tiene SIEMPRE el mismo id en todos los
 * dispositivos, así dos dispositivos sin conexión no crean duplicados y
 * cualquier diferencia se detecta como conflicto.
 */
export async function deterministicId(name: string): Promise<string> {
  const ns = uuidToBytes(NAMESPACE);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns);
  data.set(nameBytes, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  const b = hash.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b);
}

export function gradeIdFor(evaluationId: string, studentId: string): Promise<string> {
  return deterministicId(`grade:${evaluationId}:${studentId}`);
}

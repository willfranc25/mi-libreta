/**
 * Lectura y validación de notas escritas por la profesora.
 * Acepta coma o punto decimal y valida contra la escala configurada.
 */
import Decimal from 'decimal.js';
import type { GradingConfig, GradeStatus } from './types';

export type ParsedGradeInput =
  | { ok: true; status: 'graded'; value: string; qualitative: null }
  | { ok: true; status: 'graded'; value: null; qualitative: string }
  | { ok: true; status: Exclude<GradeStatus, 'graded'>; value: null; qualitative: null }
  | { ok: false; error: string };

const ABSENT_WORDS = ['aus', 'ausente'];
const PENDING_WORDS = ['pen', 'pendiente'];
const EMPTY_WORDS = ['', '-', '—'];

/**
 * Convierte el texto ingresado en una calificación válida.
 * - "8,5" y "8.5" son equivalentes.
 * - En escala numérica, "a" = ausente y "p" = pendiente (atajos de teclado).
 * - Texto vacío = sin registrar.
 */
export function parseGradeInput(raw: string, config: GradingConfig): ParsedGradeInput {
  const text = raw.trim().toLowerCase();

  if (EMPTY_WORDS.includes(text)) {
    return { ok: true, status: 'empty', value: null, qualitative: null };
  }
  if (ABSENT_WORDS.includes(text) || (config.mode === 'quantitative' && text === 'a')) {
    return { ok: true, status: 'absent', value: null, qualitative: null };
  }
  if (PENDING_WORDS.includes(text) || (config.mode === 'quantitative' && text === 'p')) {
    return { ok: true, status: 'pending', value: null, qualitative: null };
  }

  if (config.mode === 'qualitative') {
    const option = config.qualitativeOptions.find((o) => o.code.toLowerCase() === text);
    if (!option) {
      const codes = config.qualitativeOptions.map((o) => o.code).join(', ');
      return { ok: false, error: `Escriba una de estas opciones: ${codes}` };
    }
    return { ok: true, status: 'graded', value: null, qualitative: option.code };
  }

  const normalized = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized) && !/^\.\d+$/.test(normalized)) {
    return { ok: false, error: 'Escriba solo un número, por ejemplo 8,5' };
  }
  const value = new Decimal(normalized.startsWith('.') ? `0${normalized}` : normalized);
  const decimals = value.decimalPlaces();
  if (decimals > config.scale.inputDecimals) {
    return {
      ok: false,
      error:
        config.scale.inputDecimals === 0
          ? 'Use números enteros, sin decimales'
          : `Use máximo ${config.scale.inputDecimals} decimales`,
    };
  }
  const min = new Decimal(config.scale.min);
  const max = new Decimal(config.scale.max);
  if (value.lessThan(min) || value.greaterThan(max)) {
    return {
      ok: false,
      error: `La nota debe estar entre ${formatDecimal(min.toString())} y ${formatDecimal(max.toString())}`,
    };
  }
  return { ok: true, status: 'graded', value: value.toString(), qualitative: null };
}

/** Muestra un decimal con coma, como se escribe en Ecuador: "8,50". */
export function formatDecimal(value: string | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Decimal(value);
  const text = decimals === undefined ? d.toString() : d.toFixed(decimals, Decimal.ROUND_DOWN);
  return text.replace('.', ',');
}

/** Texto que se muestra en una celda de la libreta. */
export function gradeDisplay(
  grade: { status: GradeStatus; value: string | null; qualitative: string | null } | undefined,
): string {
  if (!grade) return '';
  switch (grade.status) {
    case 'graded':
      return grade.qualitative ?? formatDecimal(grade.value);
    case 'absent':
      return 'Aus.';
    case 'pending':
      return 'Pend.';
    default:
      return '';
  }
}

/** Texto editable (lo que aparece al entrar en la celda). */
export function gradeEditText(
  grade: { status: GradeStatus; value: string | null; qualitative: string | null } | undefined,
): string {
  if (!grade) return '';
  if (grade.status === 'graded') return grade.qualitative ?? formatDecimal(grade.value);
  if (grade.status === 'absent') return 'aus';
  if (grade.status === 'pending') return 'pen';
  return '';
}

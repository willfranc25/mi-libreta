/**
 * Importación de listados de estudiantes desde CSV o Excel (.xlsx),
 * detección de posibles duplicados y corrección interactiva de errores.
 *
 * Nunca identifica estudiantes solo por número de fila; cada estudiante
 * recibe un UUID interno estable o se vincula explícitamente si es duplicado.
 */
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { Student } from '../domain/types';

export interface ImportedStudentCandidate {
  rowIndex: number;
  listNumber: number | null;
  lastNames: string;
  firstNames: string;
  internalCode: string | null;
  issues: string[];
  possibleDuplicateOf: Student | null;
  selected: boolean;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Divide un nombre completo "ALCÍVAR MENDOZA CAMILA SOFÍA" en apellidos y nombres cuando vienen en una sola columna. */
export function splitFullName(full: string): { lastNames: string; firstNames: string } {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (!clean) return { lastNames: '', firstNames: '' };
  if (clean.includes(',')) {
    const [last, first] = clean.split(',').map((s) => s.trim());
    return { lastNames: last || '', firstNames: first || '' };
  }
  const parts = clean.split(' ');
  if (parts.length === 1) return { lastNames: parts[0], firstNames: '' };
  if (parts.length === 2) return { lastNames: parts[0], firstNames: parts[1] };
  if (parts.length === 3) return { lastNames: `${parts[0]} ${parts[1]}`, firstNames: parts[2] };
  return {
    lastNames: parts.slice(0, 2).join(' '),
    firstNames: parts.slice(2).join(' '),
  };
}

/** Detecta si una fila es cabecera ("N°", "Apellidos", "Nombres", "Estudiante"...). */
function isHeaderRow(cells: string[]): boolean {
  const joined = normalizeText(cells.join(' '));
  return (
    joined.includes('apellido') ||
    joined.includes('nombre') ||
    joined.includes('nomina') ||
    joined.includes('estudiante')
  );
}

/** Analiza una matriz de celdas (de CSV o XLSX) y detecta duplicados y errores corregibles. */
export function analyzeStudentRows(
  rows: string[][],
  existingStudents: Student[],
): ImportedStudentCandidate[] {
  const activeExisting = existingStudents.filter((s) => s.deleted_at === null);
  const out: ImportedStudentCandidate[] = [];
  const seenNamesInBatch = new Set<string>();

  const startIdx = rows.length > 0 && isHeaderRow(rows[0]) ? 1 : 0;
  const header = startIdx === 1 ? rows[0].map(normalizeText) : [];

  const colLast = header.findIndex((h) => h.includes('apellido'));
  const colFirst = header.findIndex((h) => h.includes('nombre') && !h.includes('apellido'));
  const colFull = header.findIndex(
    (h) => h.includes('estudiante') || h.includes('alumno') || (h.includes('apellido') && h.includes('nombre')),
  );
  const colCode = header.findIndex((h) => h.includes('codigo') || h.includes('id') || h.includes('matricula'));
  const colList = header.findIndex((h) => h === 'n' || h === 'no' || h === 'nro' || h.includes('lista') || h === '#');

  let autoList = 1;
  for (let i = startIdx; i < rows.length; i++) {
    const raw = rows[i].map((c) => (c ?? '').toString().trim());
    if (raw.every((c) => c === '')) continue;

    let listNumber: number | null = null;
    let lastNames = '';
    let firstNames = '';
    let internalCode: string | null = null;

    if (colLast >= 0 && colFirst >= 0) {
      lastNames = raw[colLast] ?? '';
      firstNames = raw[colFirst] ?? '';
      if (colList >= 0 && /^\d+$/.test(raw[colList] ?? '')) listNumber = Number(raw[colList]);
      if (colCode >= 0 && raw[colCode]) internalCode = raw[colCode];
    } else if (colFull >= 0) {
      const split = splitFullName(raw[colFull] ?? '');
      lastNames = split.lastNames;
      firstNames = split.firstNames;
      if (colList >= 0 && /^\d+$/.test(raw[colList] ?? '')) listNumber = Number(raw[colList]);
      if (colCode >= 0 && raw[colCode]) internalCode = raw[colCode];
    } else {
      // Detección automática por posición: [N° opcional], Apellidos, Nombres, [Código opcional]
      let cursor = 0;
      if (/^\d+$/.test(raw[0])) {
        listNumber = Number(raw[0]);
        cursor = 1;
      }
      const remaining = raw.slice(cursor).filter((c) => c !== '');
      if (remaining.length === 1) {
        const split = splitFullName(remaining[0]);
        lastNames = split.lastNames;
        firstNames = split.firstNames;
      } else if (remaining.length >= 2) {
        lastNames = remaining[0];
        firstNames = remaining[1];
        if (remaining[2]) internalCode = remaining[2];
      }
    }

    if (listNumber === null) listNumber = autoList;
    autoList++;

    const issues: string[] = [];
    if (!lastNames.trim()) issues.push('Faltan los apellidos');
    if (!firstNames.trim()) issues.push('Faltan los nombres');

    const normKey = `${normalizeText(lastNames)}|${normalizeText(firstNames)}`;
    if (normKey !== '|' && seenNamesInBatch.has(normKey)) {
      issues.push('Repetido dentro de este mismo archivo');
    }
    seenNamesInBatch.add(normKey);

    const possibleDuplicateOf =
      activeExisting.find((s) => {
        if (internalCode && s.internal_code && normalizeText(s.internal_code) === normalizeText(internalCode)) {
          return true;
        }
        return `${normalizeText(s.last_names)}|${normalizeText(s.first_names)}` === normKey && normKey !== '|';
      }) ?? null;

    if (possibleDuplicateOf) {
      issues.push(
        `Posible duplicado de ${possibleDuplicateOf.last_names} ${possibleDuplicateOf.first_names}`,
      );
    }

    out.push({
      rowIndex: i + 1,
      listNumber,
      lastNames: lastNames.trim(),
      firstNames: firstNames.trim(),
      internalCode: internalCode?.trim() || null,
      issues,
      possibleDuplicateOf,
      selected: issues.length === 0,
    });
  }

  return out;
}

export function parseCsvStudentRows(csvText: string, existingStudents: Student[]): ImportedStudentCandidate[] {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  return analyzeStudentRows(parsed.data, existingStudents);
}

export async function parseXlsxStudentRows(
  buffer: ArrayBuffer,
  existingStudents: Student[],
): Promise<ImportedStudentCandidate[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    for (let c = 1; c <= Math.min(row.cellCount, 12); c++) {
      const cell = row.getCell(c);
      const text = cell.text?.trim() ?? '';
      vals.push(text);
    }
    if (vals.some((v) => v !== '')) rows.push(vals);
  });

  return analyzeStudentRows(rows, existingStudents);
}

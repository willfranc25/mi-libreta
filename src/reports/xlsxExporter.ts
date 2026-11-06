/**
 * Exportación de reportes en XLSX, lectura/análisis de plantillas oficiales del
 * colegio y llenado no destructivo de plantillas Excel (manipulando directamente
 * el XML de las celdas dentro del contenedor ZIP de .xlsx para NO alterar jamás
 * estilos, celdas combinadas, áreas de impresión, logos ni fórmulas originales).
 */
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  ANNUAL_STATUS_LABELS,
  computeAnnual,
  computePeriod,
  equivalenceFor,
  summarizeQualitative,
  type EngineCategory,
  type EngineEvaluation,
  type EngineGrade,
} from '../domain/engine';
import { formatDecimal, gradeDisplay } from '../domain/gradeInput';
import type {
  AcademicPeriod,
  AcademicYear,
  ClassGroup,
  Enrollment,
  Evaluation,
  EvaluationCategory,
  Grade,
  GradingScheme,
  Institution,
  Student,
  Subject,
  TemplateMapping,
} from '../domain/types';

export interface CourseReportContext {
  institution: Institution;
  year: AcademicYear;
  group: ClassGroup;
  subject: Subject;
  scheme: GradingScheme;
  categories: EvaluationCategory[];
  periods: AcademicPeriod[];
  activePeriod: AcademicPeriod;
  students: { student: Student; enrollment: Enrollment }[];
  evaluations: Evaluation[];
  grades: Grade[];
  teacherName: string;
}

export interface ReportWarning {
  type: 'pending_grades' | 'absent_grades' | 'empty_grades' | 'unconfirmed_scheme' | 'conflicts';
  message: string;
}

/** Verifica si existen notas pendientes, ausencias, reglas sin confirmar o conflictos antes de exportar. */
export function collectReportWarnings(
  ctx: CourseReportContext,
  conflictsCount: number,
): ReportWarning[] {
  const warnings: ReportWarning[] = [];

  if (conflictsCount > 0) {
    warnings.push({
      type: 'conflicts',
      message: `Hay ${conflictsCount} nota(s) con conflicto entre dispositivos pendiente de revisión.`,
    });
  }

  if (ctx.scheme.status !== 'confirmed') {
    warnings.push({
      type: 'unconfirmed_scheme',
      message: 'La regla de calificación aún está marcada como borrador. Confírmela en Configuración cuando la verifique con su colegio.',
    });
  }

  const periodEvals = ctx.evaluations.filter(
    (e) => e.deleted_at === null && e.period_id === ctx.activePeriod.id,
  );
  const activeStudents = ctx.students.filter((s) => s.enrollment.status === 'active');

  let emptyCount = 0;
  let pendingCount = 0;
  let absentCount = 0;

  const gradeMap = new Map<string, Grade>();
  for (const g of ctx.grades) {
    if (g.deleted_at === null) gradeMap.set(`${g.evaluation_id}:${g.student_id}`, g);
  }

  for (const { student } of activeStudents) {
    for (const ev of periodEvals) {
      const g = gradeMap.get(`${ev.id}:${student.id}`);
      const st = g?.status ?? 'empty';
      if (st === 'empty') emptyCount++;
      else if (st === 'pending') pendingCount++;
      else if (st === 'absent') absentCount++;
    }
  }

  if (pendingCount > 0) {
    warnings.push({
      type: 'pending_grades',
      message: `Existen ${pendingCount} calificación(es) marcadas como «Pendiente» en este período.`,
    });
  }
  if (absentCount > 0) {
    warnings.push({
      type: 'absent_grades',
      message: `Existen ${absentCount} registro(s) marcados como «Ausente» en este período.`,
    });
  }
  if (emptyCount > 0) {
    warnings.push({
      type: 'empty_grades',
      message: `Faltan por registrar ${emptyCount} calificación(es) en ${ctx.activePeriod.name}.`,
    });
  }

  return warnings;
}

/** Genera un libro Excel (.xlsx) limpio, bien formateado y listo para imprimir o archivar. */
export async function generateStandardCourseXlsx(ctx: CourseReportContext): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mi Libreta';
  wb.created = new Date();

  const sheetName = `${ctx.group.name} ${ctx.group.parallel} - ${ctx.activePeriod.name}`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Encabezado institucional
  ws.addRow([ctx.institution.name]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([
    `Año lectivo: ${ctx.year.name}`,
    `Curso: ${ctx.group.name} «${ctx.group.parallel}»`,
    `Asignatura: ${ctx.subject.name}`,
    `Período: ${ctx.activePeriod.name}`,
  ]);
  ws.getRow(2).font = { bold: true, size: 10 };
  ws.addRow([`Docente: ${ctx.teacherName || '—'}`, `Regla: ${ctx.scheme.name}`]);
  ws.addRow([]);

  const periodEvals = ctx.evaluations
    .filter((e) => e.deleted_at === null && e.period_id === ctx.activePeriod.id && e.kind === 'regular')
    .sort((a, b) => a.sort_order - b.sort_order);

  const engineCats: EngineCategory[] = ctx.categories
    .filter((c) => c.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ key: c.key, name: c.name, kind: c.kind, weight: c.weight }));

  const engineEvals: EngineEvaluation[] = ctx.evaluations
    .filter((e) => e.deleted_at === null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      category_key: e.category_key,
      period_id: e.period_id,
      weight: e.weight,
      kind: e.kind,
    }));

  const isQual = ctx.scheme.config.mode === 'qualitative';

  const headerRow = [
    'N.°',
    'Apellidos y Nombres',
    'Estado matrícula',
    ...periodEvals.map((e) => e.name),
    ...(isQual
      ? ['Último logro registrado']
      : [
          ...engineCats.map((c) => `Prom. ${c.name}${c.weight ? ` (${c.weight} %)` : ''}`),
          `Nota ${ctx.activePeriod.name}`,
          'Escala cualitativa',
          'Prom. Anual',
          'Estado',
        ]),
  ];

  const hdr = ws.addRow(headerRow);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  const periodIds = ctx.periods
    .filter((p) => p.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.id);

  for (const { student, enrollment } of ctx.students) {
    const stuGrades = new Map<string, EngineGrade>();
    for (const g of ctx.grades) {
      if (g.deleted_at === null && g.student_id === student.id) {
        stuGrades.set(g.evaluation_id, { status: g.status, value: g.value, qualitative: g.qualitative });
      }
    }

    const evalCells = periodEvals.map((ev) => {
      const g = stuGrades.get(ev.id);
      if (!g) return '';
      if (g.status === 'graded' && g.value !== null) return Number(g.value);
      return gradeDisplay(g);
    });

    const fullName = `${student.last_names} ${student.first_names}`;
    const statusLabel =
      enrollment.status === 'active'
        ? 'Activo'
        : enrollment.status === 'withdrawn'
          ? 'Retirado'
          : 'Trasladado';

    if (isQual) {
      const qual = summarizeQualitative(
        periodEvals.map((e) => ({
          id: e.id,
          name: e.name,
          category_key: e.category_key,
          period_id: e.period_id,
          weight: e.weight,
          kind: e.kind,
        })),
        stuGrades,
      );
      ws.addRow([enrollment.list_number ?? '', fullName, statusLabel, ...evalCells, qual.latest ?? '—']);
    } else {
      const pRes = computePeriod(ctx.scheme.config, engineCats, ctx.activePeriod.id, engineEvals, stuGrades);
      const aRes = computeAnnual(ctx.scheme.config, engineCats, periodIds, engineEvals, stuGrades);
      const eq = equivalenceFor(ctx.scheme.config, pRes.average);

      const catCells = pRes.categories.map((c) => (c.average !== null ? Number(c.average) : ''));
      ws.addRow([
        enrollment.list_number ?? '',
        fullName,
        statusLabel,
        ...evalCells,
        ...catCells,
        pRes.average !== null ? Number(pRes.average) : '',
        eq ? `${eq.code} - ${eq.label}` : '',
        aRes.final !== null ? Number(aRes.final) : '',
        ANNUAL_STATUS_LABELS[aRes.status],
      ]);
    }
  }

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 6 : i === 1 ? 34 : 16;
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

// =============================================================================
// Analizador y llenado NO DESTRUCTIVO de plantillas originales del colegio (.xlsx)
// =============================================================================
export interface TemplateSheetInspection {
  name: string;
  rowCount: number;
  columnHeaders: { column: string; row: number; text: string }[];
  formulaCells: { address: string; formula: string }[];
  mergedCount: number;
  sampleRows: { rowNumber: number; cells: Record<string, string> }[];
}

export interface TemplateInspection {
  sheets: TemplateSheetInspection[];
  hasMacrosOrDrawings: boolean;
  warnings: string[];
}

function colNumberToLetter(col: number): string {
  let temp = col;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

export function colLetterToNumber(letter: string): number {
  let num = 0;
  for (let i = 0; i < letter.length; i++) {
    num = num * 26 + (letter.charCodeAt(i) - 64);
  }
  return num;
}

/** Inspecciona una plantilla XLSX del colegio para mostrar sus hojas, encabezados y fórmulas. */
export async function inspectXlsxTemplate(buffer: ArrayBuffer): Promise<TemplateInspection> {
  const zipEntries = unzipSync(new Uint8Array(buffer));
  const hasMacrosOrDrawings = Object.keys(zipEntries).some(
    (k) => k.includes('vbaProject') || k.includes('drawings/'),
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets: TemplateSheetInspection[] = [];
  const warnings: string[] = [];

  if (hasMacrosOrDrawings) {
    warnings.push(
      'La plantilla incluye gráficos, escudos o macros. Mi Libreta usará inyección directa sobre el archivo original para conservarlos intactos.',
    );
  }

  for (const ws of wb.worksheets) {
    const columnHeaders: { column: string; row: number; text: string }[] = [];
    const formulaCells: { address: string; formula: string }[] = [];
    const sampleRows: { rowNumber: number; cells: Record<string, string> }[] = [];

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowCells: Record<string, string> = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const colLetter = colNumberToLetter(colNumber);
        const addr = `${colLetter}${rowNumber}`;
        if (cell.formula) {
          formulaCells.push({ address: addr, formula: cell.formula });
        }
        const txt = cell.text?.trim() ?? '';
        if (txt && rowNumber <= 15) {
          columnHeaders.push({ column: colLetter, row: rowNumber, text: txt });
        }
        if (txt) {
          rowCells[colLetter] = txt;
        }
      });
      if (sampleRows.length < 25 && Object.keys(rowCells).length > 0) {
        sampleRows.push({ rowNumber, cells: rowCells });
      }
    });

    sheets.push({
      name: ws.name,
      rowCount: ws.rowCount,
      columnHeaders,
      formulaCells,
      mergedCount: ws.model.merges?.length ?? 0,
      sampleRows,
    });
  }

  return { sheets, hasMacrosOrDrawings, warnings };
}

/**
 * Rellena la plantilla XLSX original del colegio modificando únicamente los nodos `<c>`
 * solicitados en el XML de la hoja correspondiente dentro del ZIP.
 *
 * Garantías:
 * 1. NUNCA sobrescribe una celda que contenga una fórmula (`<f>`).
 * 2. Conserva intactos los estilos (`s="..."`), celdas combinadas (`<mergeCells>`),
 *    áreas de impresión (`<pageSetup>`), imágenes/escudos y todas las demás hojas.
 */
export function fillTemplatePreservingStructure(
  templateBytes: Uint8Array,
  mapping: TemplateMapping,
  ctx: CourseReportContext,
): { bytes: Uint8Array; writtenCells: number; skippedFormulaCells: string[] } {
  const archive = unzipSync(templateBytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  // 1. Localizar el archivo XML de la hoja por nombre en xl/workbook.xml y xl/_rels/workbook.xml.rels
  const workbookXml = strFromU8(archive['xl/workbook.xml']);
  const wbDoc = parser.parseFromString(workbookXml, 'application/xml');
  const sheetNodes = wbDoc.getElementsByTagName('sheet');

  let rId: string | null = null;
  for (let i = 0; i < sheetNodes.length; i++) {
    const node = sheetNodes[i];
    if (node.getAttribute('name') === mapping.sheetName) {
      rId = node.getAttribute('r:id') || node.getAttribute('id');
      break;
    }
  }
  if (!rId && sheetNodes.length > 0) {
    rId = sheetNodes[0].getAttribute('r:id') || sheetNodes[0].getAttribute('id');
  }
  if (!rId) {
    throw new Error(`No se encontró la hoja «${mapping.sheetName}» en la plantilla.`);
  }

  const relsXml = strFromU8(archive['xl/_rels/workbook.xml.rels']);
  const relsDoc = parser.parseFromString(relsXml, 'application/xml');
  const relNodes = relsDoc.getElementsByTagName('Relationship');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  for (let i = 0; i < relNodes.length; i++) {
    if (relNodes[i].getAttribute('Id') === rId) {
      const target = relNodes[i].getAttribute('Target') ?? 'worksheets/sheet1.xml';
      sheetPath = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
      break;
    }
  }

  if (!archive[sheetPath]) {
    throw new Error(`No se pudo abrir la hoja interna (${sheetPath}) de la plantilla.`);
  }

  const sheetDoc = parser.parseFromString(strFromU8(archive[sheetPath]), 'application/xml');
  const sheetData = sheetDoc.getElementsByTagName('sheetData')[0];
  if (!sheetData) {
    throw new Error('La plantilla no contiene una tabla de celdas estándar (sheetData).');
  }

  const skippedFormulaCells: string[] = [];
  let writtenCells = 0;

  function setCellInXml(address: string, val: string | number | null): void {
    if (val === null || val === '') return;
    const match = /^([A-Z]{1,3})(\d+)$/.exec(address);
    if (!match) return;
    const colLetter = match[1];
    const rowNum = Number(match[2]);

    // Buscar o crear <row r="rowNum">
    const rows = sheetData.getElementsByTagName('row');
    let targetRow: XmlElement | null = null;
    for (let i = 0; i < rows.length; i++) {
      if (Number(rows[i].getAttribute('r')) === rowNum) {
        targetRow = rows[i];
        break;
      }
    }
    if (!targetRow) {
      targetRow = sheetDoc.createElementNS(sheetData.namespaceURI, 'row');
      targetRow.setAttribute('r', String(rowNum));
      sheetData.appendChild(targetRow);
    }

    // Buscar o crear <c r="address">
    const cells = targetRow.getElementsByTagName('c');
    let targetCell: XmlElement | null = null;
    const targetColNum = colLetterToNumber(colLetter);
    let insertBeforeCell: XmlElement | null = null;

    for (let i = 0; i < cells.length; i++) {
      const ref = cells[i].getAttribute('r') ?? '';
      const cMatch = /^([A-Z]{1,3})/.exec(ref);
      const cNum = cMatch ? colLetterToNumber(cMatch[1]) : 0;
      if (ref === address) {
        targetCell = cells[i];
        break;
      }
      if (cNum > targetColNum && !insertBeforeCell) {
        insertBeforeCell = cells[i];
      }
    }

    if (targetCell) {
      // Protección innegociable: si la celda tiene una fórmula (<f>), NUNCA se sobrescribe
      const formulas = targetCell.getElementsByTagName('f');
      if (formulas.length > 0) {
        skippedFormulaCells.push(address);
        return;
      }
      // Limpiar hijos previos (<v>, <is>) conservando atributos (como s="estilo")
      while (targetCell.firstChild) {
        targetCell.removeChild(targetCell.firstChild);
      }
    } else {
      targetCell = sheetDoc.createElementNS(sheetData.namespaceURI, 'c');
      targetCell.setAttribute('r', address);
      if (insertBeforeCell) {
        targetRow.insertBefore(targetCell, insertBeforeCell);
      } else {
        targetRow.appendChild(targetCell);
      }
    }

    if (typeof val === 'number' && Number.isFinite(val)) {
      targetCell.removeAttribute('t');
      const vNode = sheetDoc.createElementNS(sheetData.namespaceURI, 'v');
      vNode.appendChild(sheetDoc.createTextNode(String(val)));
      targetCell.appendChild(vNode);
    } else {
      targetCell.setAttribute('t', 'inlineStr');
      const isNode = sheetDoc.createElementNS(sheetData.namespaceURI, 'is');
      const tNode = sheetDoc.createElementNS(sheetData.namespaceURI, 't');
      tNode.appendChild(sheetDoc.createTextNode(String(val)));
      isNode.appendChild(tNode);
      targetCell.appendChild(isNode);
    }
    writtenCells++;
  }

  // 2. Escribir celdas fijas (institución, año, curso, asignatura, período, docente)
  for (const fc of mapping.fixedCells) {
    let text = '';
    switch (fc.source) {
      case 'institution':
        text = ctx.institution.name;
        break;
      case 'academic_year':
        text = ctx.year.name;
        break;
      case 'class_group':
        text = `${ctx.group.name} ${ctx.group.parallel}`.trim();
        break;
      case 'subject':
        text = ctx.subject.name;
        break;
      case 'period':
        text = ctx.activePeriod.name;
        break;
      case 'teacher':
        text = ctx.teacherName;
        break;
      case 'date':
        text = new Date().toISOString().slice(0, 10);
        break;
    }
    setCellInXml(fc.cell, text);
  }

  // 3. Escribir filas de estudiantes y sus calificaciones/promedios
  const engineCats: EngineCategory[] = ctx.categories
    .filter((c) => c.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ key: c.key, name: c.name, kind: c.kind, weight: c.weight }));

  const engineEvals: EngineEvaluation[] = ctx.evaluations
    .filter((e) => e.deleted_at === null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      category_key: e.category_key,
      period_id: e.period_id,
      weight: e.weight,
      kind: e.kind,
    }));

  const periodIds = ctx.periods
    .filter((p) => p.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.id);

  ctx.students.forEach(({ student, enrollment }, idx) => {
    const rowNumber = mapping.firstDataRow + idx;
    const stuGrades = new Map<string, EngineGrade>();
    for (const g of ctx.grades) {
      if (g.deleted_at === null && g.student_id === student.id) {
        stuGrades.set(g.evaluation_id, { status: g.status, value: g.value, qualitative: g.qualitative });
      }
    }

    for (const colMap of mapping.columns) {
      const addr = `${colMap.column}${rowNumber}`;
      const src = colMap.source;
      switch (src.type) {
        case 'list_number':
          setCellInXml(addr, enrollment.list_number ?? idx + 1);
          break;
        case 'full_name':
          setCellInXml(addr, `${student.last_names} ${student.first_names}`);
          break;
        case 'last_names':
          setCellInXml(addr, student.last_names);
          break;
        case 'first_names':
          setCellInXml(addr, student.first_names);
          break;
        case 'internal_code':
          setCellInXml(addr, student.internal_code ?? '');
          break;
        case 'evaluation': {
          const g = stuGrades.get(src.evaluationId);
          if (!g || g.status === 'empty') break;
          if (g.status === 'graded' && g.value !== null) {
            setCellInXml(addr, Number(g.value));
          } else if (g.status === 'graded' && g.qualitative !== null) {
            setCellInXml(addr, g.qualitative);
          } else {
            setCellInXml(addr, gradeDisplay(g));
          }
          break;
        }
        case 'category_average': {
          const pRes = computePeriod(ctx.scheme.config, engineCats, src.periodId, engineEvals, stuGrades);
          const cat = pRes.categories.find((c) => c.key === src.categoryKey);
          if (cat?.average !== null && cat?.average !== undefined) {
            setCellInXml(addr, Number(cat.average));
          }
          break;
        }
        case 'period_average': {
          const pRes = computePeriod(ctx.scheme.config, engineCats, src.periodId, engineEvals, stuGrades);
          if (pRes.average !== null) setCellInXml(addr, Number(pRes.average));
          break;
        }
        case 'final_average': {
          const aRes = computeAnnual(ctx.scheme.config, engineCats, periodIds, engineEvals, stuGrades);
          if (aRes.final !== null) setCellInXml(addr, Number(aRes.final));
          break;
        }
        case 'qualitative_equivalence': {
          const targetVal = src.periodId
            ? computePeriod(ctx.scheme.config, engineCats, src.periodId, engineEvals, stuGrades).average
            : computeAnnual(ctx.scheme.config, engineCats, periodIds, engineEvals, stuGrades).final;
          const eq = equivalenceFor(ctx.scheme.config, targetVal);
          if (eq) setCellInXml(addr, eq.code);
          break;
        }
      }
    }
  });

  // Si el libro tiene calcChain.xml, forzar que Excel recalcule fórmulas al abrir
  if (archive['xl/workbook.xml']) {
    const calcPrs = wbDoc.getElementsByTagName('calcPr');
    if (calcPrs.length > 0) {
      calcPrs[0].setAttribute('fullCalcOnLoad', '1');
      archive['xl/workbook.xml'] = strToU8(serializer.serializeToString(wbDoc));
    }
  }

  archive[sheetPath] = strToU8(serializer.serializeToString(sheetDoc));
  return {
    bytes: zipSync(archive),
    writtenCells,
    skippedFormulaCells,
  };
}

/** Genera una plantilla institucional de ejemplo (para probar el mapeo mientras no se tenga la del colegio). */
export async function buildSampleSchoolTemplateXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cuadro Trimestral', {
    pageSetup: { paperSize: 9, orientation: 'landscape', printArea: 'A1:I25' },
  });

  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = 'PLANTILLA DE PRUEBA — CUADRO DE CALIFICACIONES DEL COLEGIO';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.getCell('A2').value = 'Curso:';
  ws.getCell('B2').value = '';
  ws.getCell('D2').value = 'Asignatura:';
  ws.getCell('E2').value = '';
  ws.getCell('G2').value = 'Período:';
  ws.getCell('H2').value = '';

  const headers = [
    'N.°',
    'Nómina de Estudiantes',
    'Aporte 1',
    'Aporte 2',
    'Aporte 3',
    'Prom. Formativo (70%)',
    'Examen Sumativo (30%)',
    'Nota Trimestral (Fórmula)',
    'Escala',
  ];
  const hr = ws.getRow(5);
  headers.forEach((h, idx) => {
    const c = hr.getCell(idx + 1);
    c.value = h;
    c.font = { bold: true };
  });

  // Filas 6 a 15 con fórmula original en las columnas F y H
  for (let r = 6; r <= 15; r++) {
    ws.getCell(`F${r}`).value = { formula: `TRUNC(AVERAGE(C${r}:E${r}),2)` };
    ws.getCell(`H${r}`).value = { formula: `TRUNC(F${r}*0.7+G${r}*0.3,2)` };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

export { formatDecimal };

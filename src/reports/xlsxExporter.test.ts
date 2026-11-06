import 'fake-indexeddb/auto';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { LibretaDB } from '../db/db';
import { configureDb } from '../db/repo';
import { seedDemoData } from '../db/seedDemo';
import { parseCsvStudentRows } from '../import/studentImport';
import {
  buildSampleSchoolTemplateXlsx,
  fillTemplatePreservingStructure,
  generateStandardCourseXlsx,
  inspectXlsxTemplate,
  type CourseReportContext,
} from './xlsxExporter';

async function loadDemoContext(db: LibretaDB): Promise<CourseReportContext> {
  const institution = (await db.institutions.get('demo-inst-1'))!;
  const year = (await db.academic_years.get('demo-year-2026'))!;
  const group = (await db.class_groups.get('demo-group-8a'))!;
  const subject = (await db.subjects.get('demo-subj-mat'))!;
  const scheme = (await db.grading_schemes.get('demo-scheme-quant-v1'))!;
  const categories = await db.evaluation_categories.where('scheme_id').equals(scheme.id).toArray();
  const periods = await db.academic_periods.where('academic_year_id').equals(year.id).toArray();
  const activePeriod = periods.find((p) => p.id === 'demo-period-t1')!;
  const enrollments = await db.enrollments.where('class_group_id').equals(group.id).toArray();
  enrollments.sort((a, b) => (a.list_number ?? 999) - (b.list_number ?? 999));

  const students = [];
  for (const enr of enrollments) {
    const stu = (await db.students.get(enr.student_id))!;
    students.push({ student: stu, enrollment: enr });
  }

  const evaluations = await db.evaluations.where('assignment_id').equals('demo-assign-8a-mat').toArray();
  const grades = await db.grades.toArray();

  return {
    institution,
    year,
    group,
    subject,
    scheme,
    categories,
    periods,
    activePeriod,
    students,
    evaluations,
    grades,
    teacherName: 'Lcda. María Elena Vélez',
  };
}

describe('Importación de estudiantes y Exportación a Excel / Plantillas oficiales', () => {
  it('importa desde CSV, separa apellidos y nombres y detecta posibles duplicados', async () => {
    const db = new LibretaDB(`imp-${crypto.randomUUID()}`);
    configureDb(db, { deviceLabel: 'PC', ownerId: null, syncEnabled: false });
    await seedDemoData(db);

    const existing = await db.students.toArray();
    const csv = [
      'Nro,Apellidos,Nombres,Codigo',
      '1,Alcívar Mendoza,Camila Sofía,EST-801',
      '2,Zambrano Vera,Carlos Andrés,EST-899',
      '3,,SinApellido,EST-900',
    ].join('\n');

    const candidates = parseCsvStudentRows(csv, existing);
    expect(candidates).toHaveLength(3);

    // Fila 1 es duplicado de Camila Alcívar
    expect(candidates[0].possibleDuplicateOf?.id).toBe('demo-stu-01');
    expect(candidates[0].selected).toBe(false);

    // Fila 2 es nueva y válida
    expect(candidates[1].possibleDuplicateOf).toBeNull();
    expect(candidates[1].selected).toBe(true);

    // Fila 3 tiene error de apellido vacío
    expect(candidates[2].issues).toContain('Faltan los apellidos');
    expect(candidates[2].selected).toBe(false);
  });

  it('genera un archivo XLSX estándar con las notas y promedios calculados', async () => {
    const db = new LibretaDB(`xlsx-${crypto.randomUUID()}`);
    configureDb(db, { deviceLabel: 'PC', ownerId: null, syncEnabled: false });
    await seedDemoData(db);

    const ctx = await loadDemoContext(db);
    const bytes = await generateStandardCourseXlsx(ctx);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.length).toBe(1);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').text).toContain('República del Ecuador');
    // Fila 6 es la primera estudiante (Camila Alcívar)
    expect(ws.getCell('B6').text).toBe('Alcívar Mendoza Camila Sofía');
  });

  it('rellena una plantilla XLSX oficial sin alterar fórmulas, celdas combinadas ni áreas de impresión', async () => {
    const db = new LibretaDB(`tpl-${crypto.randomUUID()}`);
    configureDb(db, { deviceLabel: 'PC', ownerId: null, syncEnabled: false });
    await seedDemoData(db);
    const ctx = await loadDemoContext(db);

    const templateBytes = await buildSampleSchoolTemplateXlsx();
    const inspection = await inspectXlsxTemplate(templateBytes.buffer as ArrayBuffer);
    expect(inspection.sheets[0].name).toBe('Cuadro Trimestral');
    expect(inspection.sheets[0].mergedCount).toBe(1);
    expect(inspection.sheets[0].formulaCells.length).toBeGreaterThanOrEqual(20);

    const filled = fillTemplatePreservingStructure(
      templateBytes,
      {
        sheetName: 'Cuadro Trimestral',
        firstDataRow: 6,
        matchBy: 'order',
        matchColumn: null,
        fixedCells: [
          { cell: 'B2', source: 'class_group' },
          { cell: 'E2', source: 'subject' },
          { cell: 'H2', source: 'period' },
        ],
        columns: [
          { column: 'A', source: { type: 'list_number' } },
          { column: 'B', source: { type: 'full_name' } },
          { column: 'C', source: { type: 'evaluation', evaluationId: 'demo-eval-t1' } },
          { column: 'D', source: { type: 'evaluation', evaluationId: 'demo-eval-t2' } },
          { column: 'E', source: { type: 'evaluation', evaluationId: 'demo-eval-t3' } },
          // Intentamos mapear sobre F (que tiene fórmula en la plantilla) para comprobar que NO la destruye
          { column: 'F', source: { type: 'category_average', periodId: 'demo-period-t1', categoryKey: 'formativa' } },
          { column: 'G', source: { type: 'evaluation', evaluationId: 'demo-eval-ex1' } },
          { column: 'I', source: { type: 'qualitative_equivalence', periodId: 'demo-period-t1' } },
        ],
      },
      ctx,
    );

    // La columna F tenía fórmula TRUNC(AVERAGE(C6:E6),2), por lo que debe haberse protegido
    expect(filled.skippedFormulaCells).toContain('F6');

    const wbOut = new ExcelJS.Workbook();
    await wbOut.xlsx.load(filled.bytes.buffer as ArrayBuffer);
    const ws = wbOut.getWorksheet('Cuadro Trimestral')!;

    // Celdas combinadas y área de impresión intactas
    expect(ws.model.merges).toContain('A1:I1');
    expect(ws.pageSetup.printArea).toBe('A1:I25');

    // Celdas fijas completadas
    expect(ws.getCell('B2').text).toBe('8.º de Básica A');
    expect(ws.getCell('E2').text).toBe('Matemática');

    // Estudiante 2 (Mateo Benítez, fila 7): notas 8.12, 8.5, 8.74 y examen 9.1
    expect(ws.getCell('B7').text).toBe('Benítez Zambrano Mateo Sebastián');
    expect(ws.getCell('C7').value).toBe(8.12);
    expect(ws.getCell('D7').value).toBe(8.5);
    expect(ws.getCell('E7').value).toBe(8.74);
    expect(ws.getCell('G7').value).toBe(9.1);
    expect(ws.getCell('I7').text).toBe('AAR');

    // Fórmulas en F7 y H7 intactas
    expect(ws.getCell('F7').formula).toBe('TRUNC(AVERAGE(C7:E7),2)');
    expect(ws.getCell('H7').formula).toBe('TRUNC(F7*0.7+G7*0.3,2)');
  });
});

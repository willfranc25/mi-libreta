/**
 * Pantalla de Reportes (Secciones 13 y 14):
 * - Selección de curso, asignatura, período y tipo de reporte:
 *   1. Cuadro de calificaciones por curso y período.
 *   2. Resumen por evaluación.
 *   3. Reporte individual por estudiante (boletín).
 *   4. Promedios por período académico / Resumen anual por asignatura.
 *   5. Plantillas Excel del colegio (importar .xlsx oficial, analizar hojas/fórmulas,
 *      configurar mapeo reutilizable y generar archivo preservando fórmulas y formato).
 * - Muestra advertencias antes de generar si existen notas pendientes, ausencias o conflictos.
 * - Permite exportar a Excel (.xlsx) e imprimir / guardar en PDF con 1 clic.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isLive, save } from '../db/repo';
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
import type { TemplateColumn, TemplateMapping } from '../domain/types';
import {
  buildSampleSchoolTemplateXlsx,
  collectReportWarnings,
  fillTemplatePreservingStructure,
  generateStandardCourseXlsx,
  inspectXlsxTemplate,
  type CourseReportContext,
  type TemplateInspection,
} from '../reports/xlsxExporter';

type ReportTab = 'course' | 'evaluation' | 'student' | 'annual' | 'template';

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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

export function ReportsPage() {
  const { db, conflictsCount } = useApp();
  const [activeTab, setActiveTab] = useState<ReportTab>('course');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedEvalId, setSelectedEvalId] = useState('');

  // Estado del módulo de plantillas oficiales de Excel
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [inspection, setInspection] = useState<TemplateInspection | null>(null);
  const [mappingSheet, setMappingSheet] = useState<string>('');
  const [firstDataRow, setFirstDataRow] = useState<number>(6);
  const [columnsMap, setColumnsMap] = useState<TemplateColumn[]>([
    { column: 'A', source: { type: 'list_number' } },
    { column: 'B', source: { type: 'full_name' } },
  ]);
  const [fixedCourseCell, setFixedCourseCell] = useState('B2');
  const [fixedSubjectCell, setFixedSubjectCell] = useState('E2');
  const [fixedPeriodCell, setFixedPeriodCell] = useState('H2');
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const institutions = (await db.institutions.toArray()).filter(isLive);
    const years = (await db.academic_years.toArray()).filter(isLive);
    const groups = (await db.class_groups.toArray()).filter(isLive);
    const subjects = (await db.subjects.toArray()).filter(isLive);
    const assignments = (await db.teaching_assignments.toArray()).filter(isLive);
    const schemes = (await db.grading_schemes.toArray()).filter(isLive);
    const categories = (await db.evaluation_categories.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const periods = (await db.academic_periods.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const students = (await db.students.toArray()).filter(isLive);
    const enrollments = (await db.enrollments.toArray()).filter(isLive);
    const evaluations = (await db.evaluations.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const grades = (await db.grades.toArray()).filter(isLive);
    const templates = (await db.export_templates.toArray()).filter(isLive);
    const profile = (await db.profiles.toArray()).filter(isLive)[0] ?? null;
    const lastAssignmentId = await db.getMeta<string>('last_assignment_id');

    return {
      institution: institutions[0] ?? null,
      years,
      groups,
      subjects,
      assignments,
      schemes,
      categories,
      periods,
      students,
      enrollments,
      evaluations,
      grades,
      templates,
      profile,
      lastAssignmentId,
    };
  }, [], null);

  useEffect(() => {
    if (!data) return;
    if (!selectedAssignmentId || !data.assignments.some((a) => a.id === selectedAssignmentId)) {
      const def =
        data.assignments.find((a) => a.id === data.lastAssignmentId)?.id ??
        data.assignments[0]?.id ??
        '';
      setSelectedAssignmentId(def);
    }
  }, [data, selectedAssignmentId]);

  useEffect(() => {
    if (!data || !selectedAssignmentId) return;
    const assign = data.assignments.find((a) => a.id === selectedAssignmentId);
    if (!assign) return;
    const yPeriods = data.periods.filter((p) => p.academic_year_id === assign.academic_year_id);
    if (!selectedPeriodId || !yPeriods.some((p) => p.id === selectedPeriodId)) {
      setSelectedPeriodId(yPeriods[0]?.id ?? '');
    }
  }, [data, selectedAssignmentId, selectedPeriodId]);

  const reportContext = useMemo<CourseReportContext | null>(() => {
    if (!data || !data.institution || !selectedAssignmentId) return null;
    const assignment = data.assignments.find((a) => a.id === selectedAssignmentId);
    if (!assignment) return null;
    const year = data.years.find((y) => y.id === assignment.academic_year_id);
    const group = data.groups.find((g) => g.id === assignment.class_group_id);
    const subject = data.subjects.find((s) => s.id === assignment.subject_id);
    const scheme = data.schemes.find((s) => s.id === assignment.grading_scheme_id);
    if (!year || !group || !subject || !scheme) return null;

    const periods = data.periods.filter((p) => p.academic_year_id === year.id);
    const activePeriod = periods.find((p) => p.id === selectedPeriodId) ?? periods[0];
    if (!activePeriod) return null;

    const categories = data.categories.filter((c) => c.scheme_id === scheme.id);
    const stuMap = new Map(data.students.map((s) => [s.id, s]));
    const enrolled = data.enrollments
      .filter((e) => e.class_group_id === group.id)
      .sort((a, b) => (a.list_number ?? 999) - (b.list_number ?? 999))
      .map((enrollment) => ({ enrollment, student: stuMap.get(enrollment.student_id)! }))
      .filter((x) => Boolean(x.student));

    const evaluations = data.evaluations.filter((e) => e.assignment_id === assignment.id);

    return {
      institution: data.institution,
      year,
      group,
      subject,
      scheme,
      categories,
      periods,
      activePeriod,
      students: enrolled,
      evaluations,
      grades: data.grades,
      teacherName: data.profile?.display_name ?? '',
    };
  }, [data, selectedAssignmentId, selectedPeriodId]);

  useEffect(() => {
    if (!reportContext) return;
    if (
      !selectedStudentId ||
      !reportContext.students.some((s) => s.student.id === selectedStudentId)
    ) {
      setSelectedStudentId(reportContext.students[0]?.student.id ?? '');
    }
    const pEvals = reportContext.evaluations.filter(
      (e) => e.period_id === reportContext.activePeriod.id,
    );
    if (!selectedEvalId || !pEvals.some((e) => e.id === selectedEvalId)) {
      setSelectedEvalId(pEvals[0]?.id ?? '');
    }
  }, [reportContext, selectedStudentId, selectedEvalId]);

  // Inspeccionar plantilla seleccionada cuando cambia
  const currentTemplate = data?.templates.find((t) => t.id === selectedTemplateId) ?? null;
  useEffect(() => {
    if (!currentTemplate) {
      setInspection(null);
      return;
    }
    const bytes = base64ToBytes(currentTemplate.file_base64);
    inspectXlsxTemplate(bytes.buffer as ArrayBuffer).then((info) => {
      setInspection(info);
      if (currentTemplate.mapping) {
        setMappingSheet(currentTemplate.mapping.sheetName);
        setFirstDataRow(currentTemplate.mapping.firstDataRow);
        setColumnsMap(currentTemplate.mapping.columns);
      } else if (info.sheets[0]) {
        setMappingSheet(info.sheets[0].name);
      }
    });
  }, [currentTemplate?.id]);

  if (!data || !reportContext) {
    return <div className="py-12 text-center text-slate-600">Cargando reportes…</div>;
  }

  const warnings = collectReportWarnings(reportContext, conflictsCount);
  const periodEvals = reportContext.evaluations.filter(
    (e) => e.period_id === reportContext.activePeriod.id && e.kind === 'regular',
  );
  const engineCats: EngineCategory[] = reportContext.categories.map((c) => ({
    key: c.key,
    name: c.name,
    kind: c.kind,
    weight: c.weight,
  }));
  const engineEvals: EngineEvaluation[] = reportContext.evaluations.map((e) => ({
    id: e.id,
    name: e.name,
    category_key: e.category_key,
    period_id: e.period_id,
    weight: e.weight,
    kind: e.kind,
  }));
  const periodIds = reportContext.periods.map((p) => p.id);
  const isQual = reportContext.scheme.config.mode === 'qualitative';

  const handleExportStandardXlsx = async () => {
    const bytes = await generateStandardCourseXlsx(reportContext);
    const safeCourse = `${reportContext.group.name}-${reportContext.group.parallel}-${reportContext.subject.name}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    downloadBytes(
      bytes,
      `Calificaciones_${safeCourse}_${reportContext.activePeriod.name}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  const handleUploadTemplateFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const b64 = bytesToBase64(new Uint8Array(buf));
    const info = await inspectXlsxTemplate(buf);
    const firstSheet = info.sheets[0]?.name ?? 'Hoja1';

    const defaultCols: TemplateColumn[] = [
      { column: 'A', source: { type: 'list_number' } },
      { column: 'B', source: { type: 'full_name' } },
      ...periodEvals.slice(0, 4).map((ev, i) => ({
        column: String.fromCharCode(67 + i),
        source: { type: 'evaluation' as const, evaluationId: ev.id },
      })),
    ];

    const saved = await save(db, 'export_templates', {
      name: file.name.replace(/\.xlsx$/i, ''),
      file_name: file.name,
      file_base64: b64,
      assignment_id: reportContext.group.id,
      period_id: reportContext.activePeriod.id,
      mapping: {
        sheetName: firstSheet,
        firstDataRow: 6,
        matchBy: 'order',
        matchColumn: null,
        columns: defaultCols,
        fixedCells: [
          { cell: fixedCourseCell, source: 'class_group' },
          { cell: fixedSubjectCell, source: 'subject' },
          { cell: fixedPeriodCell, source: 'period' },
        ],
      },
      verified_at: null,
    });
    setSelectedTemplateId(saved.id);
    setTemplateNotice(`Plantilla «${file.name}» cargada y analizada correctamente.`);
  };

  const handleLoadSampleTemplate = async () => {
    const sampleBytes = await buildSampleSchoolTemplateXlsx();
    const b64 = bytesToBase64(sampleBytes);
    const defaultCols: TemplateColumn[] = [
      { column: 'A', source: { type: 'list_number' } },
      { column: 'B', source: { type: 'full_name' } },
      ...(periodEvals[0]
        ? [{ column: 'C', source: { type: 'evaluation' as const, evaluationId: periodEvals[0].id } }]
        : []),
      ...(periodEvals[1]
        ? [{ column: 'D', source: { type: 'evaluation' as const, evaluationId: periodEvals[1].id } }]
        : []),
      ...(periodEvals[2]
        ? [{ column: 'E', source: { type: 'evaluation' as const, evaluationId: periodEvals[2].id } }]
        : []),
      {
        column: 'F',
        source: {
          type: 'category_average' as const,
          periodId: reportContext.activePeriod.id,
          categoryKey: 'formativa',
        },
      },
      ...(periodEvals[3]
        ? [{ column: 'G', source: { type: 'evaluation' as const, evaluationId: periodEvals[3].id } }]
        : []),
      {
        column: 'I',
        source: { type: 'qualitative_equivalence', periodId: reportContext.activePeriod.id },
      },
    ];

    const saved = await save(db, 'export_templates', {
      name: 'Plantilla de prueba del colegio (Cuadro Trimestral)',
      file_name: 'Plantilla_Colegio_Prueba.xlsx',
      file_base64: b64,
      assignment_id: reportContext.group.id,
      period_id: reportContext.activePeriod.id,
      mapping: {
        sheetName: 'Cuadro Trimestral',
        firstDataRow: 6,
        matchBy: 'order',
        matchColumn: null,
        columns: defaultCols,
        fixedCells: [
          { cell: 'B2', source: 'class_group' },
          { cell: 'E2', source: 'subject' },
          { cell: 'H2', source: 'period' },
        ],
      },
      verified_at: new Date().toISOString(),
    });
    setSelectedTemplateId(saved.id);
    setColumnsMap(defaultCols);
    setMappingSheet('Cuadro Trimestral');
    setFirstDataRow(6);
    setTemplateNotice(
      'Se cargó una plantilla de prueba con fórmulas en F y H para verificar que Mi Libreta llena las notas sin alterar fórmulas.',
    );
  };

  const handleSaveAndFillTemplate = async () => {
    if (!currentTemplate) return;
    const mapping: TemplateMapping = {
      sheetName: mappingSheet || inspection?.sheets[0]?.name || 'Hoja1',
      firstDataRow,
      matchBy: 'order',
      matchColumn: null,
      columns: columnsMap,
      fixedCells: [
        ...(fixedCourseCell ? [{ cell: fixedCourseCell, source: 'class_group' as const }] : []),
        ...(fixedSubjectCell ? [{ cell: fixedSubjectCell, source: 'subject' as const }] : []),
        ...(fixedPeriodCell ? [{ cell: fixedPeriodCell, source: 'period' as const }] : []),
      ],
    };

    await save(db, 'export_templates', {
      id: currentTemplate.id,
      mapping,
      verified_at: new Date().toISOString(),
    });

    const originalBytes = base64ToBytes(currentTemplate.file_base64);
    const result = fillTemplatePreservingStructure(originalBytes, mapping, reportContext);

    downloadBytes(
      result.bytes,
      `Completado_${currentTemplate.file_name}`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const skippedMsg =
      result.skippedFormulaCells.length > 0
        ? ` Se protegieron ${result.skippedFormulaCells.length} celda(s) con fórmula original.`
        : '';
    setTemplateNotice(
      `Se generó el archivo «Completado_${currentTemplate.file_name}» (${result.writtenCells} celdas completadas).${skippedMsg}`,
    );
  };

  return (
    <div className="space-y-5">
      {/* Selección de Curso, Período y Botones principales de exportación */}
      <section className="no-print rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-600">Curso y asignatura</label>
              <select
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                {data.assignments.map((a) => {
                  const g = data.groups.find((x) => x.id === a.class_group_id);
                  const s = data.subjects.find((x) => x.id === a.subject_id);
                  if (!g || !s) return null;
                  return (
                    <option key={a.id} value={a.id}>
                      {g.name} «{g.parallel}» — {s.name}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600">Período académico</label>
              <select
                value={reportContext.activePeriod.id}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              >
                {reportContext.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-testid="btn-export-xlsx"
              onClick={handleExportStandardXlsx}
              className="flex min-h-12 items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-teal-800"
            >
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
              <span>Generar Excel (.xlsx)</span>
            </button>

            <button
              type="button"
              data-testid="btn-print-pdf"
              onClick={() => window.print()}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-100"
            >
              <Printer className="h-5 w-5 text-teal-700" aria-hidden="true" />
              <span>Imprimir / Guardar PDF</span>
            </button>
          </div>
        </div>

        {/* Pestañas de tipos de reporte */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {(
            [
              ['course', 'Reporte por curso'],
              ['evaluation', 'Resumen por evaluación'],
              ['student', 'Reporte por estudiante'],
              ['annual', 'Promedios por período / Anual'],
              ['template', 'Plantilla oficial de Excel del colegio'],
            ] as [ReportTab, string][]
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              data-testid={`report-tab-${tabKey}`}
              onClick={() => setActiveTab(tabKey)}
              className={`min-h-10 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === tabKey
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Advertencias previas a la generación del documento (Sección 13) */}
      {warnings.length > 0 && (
        <section
          aria-label="Advertencias antes de finalizar el reporte"
          className="no-print rounded-2xl border border-amber-300 bg-amber-50 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-amber-950">
                Revise antes de entregar el documento al colegio:
              </h2>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-amber-900">
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          VISTA 1: REPORTE POR CURSO Y PERÍODO (Imprimible en PDF)
         ===================================================================== */}
      {activeTab === 'course' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs print:border-none print:p-0 print:shadow-none">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-xl font-bold text-slate-900">{reportContext.institution.name}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              Cuadro de Calificaciones · Año Lectivo {reportContext.year.name} ·{' '}
              {reportContext.activePeriod.name}
            </p>
            <p className="text-sm text-slate-600">
              Curso: <strong>{reportContext.group.name} «{reportContext.group.parallel}»</strong> ·
              Asignatura: <strong>{reportContext.subject.name}</strong> · Regla:{' '}
              {reportContext.scheme.name}
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold text-slate-800">
                  <th className="px-2.5 py-2">N.°</th>
                  <th className="px-2.5 py-2">Apellidos y Nombres</th>
                  {periodEvals.map((ev) => (
                    <th key={ev.id} className="border-l border-slate-200 px-2.5 py-2 text-center">
                      {ev.name}
                    </th>
                  ))}
                  {!isQual &&
                    engineCats.map((c) => (
                      <th
                        key={c.key}
                        className="border-l border-slate-300 bg-slate-200/60 px-2.5 py-2 text-center"
                      >
                        {c.name} {c.weight ? `(${c.weight} %)` : ''}
                      </th>
                    ))}
                  <th className="border-l border-slate-300 bg-teal-50 px-2.5 py-2 text-center text-teal-950">
                    {isQual ? 'Nivel de logro' : `Nota ${reportContext.activePeriod.name}`}
                  </th>
                  {!isQual && (
                    <th className="border-l border-slate-200 px-2.5 py-2 text-center">Escala</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {reportContext.students.map(({ student, enrollment }, idx) => {
                  const stuGrades = new Map<string, EngineGrade>();
                  for (const g of reportContext.grades) {
                    if (g.student_id === student.id) {
                      stuGrades.set(g.evaluation_id, {
                        status: g.status,
                        value: g.value,
                        qualitative: g.qualitative,
                      });
                    }
                  }
                  const pRes = !isQual
                    ? computePeriod(
                        reportContext.scheme.config,
                        engineCats,
                        reportContext.activePeriod.id,
                        engineEvals,
                        stuGrades,
                      )
                    : null;
                  const qual = isQual ? summarizeQualitative(engineEvals, stuGrades) : null;
                  const eq = pRes ? equivalenceFor(reportContext.scheme.config, pRes.average) : null;

                  return (
                    <tr key={student.id}>
                      <td className="px-2.5 py-2 font-semibold text-slate-500">
                        {enrollment.list_number ?? idx + 1}
                      </td>
                      <td className="px-2.5 py-2 font-semibold text-slate-900">
                        {student.last_names} {student.first_names}
                        {enrollment.status !== 'active' && (
                          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700">
                            {enrollment.status === 'withdrawn' ? 'Retirado' : 'Trasladado'}
                          </span>
                        )}
                      </td>
                      {periodEvals.map((ev) => (
                        <td
                          key={ev.id}
                          className="border-l border-slate-200 px-2.5 py-2 text-center"
                        >
                          {gradeDisplay(stuGrades.get(ev.id)) || '—'}
                        </td>
                      ))}
                      {!isQual &&
                        pRes?.categories.map((cat) => (
                          <td
                            key={cat.key}
                            className="border-l border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-semibold"
                          >
                            {cat.average !== null ? formatDecimal(cat.average, 2) : '—'}
                          </td>
                        ))}
                      <td className="border-l border-slate-300 bg-teal-50/40 px-2.5 py-2 text-center font-bold text-teal-950">
                        {isQual
                          ? (qual?.latest ?? '—')
                          : pRes?.average !== null && pRes?.average !== undefined
                            ? formatDecimal(pRes.average, 2)
                            : '—'}
                      </td>
                      {!isQual && (
                        <td className="border-l border-slate-200 px-2.5 py-2 text-center text-xs font-semibold text-slate-700">
                          {eq ? eq.code : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-10 hidden grid-cols-2 gap-12 pt-8 text-center text-xs text-slate-700 print:grid">
            <div className="border-t border-slate-400 pt-2">
              Firma del Docente ({reportContext.teacherName || '________________'})
            </div>
            <div className="border-t border-slate-400 pt-2">
              Vicerrectorado / Secretaría
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          VISTA 2: RESUMEN POR EVALUACIÓN
         ===================================================================== */}
      {activeTab === 'evaluation' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-bold text-slate-900">
            Resumen de calificaciones por evaluación ({reportContext.activePeriod.name})
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {periodEvals.map((ev) => {
              let graded = 0;
              let absent = 0;
              let pending = 0;
              let empty = 0;
              for (const { student } of reportContext.students) {
                const g = reportContext.grades.find(
                  (x) => x.evaluation_id === ev.id && x.student_id === student.id,
                );
                const st = g?.status ?? 'empty';
                if (st === 'graded') graded++;
                else if (st === 'absent') absent++;
                else if (st === 'pending') pending++;
                else empty++;
              }
              return (
                <div key={ev.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-bold text-slate-900">{ev.name}</h3>
                  <p className="text-xs text-slate-500">Fecha: {ev.date || 'No especificada'}</p>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-900">
                      <span className="block text-base font-bold">{graded}</span>
                      Calificados
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2 text-amber-900">
                      <span className="block text-base font-bold">{absent}</span>
                      Ausentes
                    </div>
                    <div className="rounded-lg bg-sky-50 p-2 text-sky-900">
                      <span className="block text-base font-bold">{pending}</span>
                      Pendientes
                    </div>
                    <div className="rounded-lg bg-slate-200/70 p-2 text-slate-800">
                      <span className="block text-base font-bold">{empty}</span>
                      Sin nota
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* =====================================================================
          VISTA 3: REPORTE INDIVIDUAL POR ESTUDIANTE
         ===================================================================== */}
      {activeTab === 'student' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="no-print mb-4 flex items-center gap-3">
            <label htmlFor="select-student-report" className="text-sm font-bold text-slate-700">
              Seleccionar estudiante:
            </label>
            <select
              id="select-student-report"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-900"
            >
              {reportContext.students.map(({ student, enrollment }) => (
                <option key={student.id} value={student.id}>
                  {enrollment.list_number ? `${enrollment.list_number}. ` : ''}
                  {student.last_names} {student.first_names}
                </option>
              ))}
            </select>
          </div>

          {(() => {
            const entry = reportContext.students.find((s) => s.student.id === selectedStudentId);
            if (!entry) return null;
            const stuGrades = new Map<string, EngineGrade>();
            for (const g of reportContext.grades) {
              if (g.student_id === entry.student.id) {
                stuGrades.set(g.evaluation_id, {
                  status: g.status,
                  value: g.value,
                  qualitative: g.qualitative,
                });
              }
            }
            const pRes = !isQual
              ? computePeriod(
                  reportContext.scheme.config,
                  engineCats,
                  reportContext.activePeriod.id,
                  engineEvals,
                  stuGrades,
                )
              : null;
            const eq = pRes ? equivalenceFor(reportContext.scheme.config, pRes.average) : null;

            return (
              <div className="space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h2 className="text-xl font-bold text-slate-900">
                    Informe Individual: {entry.student.last_names} {entry.student.first_names}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {reportContext.group.name} «{reportContext.group.parallel}» ·{' '}
                    {reportContext.subject.name} · {reportContext.activePeriod.name}
                  </p>
                </div>

                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2">Evaluación</th>
                      <th className="px-3 py-2">Categoría</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Calificación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {periodEvals.map((ev) => {
                      const cat = reportContext.categories.find((c) => c.key === ev.category_key);
                      return (
                        <tr key={ev.id}>
                          <td className="px-3 py-2 font-semibold">{ev.name}</td>
                          <td className="px-3 py-2 text-slate-600">{cat?.name ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{ev.date ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-bold">
                            {gradeDisplay(stuGrades.get(ev.id)) || 'Sin registrar'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {!isQual && pRes && (
                  <div className="rounded-xl bg-teal-50 p-4">
                    <p className="text-sm font-bold text-teal-950">
                      Nota del período: {pRes.average ? formatDecimal(pRes.average, 2) : '—'}{' '}
                      {eq ? `(${eq.code} — ${eq.label})` : ''}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-teal-900">
                      {pRes.steps.map((s, i) => (
                        <li key={i}>• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {/* =====================================================================
          VISTA 4: PROMEDIOS POR PERÍODO ACADÉMICO Y ANUAL
         ===================================================================== */}
      {activeTab === 'annual' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-bold text-slate-900">
            Promedios por período académico y resultado anual — {reportContext.subject.name}
          </h2>
          {isQual ? (
            <p className="mt-2 text-sm text-slate-600">
              Este curso utiliza evaluación cualitativa (Inicial / Preparatoria). Conforme a la
              normativa, no se calculan promedios numéricos.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold">
                    <th className="px-3 py-2">N.°</th>
                    <th className="px-3 py-2">Estudiante</th>
                    {reportContext.periods.map((p) => (
                      <th key={p.id} className="border-l border-slate-200 px-3 py-2 text-center">
                        {p.name}
                      </th>
                    ))}
                    <th className="border-l border-slate-300 bg-teal-50 px-3 py-2 text-center">
                      Promedio Anual
                    </th>
                    <th className="border-l border-slate-200 px-3 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reportContext.students.map(({ student, enrollment }, idx) => {
                    const stuGrades = new Map<string, EngineGrade>();
                    for (const g of reportContext.grades) {
                      if (g.student_id === student.id) {
                        stuGrades.set(g.evaluation_id, {
                          status: g.status,
                          value: g.value,
                          qualitative: g.qualitative,
                        });
                      }
                    }
                    const annual = computeAnnual(
                      reportContext.scheme.config,
                      engineCats,
                      periodIds,
                      engineEvals,
                      stuGrades,
                    );
                    return (
                      <tr key={student.id}>
                        <td className="px-3 py-2 text-slate-500">
                          {enrollment.list_number ?? idx + 1}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {student.last_names} {student.first_names}
                        </td>
                        {annual.periods.map((pr) => (
                          <td
                            key={pr.periodId}
                            className="border-l border-slate-200 px-3 py-2 text-center"
                          >
                            {pr.average !== null ? formatDecimal(pr.average, 2) : '—'}
                          </td>
                        ))}
                        <td className="border-l border-slate-300 bg-teal-50/40 px-3 py-2 text-center font-bold text-teal-950">
                          {annual.final !== null ? formatDecimal(annual.final, 2) : '—'}
                        </td>
                        <td className="border-l border-slate-200 px-3 py-2 text-center text-xs font-bold">
                          {ANNUAL_STATUS_LABELS[annual.status]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          VISTA 5: COMPATIBILIDAD CON PLANTILLAS ORIGINALES DE EXCEL (Sección 14)
         ===================================================================== */}
      {activeTab === 'template' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Compatibilidad con plantillas Excel del colegio
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Cargue el archivo <code>.xlsx</code> que le entregó el colegio, indique en qué columna va cada dato
                y Mi Libreta completará las calificaciones conservando intactas todas las fórmulas, celdas combinadas y formatos.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Cargar plantilla del colegio (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadTemplateFile(f);
                  }}
                />
              </label>

              <button
                type="button"
                data-testid="btn-load-sample-template"
                onClick={handleLoadSampleTemplate}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-100"
              >
                <FileText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>Usar plantilla de prueba con fórmulas</span>
              </button>
            </div>
          </div>

          {templateNotice && (
            <div
              data-testid="template-notice"
              className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-950"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
              <span>{templateNotice}</span>
            </div>
          )}

          {data.templates.length > 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600">
                  Plantilla seleccionada
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-900 sm:max-w-md"
                >
                  <option value="">Seleccione una plantilla…</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.file_name})
                    </option>
                  ))}
                </select>
              </div>

              {currentTemplate && inspection && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Panel izquierdo: Análisis de la plantilla */}
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-5">
                    <h3 className="font-bold text-slate-900">
                      Análisis automático de «{currentTemplate.file_name}»
                    </h3>
                    {inspection.sheets.map((sh) => (
                      <div key={sh.name} className="rounded-lg bg-white p-3 text-xs shadow-2xs">
                        <p className="font-bold text-teal-900">Hoja: {sh.name}</p>
                        <p className="mt-1 text-slate-600">
                          Filas detectadas: {sh.rowCount} · Celdas combinadas: {sh.mergedCount} ·
                          Celdas con fórmula protegidas: <strong>{sh.formulaCells.length}</strong>
                        </p>
                        {sh.formulaCells.length > 0 && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Ejemplos de fórmulas conservadas:{' '}
                            {sh.formulaCells
                              .slice(0, 3)
                              .map((f) => `${f.address} (=${f.formula})`)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Panel derecho: Configuración del mapeo reutilizable */}
                  <div className="space-y-4 lg:col-span-7">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-700">
                          Hoja donde se llenarán las notas
                        </label>
                        <select
                          value={mappingSheet}
                          onChange={(e) => setMappingSheet(e.target.value)}
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
                        >
                          {inspection.sheets.map((s) => (
                            <option key={s.name} value={s.name}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700">
                          Fila del primer estudiante
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={firstDataRow}
                          onChange={(e) => setFirstDataRow(Number(e.target.value))}
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase text-slate-600">
                          Columnas a completar
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setColumnsMap((prev) => [
                              ...prev,
                              { column: 'C', source: { type: 'full_name' } },
                            ])
                          }
                          className="text-xs font-bold text-teal-800 hover:underline"
                        >
                          + Agregar columna
                        </button>
                      </div>

                      {columnsMap.map((col, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={2}
                            value={col.column}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              setColumnsMap((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, column: val } : item)),
                              );
                            }}
                            className="min-h-10 w-16 rounded-lg border border-slate-300 text-center font-bold uppercase"
                            placeholder="Col"
                          />
                          <select
                            value={
                              col.source.type === 'evaluation'
                                ? `eval:${col.source.evaluationId}`
                                : col.source.type
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              let newSource: TemplateColumn['source'];
                              if (v.startsWith('eval:')) {
                                newSource = { type: 'evaluation', evaluationId: v.slice(5) };
                              } else if (v === 'period_average') {
                                newSource = {
                                  type: 'period_average',
                                  periodId: reportContext.activePeriod.id,
                                };
                              } else if (v === 'qualitative_equivalence') {
                                newSource = {
                                  type: 'qualitative_equivalence',
                                  periodId: reportContext.activePeriod.id,
                                };
                              } else if (v === 'list_number') {
                                newSource = { type: 'list_number' };
                              } else if (v === 'last_names') {
                                newSource = { type: 'last_names' };
                              } else if (v === 'first_names') {
                                newSource = { type: 'first_names' };
                              } else {
                                newSource = { type: 'full_name' };
                              }
                              setColumnsMap((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, source: newSource } : item,
                                ),
                              );
                            }}
                            className="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                          >
                            <option value="list_number">Número de lista</option>
                            <option value="full_name">Apellidos y Nombres completos</option>
                            <option value="last_names">Solo Apellidos</option>
                            <option value="first_names">Solo Nombres</option>
                            {periodEvals.map((ev) => (
                              <option key={ev.id} value={`eval:${ev.id}`}>
                                Calificación: {ev.name}
                              </option>
                            ))}
                            <option value="period_average">
                              Nota del período ({reportContext.activePeriod.name})
                            </option>
                            <option value="qualitative_equivalence">
                              Escala cualitativa (DAR / AAR / PAAR / NAAR)
                            </option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setColumnsMap((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="min-h-10 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      data-testid="btn-fill-template-download"
                      onClick={handleSaveAndFillTemplate}
                      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-teal-800"
                    >
                      <Download className="h-5 w-5" aria-hidden="true" />
                      <span>Guardar mapeo y descargar plantilla completada (.xlsx)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

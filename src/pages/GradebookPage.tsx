/**
 * Pantalla «Mi Libreta» — Registro y consulta de calificaciones:
 *
 * Incluye los dos modos prioritarios de la especificación:
 * 1) MODO CELULAR (Sección 10):
 *    - Selecciona evaluación, muestra la lista ordenada de estudiantes y abre un
 *      teclado numérico/cualitativo grande (>= 44x44px) que valida contra la escala,
 *      acepta coma o punto decimal, distingue «Sin registrar», «Ausente» y «Pendiente»,
 *      guarda automáticamente en IndexedDB y avanza al siguiente estudiante sin cambiar de pantalla.
 *
 * 2) MODO COMPUTADORA / TABLA (Sección 11):
 *    - Estudiantes en filas y evaluaciones en columnas con cabeceras fijas.
 *    - Navegación con Enter, Tab y flechas del teclado.
 *    - Copiar y pegar rangos de calificaciones directamente desde o hacia Excel.
 *    - Búsqueda y filtrado de estudiantes (Todos / Con notas pendientes).
 *    - Botón para ver el desglose matemático paso a paso de cualquier promedio.
 *    - Posibilidad de deshacer modificaciones recientes y consultar historial de cambios.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Delete,
  History,
  Laptop,
  Plus,
  Search,
  Smartphone,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isLive, save, softDelete } from '../db/repo';
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
import { formatDecimal, gradeDisplay, gradeEditText, parseGradeInput } from '../domain/gradeInput';
import type { Evaluation, Grade, GradeStatus, Student } from '../domain/types';
import { gradeIdFor } from '../lib/ids';

export function GradebookPage() {
  const { db, undoLastGradeChange, canUndoGrade, syncStatus } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  // Detecta por ancho de ventana el modo inicial (celular vs computadora), permitiendo alternar con 1 clic
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
  );

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>(
    () => searchParams.get('curso') ?? '',
  );
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [selectedEvalId, setSelectedEvalId] = useState<string>('');
  const [activeStudentIdx, setActiveStudentIdx] = useState<number>(0);

  // Teclado móvil: buffer de escritura y mensaje de error comprensible
  const [keypadBuffer, setKeypadBuffer] = useState<string>('');
  const [keypadError, setKeypadError] = useState<string | null>(null);
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);

  // Filtros de vista de computadora
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [sortBy, setSortBy] = useState<'list' | 'last_names' | 'first_names'>('list');

  // Modales auxiliares: Nueva evaluación, Copiar evaluación, Explicación de promedio, Historial
  const [showNewEvalModal, setShowNewEvalModal] = useState(false);
  const [copyFromEval, setCopyFromEval] = useState<Evaluation | null>(null);
  const [explainStudent, setExplainStudent] = useState<Student | null>(null);
  const [historyGradeId, setHistoryGradeId] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const years = (await db.academic_years.toArray()).filter(isLive);
    const activeYear = years.find((y) => y.is_active) ?? years[0] ?? null;
    const groups = (await db.class_groups.toArray()).filter(isLive);
    const subjects = (await db.subjects.toArray()).filter(isLive);
    const assignments = (await db.teaching_assignments.toArray()).filter(isLive);
    const periods = (await db.academic_periods.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const schemes = (await db.grading_schemes.toArray()).filter(isLive);
    const categories = (await db.evaluation_categories.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const students = (await db.students.toArray()).filter(isLive);
    const enrollments = (await db.enrollments.toArray()).filter(isLive);
    const evaluations = (await db.evaluations.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const grades = (await db.grades.toArray()).filter(isLive);
    const lastAssignmentId = await db.getMeta<string>('last_assignment_id');

    return {
      activeYear,
      groups,
      subjects,
      assignments,
      periods,
      schemes,
      categories,
      students,
      enrollments,
      evaluations,
      grades,
      lastAssignmentId,
    };
  }, [], null);

  // Seleccionar curso y período por defecto cuando cargan los datos
  useEffect(() => {
    if (!data) return;
    const paramCourse = searchParams.get('curso');
    if (paramCourse && data.assignments.some((a) => a.id === paramCourse)) {
      if (selectedAssignmentId !== paramCourse) setSelectedAssignmentId(paramCourse);
    } else if (!selectedAssignmentId || !data.assignments.some((a) => a.id === selectedAssignmentId)) {
      const fallback =
        data.assignments.find((a) => a.id === data.lastAssignmentId)?.id ??
        data.assignments[0]?.id ??
        '';
      if (fallback) setSelectedAssignmentId(fallback);
    }
  }, [data, searchParams, selectedAssignmentId]);

  useEffect(() => {
    if (!data || !selectedAssignmentId) return;
    const assignment = data.assignments.find((a) => a.id === selectedAssignmentId);
    if (!assignment) return;
    const yearPeriods = data.periods.filter((p) => p.academic_year_id === assignment.academic_year_id);
    if (!selectedPeriodId || !yearPeriods.some((p) => p.id === selectedPeriodId)) {
      setSelectedPeriodId(yearPeriods[0]?.id ?? '');
    }
  }, [data, selectedAssignmentId, selectedPeriodId]);

  const currentContext = useMemo(() => {
    if (!data || !selectedAssignmentId) return null;
    const assignment = data.assignments.find((a) => a.id === selectedAssignmentId);
    if (!assignment) return null;
    const group = data.groups.find((g) => g.id === assignment.class_group_id);
    const subject = data.subjects.find((s) => s.id === assignment.subject_id);
    const scheme = data.schemes.find((s) => s.id === assignment.grading_scheme_id);
    if (!group || !subject || !scheme) return null;

    const schemeCategories = data.categories.filter((c) => c.scheme_id === scheme.id);
    const yearPeriods = data.periods.filter((p) => p.academic_year_id === assignment.academic_year_id);
    const activePeriod = yearPeriods.find((p) => p.id === selectedPeriodId) ?? yearPeriods[0] ?? null;

    const courseEvals = data.evaluations.filter((e) => e.assignment_id === assignment.id);
    const periodEvals = courseEvals.filter(
      (e) => e.period_id === activePeriod?.id && e.kind === 'regular',
    );

    const stuMap = new Map(data.students.map((s) => [s.id, s]));
    const enrolled = data.enrollments
      .filter((e) => e.class_group_id === group.id && e.status === 'active')
      .map((enr) => ({ enrollment: enr, student: stuMap.get(enr.student_id)! }))
      .filter((x) => Boolean(x.student));

    enrolled.sort((a, b) => {
      if (sortBy === 'last_names') {
        return a.student.last_names.localeCompare(b.student.last_names, 'es');
      }
      if (sortBy === 'first_names') {
        return a.student.first_names.localeCompare(b.student.first_names, 'es');
      }
      return (a.enrollment.list_number ?? 999) - (b.enrollment.list_number ?? 999);
    });

    const gradeByCell = new Map<string, Grade>();
    for (const g of data.grades) {
      gradeByCell.set(`${g.evaluation_id}:${g.student_id}`, g);
    }

    return {
      assignment,
      group,
      subject,
      scheme,
      schemeCategories,
      yearPeriods,
      activePeriod,
      courseEvals,
      periodEvals,
      enrolled,
      gradeByCell,
    };
  }, [data, selectedAssignmentId, selectedPeriodId, sortBy]);

  // Seleccionar primera evaluación del período automáticamente
  useEffect(() => {
    if (!currentContext) return;
    if (
      !selectedEvalId ||
      !currentContext.periodEvals.some((e) => e.id === selectedEvalId)
    ) {
      setSelectedEvalId(currentContext.periodEvals[0]?.id ?? '');
    }
  }, [currentContext, selectedEvalId]);

  // Sincronizar el buffer del teclado móvil cuando cambia el estudiante o la evaluación activa
  const activeEval = currentContext?.periodEvals.find((e) => e.id === selectedEvalId) ?? null;
  const activeStudentEntry = currentContext?.enrolled[activeStudentIdx] ?? null;

  useEffect(() => {
    if (!currentContext || !activeEval || !activeStudentEntry) {
      setKeypadBuffer('');
      setKeypadError(null);
      return;
    }
    const existing = currentContext.gradeByCell.get(
      `${activeEval.id}:${activeStudentEntry.student.id}`,
    );
    if (existing?.status === 'graded') {
      setKeypadBuffer(existing.qualitative ?? formatDecimal(existing.value));
    } else {
      setKeypadBuffer('');
    }
    setKeypadError(null);
  }, [currentContext, activeEval?.id, activeStudentEntry?.student.id]);

  if (!data || !currentContext) {
    return <div className="py-12 text-center text-slate-600">Cargando libreta…</div>;
  }

  const {
    assignment,
    group,
    subject,
    scheme,
    schemeCategories,
    yearPeriods,
    activePeriod,
    courseEvals,
    periodEvals,
    enrolled,
    gradeByCell,
  } = currentContext;

  const engineCats: EngineCategory[] = schemeCategories.map((c) => ({
    key: c.key,
    name: c.name,
    kind: c.kind,
    weight: c.weight,
  }));

  const engineEvals: EngineEvaluation[] = courseEvals.map((e) => ({
    id: e.id,
    name: e.name,
    category_key: e.category_key,
    period_id: e.period_id,
    weight: e.weight,
    kind: e.kind,
  }));

  const saveGradeValue = async (
    evaluationId: string,
    studentId: string,
    rawInput: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const parsed = parseGradeInput(rawInput, scheme.config);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    const id = await gradeIdFor(evaluationId, studentId);
    await save(db, 'grades', {
      id,
      evaluation_id: evaluationId,
      student_id: studentId,
      status: parsed.status,
      value: parsed.value,
      qualitative: parsed.qualitative,
    });
    setLastSavedNotice(
      syncStatus === 'synced' ? 'Guardado y sincronizado' : 'Guardado en este dispositivo',
    );
    return { ok: true };
  };

  const setSpecialStatus = async (
    evaluationId: string,
    studentId: string,
    status: Exclude<GradeStatus, 'graded'>,
    advanceAfter = false,
  ) => {
    const id = await gradeIdFor(evaluationId, studentId);
    await save(db, 'grades', {
      id,
      evaluation_id: evaluationId,
      student_id: studentId,
      status,
      value: null,
      qualitative: null,
    });
    setKeypadError(null);
    setLastSavedNotice(
      syncStatus === 'synced' ? 'Guardado y sincronizado' : 'Guardado en este dispositivo',
    );
    if (advanceAfter && activeStudentIdx < enrolled.length - 1) {
      setActiveStudentIdx((i) => Math.min(enrolled.length - 1, i + 1));
    }
  };

  const handleMobileSaveAndNext = async () => {
    if (!activeEval || !activeStudentEntry) return;
    const res = await saveGradeValue(activeEval.id, activeStudentEntry.student.id, keypadBuffer);
    if (!res.ok) {
      setKeypadError(res.error ?? 'Valor no válido');
      return;
    }
    setKeypadError(null);
    if (activeStudentIdx < enrolled.length - 1) {
      setActiveStudentIdx((idx) => idx + 1);
    }
  };

  const handleMobileKey = (char: string) => {
    setKeypadError(null);
    if (char === ',') {
      if (keypadBuffer.includes(',') || keypadBuffer.includes('.')) return;
      setKeypadBuffer((prev) => (prev === '' ? '0,' : `${prev},`));
      return;
    }
    setKeypadBuffer((prev) => (prev.length >= 5 ? prev : `${prev}${char}`));
  };

  // Filtrar estudiantes para la vista de tabla
  const filteredEnrolled = enrolled.filter(({ student }) => {
    const fullName = `${student.last_names} ${student.first_names}`.toLowerCase();
    if (searchQuery.trim() && !fullName.includes(searchQuery.trim().toLowerCase())) {
      return false;
    }
    if (onlyIncomplete) {
      const hasMissing = periodEvals.some((ev) => {
        const g = gradeByCell.get(`${ev.id}:${student.id}`);
        return !g || g.status !== 'graded';
      });
      if (!hasMissing) return false;
    }
    return true;
  });

  // Contar cuántas celdas están pendientes o sin registrar en este período
  let missingCellsCount = 0;
  for (const { student } of enrolled) {
    for (const ev of periodEvals) {
      const g = gradeByCell.get(`${ev.id}:${student.id}`);
      if (!g || g.status !== 'graded') missingCellsCount++;
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra superior de selección de Curso, Período y Modo (Celular / Computadora) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:items-center">
            <div>
              <label htmlFor="select-course" className="block text-xs font-bold text-slate-600">
                Curso y asignatura
              </label>
              <select
                id="select-course"
                data-testid="select-course"
                value={selectedAssignmentId}
                onChange={async (e) => {
                  const id = e.target.value;
                  setSelectedAssignmentId(id);
                  setSearchParams({ curso: id });
                  await db.setMeta('last_assignment_id', id);
                  setActiveStudentIdx(0);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-teal-700 focus:outline-none sm:min-w-64"
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
              <label htmlFor="select-period" className="block text-xs font-bold text-slate-600">
                Período académico
              </label>
              <select
                id="select-period"
                data-testid="select-period"
                value={activePeriod?.id ?? ''}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {yearPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.closed_at ? ' (Cerrado)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Alternador de vista Celular vs Tabla de Computadora */}
            <div
              role="group"
              aria-label="Modo de visualización"
              className="inline-flex rounded-xl border border-slate-300 bg-slate-100 p-1"
            >
              <button
                type="button"
                data-testid="mode-mobile-btn"
                onClick={() => setViewMode('mobile')}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  viewMode === 'mobile'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                <span>Modo Celular</span>
              </button>
              <button
                type="button"
                data-testid="mode-desktop-btn"
                onClick={() => setViewMode('desktop')}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  viewMode === 'desktop'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Laptop className="h-4 w-4" aria-hidden="true" />
                <span>Modo Tabla (PC)</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="btn-new-evaluation"
              onClick={() => {
                setCopyFromEval(null);
                setShowNewEvalModal(true);
              }}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Nueva evaluación</span>
            </button>

            {canUndoGrade && (
              <button
                type="button"
                data-testid="btn-undo-grade"
                onClick={() => undoLastGradeChange()}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                <span>Deshacer último cambio</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* =====================================================================
          MODO 1: REGISTRO RÁPIDO EN CELULAR (Sección 10)
         ===================================================================== */}
      {viewMode === 'mobile' && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-label="Registro en celular">
          {/* Selección de evaluación activa */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mobile-eval-select" className="text-xs font-bold uppercase text-slate-500">
                Evaluación a calificar
              </label>
              {activeEval && (
                <button
                  type="button"
                  onClick={() => {
                    setCopyFromEval(activeEval);
                    setShowNewEvalModal(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:underline"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Duplicar estructura</span>
                </button>
              )}
            </div>

            {periodEvals.length === 0 ? (
              <div className="mt-3 rounded-xl bg-slate-50 p-4 text-center">
                <p className="text-sm text-slate-600">Aún no hay evaluaciones en este período.</p>
                <button
                  type="button"
                  onClick={() => setShowNewEvalModal(true)}
                  className="mt-2 min-h-11 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
                >
                  Crear primera evaluación
                </button>
              </div>
            ) : (
              <>
                <select
                  id="mobile-eval-select"
                  data-testid="mobile-eval-select"
                  value={activeEval?.id ?? ''}
                  onChange={(e) => setSelectedEvalId(e.target.value)}
                  className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {periodEvals.map((ev) => {
                    const cat = schemeCategories.find((c) => c.key === ev.category_key);
                    return (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} {cat ? `(${cat.name})` : ''}
                      </option>
                    );
                  })}
                </select>

                {/* Lista ordenada de estudiantes para tocar y saltar directamente */}
                <div className="mt-4 max-h-96 space-y-1.5 overflow-y-auto pr-1">
                  {enrolled.map(({ student, enrollment }, idx) => {
                    const g = activeEval
                      ? gradeByCell.get(`${activeEval.id}:${student.id}`)
                      : undefined;
                    const display = gradeDisplay(g);
                    const isSelected = idx === activeStudentIdx;
                    return (
                      <button
                        key={student.id}
                        type="button"
                        data-testid={`mobile-student-row-${student.id}`}
                        onClick={() => setActiveStudentIdx(idx)}
                        className={`flex min-h-12 w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition ${
                          isSelected
                            ? 'bg-teal-700 text-white shadow-xs'
                            : 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <span
                            className={`mr-2 inline-block text-xs font-bold ${
                              isSelected ? 'text-teal-100' : 'text-slate-500'
                            }`}
                          >
                            {enrollment.list_number ?? idx + 1}.
                          </span>
                          <span className="font-semibold">
                            {student.last_names} {student.first_names}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ${
                            isSelected
                              ? 'bg-teal-900/50 text-white'
                              : display
                                ? 'bg-teal-100 text-teal-950'
                                : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {display || 'Sin nota'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Tarjeta de calificación y teclado numérico táctil grande */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
            {activeEval && activeStudentEntry ? (
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
                      Estudiante {activeStudentIdx + 1} de {enrolled.length} · {activeEval.name}
                    </span>
                    <h2
                      data-testid="mobile-active-student-name"
                      className="mt-0.5 text-xl font-bold text-slate-900 sm:text-2xl"
                    >
                      {activeStudentEntry.student.last_names} {activeStudentEntry.student.first_names}
                    </h2>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={activeStudentIdx === 0}
                      onClick={() => setActiveStudentIdx((i) => Math.max(0, i - 1))}
                      aria-label="Estudiante anterior"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-700 disabled:opacity-40"
                    >
                      <ChevronUp className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      disabled={activeStudentIdx >= enrolled.length - 1}
                      onClick={() => setActiveStudentIdx((i) => Math.min(enrolled.length - 1, i + 1))}
                      aria-label="Siguiente estudiante"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-700 disabled:opacity-40"
                    >
                      <ChevronDown className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Estado actual del estudiante en esta evaluación */}
                {(() => {
                  const currentGrade = gradeByCell.get(
                    `${activeEval.id}:${activeStudentEntry.student.id}`,
                  );
                  return (
                    <div className="mt-4">
                      {scheme.config.mode === 'quantitative' ? (
                        <>
                          <div className="flex items-center justify-between rounded-2xl border-2 border-teal-700 bg-slate-50 px-4 py-3">
                            <div>
                              <span className="block text-xs font-semibold text-slate-500">
                                Escala permitida: {formatDecimal(scheme.config.scale.min)} a{' '}
                                {formatDecimal(scheme.config.scale.max)}
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                data-testid="mobile-grade-input"
                                aria-label="Calificación del estudiante"
                                value={keypadBuffer}
                                onChange={(e) => {
                                  setKeypadError(null);
                                  setKeypadBuffer(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleMobileSaveAndNext();
                                  }
                                }}
                                placeholder={
                                  currentGrade?.status === 'absent'
                                    ? 'Ausente'
                                    : currentGrade?.status === 'pending'
                                      ? 'Pendiente'
                                      : 'Sin registrar'
                                }
                                className="mt-0.5 w-full bg-transparent text-3xl font-bold text-slate-900 focus:outline-none"
                              />
                            </div>
                            {currentGrade && currentGrade.version === 0 && (
                              <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                                Guardado en este dispositivo
                              </span>
                            )}
                            {currentGrade && currentGrade.version > 0 && (
                              <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900">
                                Sincronizado
                              </span>
                            )}
                          </div>

                          {keypadError && (
                            <p
                              role="alert"
                              data-testid="mobile-grade-error"
                              className="mt-2 rounded-xl bg-red-50 px-3.5 py-2 text-sm font-bold text-red-800"
                            >
                              {keypadError}
                            </p>
                          )}

                          {/* Teclado numérico táctil grande */}
                          <div className="mt-4 grid grid-cols-3 gap-2.5">
                            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', ','].map((digit) => (
                              <button
                                key={digit}
                                type="button"
                                data-testid={`keypad-${digit === ',' ? 'comma' : digit}`}
                                onClick={() => handleMobileKey(digit)}
                                className="min-h-14 rounded-2xl border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-900 active:bg-slate-200"
                              >
                                {digit}
                              </button>
                            ))}
                            <button
                              type="button"
                              data-testid="keypad-backspace"
                              aria-label="Borrar último dígito"
                              onClick={() => {
                                setKeypadError(null);
                                setKeypadBuffer((prev) => prev.slice(0, -1));
                              }}
                              className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-800 active:bg-slate-200"
                            >
                              <Delete className="h-6 w-6" />
                            </button>
                          </div>

                          {/* Botón principal: Guardar y pasar al siguiente estudiante */}
                          <button
                            type="button"
                            data-testid="mobile-save-next-btn"
                            onClick={handleMobileSaveAndNext}
                            className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 px-6 py-3.5 text-base font-bold text-white shadow-sm hover:bg-teal-800"
                          >
                            <Check className="h-5 w-5" aria-hidden="true" />
                            <span>Guardar y siguiente estudiante</span>
                          </button>
                        </>
                      ) : (
                        /* Teclado cualitativo para Inicial y Preparatoria */
                        <div className="mt-3 space-y-2.5">
                          <p className="text-sm font-semibold text-slate-600">
                            Seleccione el nivel de logro (escala cualitativa sin promedio numérico):
                          </p>
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            {scheme.config.qualitativeOptions.map((opt) => {
                              const active =
                                currentGrade?.status === 'graded' &&
                                currentGrade.qualitative === opt.code;
                              return (
                                <button
                                  key={opt.code}
                                  type="button"
                                  data-testid={`qual-option-${opt.code}`}
                                  onClick={async () => {
                                    await saveGradeValue(
                                      activeEval.id,
                                      activeStudentEntry.student.id,
                                      opt.code,
                                    );
                                    if (activeStudentIdx < enrolled.length - 1) {
                                      setActiveStudentIdx((i) => i + 1);
                                    }
                                  }}
                                  className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 py-3 text-left font-bold ${
                                    active
                                      ? 'border-teal-700 bg-teal-700 text-white'
                                      : 'border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100'
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  <span className="rounded-lg bg-black/10 px-2.5 py-1 text-sm">
                                    {opt.code}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Estados especiales explícitos: Ausente, Pendiente, Sin registrar */}
                      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          data-testid="mobile-status-absent"
                          onClick={() =>
                            setSpecialStatus(
                              activeEval.id,
                              activeStudentEntry.student.id,
                              'absent',
                              true,
                            )
                          }
                          className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100"
                        >
                          Marcar Ausente
                        </button>
                        <button
                          type="button"
                          data-testid="mobile-status-pending"
                          onClick={() =>
                            setSpecialStatus(
                              activeEval.id,
                              activeStudentEntry.student.id,
                              'pending',
                              true,
                            )
                          }
                          className="min-h-11 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-950 hover:bg-sky-100"
                        >
                          Marcar Pendiente
                        </button>
                        <button
                          type="button"
                          data-testid="mobile-status-empty"
                          onClick={() => {
                            setKeypadBuffer('');
                            setSpecialStatus(
                              activeEval.id,
                              activeStudentEntry.student.id,
                              'empty',
                              false,
                            );
                          }}
                          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          Dejar sin registrar
                        </button>
                      </div>

                      {lastSavedNotice && (
                        <p className="mt-3 text-center text-xs font-semibold text-teal-800">
                          {lastSavedNotice}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="py-8 text-center text-slate-600">
                Seleccione o cree una evaluación para empezar a registrar calificaciones.
              </p>
            )}
          </div>
        </section>
      )}

      {/* =====================================================================
          MODO 2: TABLA PARA COMPUTADORA (Sección 11)
         ===================================================================== */}
      {viewMode === 'desktop' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          {/* Controles de filtrado, ordenamiento e indicador de notas pendientes */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar estudiante…"
                  aria-label="Buscar estudiante"
                  className="min-h-10 rounded-xl border border-slate-300 pl-9 pr-3 text-sm focus:border-teal-700 focus:outline-none"
                />
              </div>

              <select
                aria-label="Ordenar estudiantes por"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700"
              >
                <option value="list">Ordenar por N.° de lista</option>
                <option value="last_names">Ordenar por Apellidos</option>
                <option value="first_names">Ordenar por Nombres</option>
              </select>

              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyIncomplete}
                  onChange={(e) => setOnlyIncomplete(e.target.checked)}
                  className="h-4 w-4 rounded text-teal-700"
                />
                <span>Solo con notas pendientes ({missingCellsCount})</span>
              </label>
            </div>

            <div className="text-xs text-slate-500">
              Use <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">Enter</kbd>,{' '}
              <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">Tab</kbd> o flechas para
              moverse · Escriba <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">a</kbd> =
              Ausente, <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">p</kbd> =
              Pendiente · Puede pegar columnas desde Excel.
            </div>
          </div>

          <DesktopGradeTable
            enrolled={filteredEnrolled}
            periodEvals={periodEvals}
            schemeCategories={schemeCategories}
            scheme={scheme}
            activePeriodId={activePeriod?.id ?? ''}
            engineCats={engineCats}
            engineEvals={engineEvals}
            gradeByCell={gradeByCell}
            onSaveCell={saveGradeValue}
            onCopyEval={(ev) => {
              setCopyFromEval(ev);
              setShowNewEvalModal(true);
            }}
            onDeleteEval={async (ev) => {
              if (
                window.confirm(
                  `¿Desea archivar la evaluación «${ev.name}»? Podrá restaurarla si fue un error.`,
                )
              ) {
                await softDelete(db, 'evaluations', ev.id);
              }
            }}
            onExplainStudent={(stu) => setExplainStudent(stu)}
            onShowHistory={(gId) => setHistoryGradeId(gId)}
          />
        </section>
      )}

      {/* Modal: Crear o copiar evaluación */}
      {showNewEvalModal && activePeriod && (
        <NewEvaluationModal
          assignmentId={assignment.id}
          periodId={activePeriod.id}
          categories={schemeCategories}
          withinCategoryWeighted={scheme.config.withinCategory === 'weighted'}
          existingCount={periodEvals.length}
          copyFrom={copyFromEval}
          onClose={() => setShowNewEvalModal(false)}
          onCreated={(newId) => {
            setSelectedEvalId(newId);
            setShowNewEvalModal(false);
          }}
        />
      )}

      {/* Modal: Explicación paso a paso del cálculo del promedio de un estudiante */}
      {explainStudent && activePeriod && (
        <CalculationBreakdownModal
          student={explainStudent}
          groupName={`${group.name} «${group.parallel}»`}
          subjectName={subject.name}
          periodName={activePeriod.name}
          scheme={scheme}
          engineCats={engineCats}
          engineEvals={engineEvals}
          periodIds={yearPeriods.map((p) => p.id)}
          activePeriodId={activePeriod.id}
          grades={data.grades.filter((g) => g.student_id === explainStudent.id)}
          onClose={() => setExplainStudent(null)}
        />
      )}

      {/* Modal: Historial de modificaciones de una celda */}
      {historyGradeId && (
        <GradeHistoryModal gradeId={historyGradeId} onClose={() => setHistoryGradeId(null)} />
      )}
    </div>
  );
}

// =============================================================================
// Subcomponente: Tabla de calificaciones para computadora (con navegación por teclado y pegado de rangos)
// =============================================================================
function DesktopGradeTable({
  enrolled,
  periodEvals,
  schemeCategories,
  scheme,
  activePeriodId,
  engineCats,
  engineEvals,
  gradeByCell,
  onSaveCell,
  onCopyEval,
  onDeleteEval,
  onExplainStudent,
  onShowHistory,
}: {
  enrolled: { student: Student; enrollment: { list_number: number | null } }[];
  periodEvals: Evaluation[];
  schemeCategories: { key: string; name: string; weight: string | null }[];
  scheme: { config: import('../domain/types').GradingConfig };
  activePeriodId: string;
  engineCats: EngineCategory[];
  engineEvals: EngineEvaluation[];
  gradeByCell: Map<string, Grade>;
  onSaveCell: (evalId: string, studentId: string, raw: string) => Promise<{ ok: boolean; error?: string }>;
  onCopyEval: (ev: Evaluation) => void;
  onDeleteEval: (ev: Evaluation) => void;
  onExplainStudent: (stu: Student) => void;
  onShowHistory: (gradeId: string) => void;
}) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  const focusCoords = (rowIdx: number, colIdx: number) => {
    const key = `${rowIdx}:${colIdx}`;
    const el = inputRefs.current.get(key);
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handlePasteRange = async (
    e: React.ClipboardEvent<HTMLInputElement>,
    startRow: number,
    startCol: number,
  ) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return; // Pegado simple de 1 celda usa el flujo normal
    e.preventDefault();

    const rows = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((r) => r.length > 0)
      .map((r) => r.split('\t'));

    for (let r = 0; r < rows.length; r++) {
      const targetStu = enrolled[startRow + r]?.student;
      if (!targetStu) break;
      for (let c = 0; c < rows[r].length; c++) {
        const targetEval = periodEvals[startCol + c];
        if (!targetEval) break;
        const val = rows[r][c].trim();
        const cellKey = `${targetEval.id}:${targetStu.id}`;
        const res = await onSaveCell(targetEval.id, targetStu.id, val);
        if (!res.ok && res.error) {
          setCellErrors((prev) => ({ ...prev, [cellKey]: res.error! }));
        } else {
          setCellErrors((prev) => {
            const copy = { ...prev };
            delete copy[cellKey];
            return copy;
          });
        }
      }
    }
  };

  const isQual = scheme.config.mode === 'qualitative';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3">N.°</th>
            <th className="sticky left-10 z-10 min-w-56 bg-slate-50 px-3 py-3">
              Estudiante
            </th>
            {periodEvals.map((ev) => {
              const cat = schemeCategories.find((c) => c.key === ev.category_key);
              return (
                <th key={ev.id} className="min-w-36 border-l border-slate-200 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <span className="block font-bold text-slate-900 normal-case">{ev.name}</span>
                      <span className="block text-[11px] font-medium text-teal-800 normal-case">
                        {cat?.name ?? ''}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onCopyEval(ev)}
                        title="Copiar estructura de esta evaluación"
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEval(ev)}
                        title="Archivar evaluación"
                        className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </th>
              );
            })}
            {!isQual &&
              engineCats.map((cat) => (
                <th
                  key={cat.key}
                  className="min-w-28 border-l border-slate-200 bg-slate-100/70 px-3 py-3 text-center"
                >
                  <span className="block text-slate-800">{cat.name}</span>
                  {cat.weight && <span className="text-[11px] text-teal-800">{cat.weight} %</span>}
                </th>
              ))}
            <th className="min-w-32 border-l border-slate-200 bg-teal-50/70 px-3 py-3 text-center text-teal-950">
              {isQual ? 'Último logro' : 'Nota Período'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {enrolled.map(({ student, enrollment }, rIdx) => {
            const stuGrades = new Map<string, EngineGrade>();
            periodEvals.forEach((ev) => {
              const g = gradeByCell.get(`${ev.id}:${student.id}`);
              if (g) stuGrades.set(ev.id, { status: g.status, value: g.value, qualitative: g.qualitative });
            });

            const periodRes = !isQual
              ? computePeriod(scheme.config, engineCats, activePeriodId, engineEvals, stuGrades)
              : null;
            const qualRes = isQual ? summarizeQualitative(engineEvals, stuGrades) : null;

            return (
              <tr key={student.id} className="hover:bg-slate-50/80">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-slate-500">
                  {enrollment.list_number ?? rIdx + 1}
                </td>
                <td className="sticky left-10 z-10 bg-white px-3 py-2 font-semibold text-slate-900">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {student.last_names} {student.first_names}
                    </span>
                    {!isQual && (
                      <button
                        type="button"
                        onClick={() => onExplainStudent(student)}
                        title="Ver cálculo paso a paso"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-teal-50 hover:text-teal-800"
                      >
                        <Calculator className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>

                {periodEvals.map((ev, cIdx) => {
                  const cellKey = `${ev.id}:${student.id}`;
                  const existing = gradeByCell.get(cellKey);
                  const currentText =
                    draftValues[cellKey] !== undefined
                      ? draftValues[cellKey]
                      : gradeEditText(existing);
                  const err = cellErrors[cellKey];

                  return (
                    <td key={ev.id} className="border-l border-slate-200 px-2 py-1.5 align-top">
                      <div className="flex items-center gap-1">
                        <input
                          ref={(el) => {
                            const k = `${rIdx}:${cIdx}`;
                            if (el) inputRefs.current.set(k, el);
                            else inputRefs.current.delete(k);
                          }}
                          type="text"
                          data-testid={`cell-${ev.id}-${student.id}`}
                          aria-label={`Nota de ${student.last_names} ${student.first_names} en ${ev.name}`}
                          value={currentText}
                          placeholder="—"
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraftValues((prev) => ({ ...prev, [cellKey]: val }));
                          }}
                          onBlur={async () => {
                            if (draftValues[cellKey] === undefined) return;
                            const val = draftValues[cellKey];
                            const res = await onSaveCell(ev.id, student.id, val);
                            if (!res.ok && res.error) {
                              setCellErrors((prev) => ({ ...prev, [cellKey]: res.error! }));
                            } else {
                              setCellErrors((prev) => {
                                const copy = { ...prev };
                                delete copy[cellKey];
                                return copy;
                              });
                              setDraftValues((prev) => {
                                const copy = { ...prev };
                                delete copy[cellKey];
                                return copy;
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              focusCoords(rIdx + 1, cIdx);
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              focusCoords(rIdx - 1, cIdx);
                            } else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length) {
                              focusCoords(rIdx, cIdx + 1);
                            } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
                              focusCoords(rIdx, cIdx - 1);
                            }
                          }}
                          onPaste={(e) => handlePasteRange(e, rIdx, cIdx)}
                          className={`min-h-10 w-full rounded-lg border px-2.5 py-1 text-center font-bold focus:outline-none ${
                            err
                              ? 'border-red-500 bg-red-50 text-red-900'
                              : existing?.status === 'absent'
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : existing?.status === 'pending'
                                  ? 'border-sky-300 bg-sky-50 text-sky-900'
                                  : 'border-slate-300 bg-white text-slate-900 focus:border-teal-700'
                          }`}
                        />
                        {existing && (
                          <button
                            type="button"
                            onClick={() => onShowHistory(existing.id)}
                            title="Ver historial de cambios de esta nota"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {err && <p className="mt-1 text-[11px] font-semibold text-red-700">{err}</p>}
                    </td>
                  );
                })}

                {!isQual &&
                  periodRes?.categories.map((cat) => (
                    <td
                      key={cat.key}
                      className="border-l border-slate-200 bg-slate-50/70 px-3 py-2 text-center font-semibold text-slate-800"
                    >
                      {cat.average !== null ? formatDecimal(cat.average, 2) : '—'}
                    </td>
                  ))}

                <td
                  data-testid={`period-avg-${student.id}`}
                  className="border-l border-slate-200 bg-teal-50/40 px-3 py-2 text-center font-bold text-teal-950"
                >
                  {isQual
                    ? (qualRes?.latest ?? '—')
                    : periodRes?.average !== null && periodRes?.average !== undefined
                      ? formatDecimal(periodRes.average, 2)
                      : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Modal: Crear o copiar evaluación (Sección 9)
// =============================================================================
function NewEvaluationModal({
  assignmentId,
  periodId,
  categories,
  withinCategoryWeighted,
  existingCount,
  copyFrom,
  onClose,
  onCreated,
}: {
  assignmentId: string;
  periodId: string;
  categories: { key: string; name: string }[];
  withinCategoryWeighted: boolean;
  existingCount: number;
  copyFrom: Evaluation | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { db } = useApp();
  const [name, setName] = useState(copyFrom ? `${copyFrom.name} (copia)` : '');
  const [categoryKey, setCategoryKey] = useState(copyFrom?.category_key ?? categories[0]?.key ?? '');
  const [date, setDate] = useState(copyFrom?.date ?? new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState(copyFrom?.weight ?? '1');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ev = await save(db, 'evaluations', {
      assignment_id: assignmentId,
      period_id: periodId,
      category_key: categoryKey || null,
      name: name.trim(),
      date: date || null,
      weight: withinCategoryWeighted ? weight : null,
      kind: 'regular',
      sort_order: existingCount + 1,
    });
    onCreated(ev.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-eval-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="new-eval-title" className="text-xl font-bold text-slate-900">
          {copyFrom ? 'Copiar estructura de evaluación' : 'Nueva evaluación'}
        </h2>
        {copyFrom && (
          <p className="mt-1 text-xs text-slate-600">
            Se copiará la categoría y configuración, sin copiar las calificaciones de los estudiantes.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800">
              Nombre de la actividad o evaluación
            </label>
            <input
              type="text"
              required
              data-testid="input-eval-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Tarea 1, Lección, Proyecto…"
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800">
              Categoría de evaluación
            </label>
            <select
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800">Fecha (opcional)</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
            />
          </div>

          {withinCategoryWeighted && (
            <div>
              <label className="block text-sm font-semibold text-slate-800">Ponderación</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              data-testid="submit-eval-btn"
              className="min-h-11 rounded-xl bg-teal-700 px-5 py-2 text-sm font-bold text-white hover:bg-teal-800"
            >
              Guardar evaluación
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// Modal: Explicación verificable paso a paso del cálculo del estudiante
// =============================================================================
function CalculationBreakdownModal({
  student,
  groupName,
  subjectName,
  periodName,
  scheme,
  engineCats,
  engineEvals,
  periodIds,
  activePeriodId,
  grades,
  onClose,
}: {
  student: Student;
  groupName: string;
  subjectName: string;
  periodName: string;
  scheme: { name: string; config: import('../domain/types').GradingConfig };
  engineCats: EngineCategory[];
  engineEvals: EngineEvaluation[];
  periodIds: string[];
  activePeriodId: string;
  grades: Grade[];
  onClose: () => void;
}) {
  const gradeMap = new Map<string, EngineGrade>();
  for (const g of grades) {
    if (g.deleted_at === null) {
      gradeMap.set(g.evaluation_id, { status: g.status, value: g.value, qualitative: g.qualitative });
    }
  }

  const pRes = computePeriod(scheme.config, engineCats, activePeriodId, engineEvals, gradeMap);
  const aRes = computeAnnual(scheme.config, engineCats, periodIds, engineEvals, gradeMap);
  const eq = equivalenceFor(scheme.config, pRes.average);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold text-slate-900">
          Verificación de cálculo: {student.last_names} {student.first_names}
        </h2>
        <p className="text-sm text-slate-600">
          {groupName} · {subjectName} · {periodName}
        </p>

        <div className="mt-4 rounded-xl bg-teal-50 p-4">
          <p className="text-xs font-bold uppercase text-teal-800">Resultado de {periodName}</p>
          <p className="mt-1 text-3xl font-bold text-teal-950">
            {pRes.average !== null ? formatDecimal(pRes.average, 2) : 'Sin calificaciones'}
          </p>
          {eq && (
            <p className="mt-1 text-sm font-semibold text-teal-900">
              {eq.code} — {eq.label}
            </p>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-bold text-slate-800">Detalle paso a paso ({scheme.name}):</h3>
          <ul className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-800">
            {pRes.steps.map((step, i) => (
              <li key={i} className="leading-relaxed">
                • {step}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-3.5 text-sm">
          <p className="font-bold text-slate-800">
            Resumen anual acumulado: {aRes.final !== null ? formatDecimal(aRes.final, 2) : '—'} (
            {ANNUAL_STATUS_LABELS[aRes.status]})
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-teal-700 px-5 py-2 text-sm font-bold text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Modal: Historial de modificaciones de una calificación
// =============================================================================
function GradeHistoryModal({ gradeId, onClose }: { gradeId: string; onClose: () => void }) {
  const { db } = useApp();
  const history = useLiveQuery(async () => {
    const local = await db.local_revisions.where('record_id').equals(gradeId).toArray();
    const remote = await db.grade_revisions.where('grade_id').equals(gradeId).toArray();
    return { local: local.reverse(), remote: remote.reverse() };
  }, [gradeId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Historial de cambios de esta nota</h2>
        <div className="mt-4 space-y-2.5 text-sm">
          {history?.local.map((rev) => {
            const afterVal =
              (rev.after.value as string) ??
              (rev.after.qualitative as string) ??
              (rev.after.status as string);
            const beforeVal = rev.before
              ? ((rev.before.value as string) ??
                (rev.before.qualitative as string) ??
                (rev.before.status as string))
              : 'Sin registrar';
            return (
              <div key={rev.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">
                  {formatDecimal(beforeVal) || beforeVal} → {formatDecimal(afterVal) || afterVal}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(rev.at).toLocaleString('es-EC')} ·{' '}
                  {(rev.after.updated_by_device as string) || 'Este dispositivo'}
                </p>
              </div>
            );
          })}
          {history && history.local.length === 0 && history.remote.length === 0 && (
            <p className="text-slate-600">No hay modificaciones adicionales registradas.</p>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

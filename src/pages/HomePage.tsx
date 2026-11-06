/**
 * Pantalla de Inicio (Sección 6 de la especificación):
 * - Saludo sencillo.
 * - Año lectivo activo.
 * - Cursos y asignaturas (cada tarjeta muestra nombre, paralelo y asignatura).
 * - Último curso utilizado.
 * - Botón principal «Registrar notas».
 * - Avisos importantes únicamente cuando corresponda (modo demostración, conflictos, reglas en borrador).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  ClipboardEdit,
  PlusCircle,
  Sparkles,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isLive } from '../db/repo';
import { SetupWizardModal } from '../components/SetupWizardModal';

export function HomePage() {
  const { db, conflictsCount } = useApp();
  const navigate = useNavigate();
  const [showWizard, setShowWizard] = useState(false);

  const data = useLiveQuery(async () => {
    const institutions = (await db.institutions.toArray()).filter(isLive);
    const years = (await db.academic_years.toArray()).filter(isLive);
    const activeYear = years.find((y) => y.is_active) ?? years[0] ?? null;
    const groups = (await db.class_groups.toArray()).filter(isLive);
    const subjects = (await db.subjects.toArray()).filter(isLive);
    const assignments = (await db.teaching_assignments.toArray()).filter(isLive);
    const enrollments = (await db.enrollments.toArray()).filter(isLive);
    const schemes = (await db.grading_schemes.toArray()).filter(isLive);
    const profile = (await db.profiles.toArray()).filter(isLive)[0] ?? null;
    const lastAssignmentId = await db.getMeta<string>('last_assignment_id');
    const isDemo = await db.getMeta<boolean>('is_demo_mode');

    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const subjectMap = new Map(subjects.map((s) => [s.id, s]));
    const schemeMap = new Map(schemes.map((s) => [s.id, s]));

    const cards = assignments
      .filter((a) => !activeYear || a.academic_year_id === activeYear.id)
      .map((a) => {
        const group = groupMap.get(a.class_group_id);
        const subject = subjectMap.get(a.subject_id);
        const scheme = schemeMap.get(a.grading_scheme_id);
        const studentCount = enrollments.filter(
          (e) => e.class_group_id === a.class_group_id && e.status === 'active',
        ).length;
        return {
          assignment: a,
          group,
          subject,
          scheme,
          studentCount,
        };
      })
      .filter((c) => c.group && c.subject);

    const lastUsed =
      cards.find((c) => c.assignment.id === lastAssignmentId) ?? cards[0] ?? null;

    return {
      institution: institutions[0] ?? null,
      activeYear,
      profile,
      cards,
      lastUsed,
      isDemo: Boolean(isDemo),
      hasDraftScheme: schemes.some((s) => s.status === 'draft'),
    };
  }, [], null);

  if (!data) {
    return <div className="py-12 text-center text-slate-600">Cargando sus cursos…</div>;
  }

  const openCourse = async (assignmentId: string) => {
    await db.setMeta('last_assignment_id', assignmentId);
    navigate(`/libreta?curso=${encodeURIComponent(assignmentId)}`);
  };

  return (
    <div className="space-y-6">
      {/* Saludo sencillo, año lectivo activo y botón principal «Registrar notas» */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-teal-800">
              {data.institution?.name ?? 'Mi institución educativa'} · Año lectivo{' '}
              <span className="underline decoration-teal-400 underline-offset-4">
                {data.activeYear?.name ?? 'Sin configurar'}
              </span>
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
              Bienvenida{data.profile?.display_name ? `, ${data.profile.display_name}` : ''}
            </h1>
            <p className="mt-1 text-base text-slate-600">
              Registre cada calificación una sola vez y genere los cuadros para el colegio cuando los necesite.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <button
              type="button"
              data-testid="btn-registrar-notas-principal"
              onClick={() => {
                if (data.lastUsed) {
                  openCourse(data.lastUsed.assignment.id);
                } else {
                  navigate('/libreta');
                }
              }}
              className="flex min-h-12 items-center justify-center gap-2.5 rounded-2xl bg-teal-700 px-6 py-3.5 text-base font-bold text-white shadow-sm hover:bg-teal-800"
            >
              <ClipboardEdit className="h-5 w-5" aria-hidden="true" />
              <span>Registrar notas</span>
            </button>
            {data.lastUsed && (
              <span className="text-xs text-slate-500">
                Último curso utilizado: {data.lastUsed.group!.name} «{data.lastUsed.group!.parallel}» ·{' '}
                {data.lastUsed.subject!.name}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Avisos importantes (únicamente cuando corresponda) */}
      {(data.isDemo || conflictsCount > 0 || data.hasDraftScheme) && (
        <section className="space-y-3" aria-label="Avisos importantes">
          {data.isDemo && (
            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50/70 p-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-teal-800" aria-hidden="true" />
                <div>
                  <p className="font-bold text-teal-950">
                    Está explorando el modo de demostración con estudiantes ficticios
                  </p>
                  <p className="text-sm text-teal-900">
                    Puede practicar libremente. Cuando desee ingresar sus cursos reales, use el asistente de preparación.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                className="min-h-11 shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-teal-900 shadow-2xs ring-1 ring-teal-300 hover:bg-teal-100"
              >
                Configurar mis cursos reales
              </button>
            </div>
          )}

          {data.hasDraftScheme && (
            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" aria-hidden="true" />
                <div>
                  <p className="font-bold text-amber-950">
                    Verifique la regla de promedios con su institución
                  </p>
                  <p className="text-sm text-amber-900">
                    Una regla de calificación está como borrador. Puede revisarla y confirmarla en Configuración.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/configuracion')}
                className="min-h-11 shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
              >
                Revisar regla
              </button>
            </div>
          )}
        </section>
      )}

      {/* Último curso utilizado (acceso directo destacado) */}
      {data.lastUsed && (
        <section>
          <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wider text-slate-500">
            Último curso utilizado
          </h2>
          <button
            type="button"
            onClick={() => openCourse(data.lastUsed!.assignment.id)}
            className="flex w-full items-center justify-between rounded-2xl border-2 border-teal-700/30 bg-white p-5 text-left shadow-xs transition hover:border-teal-700 hover:bg-teal-50/30"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-bold text-teal-900">
                  Paralelo «{data.lastUsed.group!.parallel}»
                </span>
                <span className="text-sm font-medium text-slate-600">
                  {data.lastUsed.studentCount} estudiantes activos
                </span>
              </div>
              <p className="mt-1.5 text-xl font-bold text-slate-900">
                {data.lastUsed.group!.name} «{data.lastUsed.group!.parallel}» — {data.lastUsed.subject!.name}
              </p>
              <p className="mt-0.5 text-sm text-slate-600">{data.lastUsed.scheme?.name}</p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white">
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </div>
          </button>
        </section>
      )}

      {/* Tarjetas de todos los cursos y asignaturas */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Mis cursos y asignaturas</h2>
          <button
            type="button"
            onClick={() => navigate('/configuracion')}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <PlusCircle className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span>Agregar curso o asignatura</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.cards.map(({ assignment, group, subject, scheme, studentCount }) => (
            <button
              key={assignment.id}
              type="button"
              data-testid={`course-card-${assignment.id}`}
              onClick={() => openCourse(assignment.id)}
              className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-xs transition hover:border-teal-700 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                    <BookOpen className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    Paralelo «{group!.parallel}»
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    {studentCount}
                  </span>
                </div>

                <h3 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-teal-800">
                  {group!.name} «{group!.parallel}»
                </h3>
                <p className="mt-0.5 text-base font-semibold text-teal-800">{subject!.name}</p>
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">{scheme?.name}</p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-teal-700">
                <span>Abrir libreta</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {showWizard && <SetupWizardModal onClose={() => setShowWizard(false)} />}
    </div>
  );
}

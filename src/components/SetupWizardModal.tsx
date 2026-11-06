/**
 * Asistente de preparación inicial en 3 pasos sencillos:
 * Paso 1: Año lectivo, nombre de la institución y régimen académico.
 * Paso 2: Curso, paralelo, nivel y asignatura.
 * Paso 3: Ingresar o pegar listado inicial de estudiantes.
 *
 * También permite cargar en 1 clic los datos de demostración para practicar.
 */
import React, { useState } from 'react';
import { CheckCircle2, Sparkles, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { save } from '../db/repo';
import { seedDemoData } from '../db/seedDemo';
import { suggestedPresetForLevel } from '../domain/presets';
import { LEVEL_LABELS, type Level } from '../domain/types';
import { splitFullName } from '../import/studentImport';

export function SetupWizardModal({ onClose }: { onClose: () => void }) {
  const { db } = useApp();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);

  // Paso 1
  const [institutionName, setInstitutionName] = useState('Unidad Educativa');
  const [yearName, setYearName] = useState('2026 - 2027');
  const [regime, setRegime] = useState<'sierra_amazonia' | 'costa_galapagos' | 'otro'>('sierra_amazonia');

  // Paso 2
  const [groupName, setGroupName] = useState('8.º de Básica');
  const [parallel, setParallel] = useState('A');
  const [level, setLevel] = useState<Level>('egb_superior');
  const [subjectName, setSubjectName] = useState('Matemática');

  // Paso 3
  const [studentLines, setStudentLines] = useState(
    'Alcívar Mendoza Camila Sofía\nBenítez Zambrano Mateo Sebastián\nCedeño Vera Valentina Isabel',
  );

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const inst = await save(db, 'institutions', { name: institutionName.trim() || 'Institución Educativa' });
      const year = await save(db, 'academic_years', {
        institution_id: inst.id,
        name: yearName.trim() || '2026 - 2027',
        regime,
        is_active: true,
      });

      const periods = ['Primer Trimestre', 'Segundo Trimestre', 'Tercer Trimestre'];
      for (let i = 0; i < periods.length; i++) {
        await save(db, 'academic_periods', {
          academic_year_id: year.id,
          name: periods[i],
          kind: 'trimestre',
          sort_order: i + 1,
          closed_at: null,
          locked_scheme_id: null,
        });
      }

      const preset = suggestedPresetForLevel(level);
      const schemeFamilyId = crypto.randomUUID();
      const scheme = await save(db, 'grading_schemes', {
        family_id: schemeFamilyId,
        scheme_version: 1,
        name: preset.name,
        status: 'draft',
        confirmed_at: null,
        source_note: preset.sourceNote,
        config: preset.config,
      });

      for (let i = 0; i < preset.categories.length; i++) {
        const c = preset.categories[i];
        await save(db, 'evaluation_categories', {
          scheme_id: scheme.id,
          key: c.key,
          name: c.name,
          kind: c.kind,
          weight: c.weight,
          sort_order: i + 1,
        });
      }

      const group = await save(db, 'class_groups', {
        academic_year_id: year.id,
        name: groupName.trim() || 'Curso',
        parallel: parallel.trim() || 'A',
        level,
      });

      const subject = await save(db, 'subjects', {
        name: subjectName.trim() || 'Asignatura',
      });

      const assignment = await save(db, 'teaching_assignments', {
        academic_year_id: year.id,
        class_group_id: group.id,
        subject_id: subject.id,
        grading_scheme_id: scheme.id,
      });

      const lines = studentLines
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const { lastNames, firstNames } = splitFullName(lines[i]);
        const stu = await save(db, 'students', {
          last_names: lastNames || `Estudiante ${i + 1}`,
          first_names: firstNames || 'Nombre',
          internal_code: null,
          archived_at: null,
        });
        await save(db, 'enrollments', {
          student_id: stu.id,
          class_group_id: group.id,
          academic_year_id: year.id,
          list_number: i + 1,
          status: 'active',
          status_changed_on: null,
        });
      }

      await db.setMeta('setup_completed', true);
      await db.setMeta('is_demo_mode', false);
      await db.setMeta('last_assignment_id', assignment.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDemo = async () => {
    setSaving(true);
    try {
      await seedDemoData(db);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
              Paso {step} de 3
            </span>
            <h2 id="wizard-title" className="text-xl font-bold text-slate-900">
              Preparar Mi Libreta
            </h2>
          </div>
          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={saving}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>Usar datos de demostración</span>
          </button>
        </div>

        <form onSubmit={handleFinish} className="mt-5 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Nombre de la institución educativa
                </label>
                <input
                  type="text"
                  required
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800">Año lectivo</label>
                  <input
                    type="text"
                    required
                    value={yearName}
                    onChange={(e) => setYearName(e.target.value)}
                    placeholder="Ej. 2026 - 2027"
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800">Régimen escolar</label>
                  <select
                    value={regime}
                    onChange={(e) => setRegime(e.target.value as typeof regime)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                  >
                    <option value="sierra_amazonia">Sierra - Amazonía</option>
                    <option value="costa_galapagos">Costa - Galápagos</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-between pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-11 rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Siguiente: Curso y asignatura
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-slate-800">Nombre del curso</label>
                  <input
                    type="text"
                    required
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Ej. 8.º de Básica"
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800">Paralelo</label>
                  <input
                    type="text"
                    required
                    value={parallel}
                    onChange={(e) => setParallel(e.target.value)}
                    placeholder="Ej. A"
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800">Subnivel educativo</label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as Level)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                >
                  {Object.entries(LEVEL_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800">Asignatura</label>
                <input
                  type="text"
                  required
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder="Ej. Matemática"
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-base focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-between pt-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="min-h-11 rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Siguiente: Estudiantes
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Users className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Lista de estudiantes (uno por línea: Apellidos y Nombres)</span>
                </label>
                <p className="mt-0.5 text-xs text-slate-600">
                  Puede pegarlos directamente desde su lista de Excel o agregarlos más tarde desde Configuración.
                </p>
                <textarea
                  rows={6}
                  value={studentLines}
                  onChange={(e) => setStudentLines(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-teal-700 focus:outline-none"
                  placeholder="Alcívar Mendoza Camila Sofía&#10;Benítez Zambrano Mateo Sebastián"
                />
              </div>

              <div className="flex justify-between pt-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>{saving ? 'Guardando…' : 'Terminar y abrir Mi Libreta'}</span>
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

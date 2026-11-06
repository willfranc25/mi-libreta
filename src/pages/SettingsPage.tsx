/**
 * Pantalla de Configuración:
 * 1. Estudiantes (crear, editar, importar desde CSV/XLSX con detección de duplicados,
 *    gestionar retiros y traslados sin borrar su historial).
 * 2. Cursos, asignaturas y períodos académicos (con opción de cerrar un período bloqueando su versión de regla).
 * 3. Reglas académicas configurables (ponderaciones, truncamiento/redondeo, versión y confirmación institucional).
 * 4. Cuenta, sincronización entre celular y computadora, respaldos seguros (cifrado AES-256 o JSON verificado) y privacidad (LOPDP Ecuador).
 */
import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Cloud,
  Download,
  Lock,
  Plus,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { createEncryptedBackup, createPlainBackup, restoreBackup } from '../backup/backup';
import { useApp } from '../context/AppContext';
import { DATA_TABLES } from '../db/db';
import { isLive, save } from '../db/repo';
import { seedDemoData } from '../db/seedDemo';
import { validateGradingConfig } from '../domain/engine';
import { SCHEME_PRESETS } from '../domain/presets';
import {
  ENROLLMENT_STATUS_LABELS,
  LEVEL_LABELS,
  type EnrollmentStatus,
  type Level,
} from '../domain/types';
import {
  parseCsvStudentRows,
  parseXlsxStudentRows,
  type ImportedStudentCandidate,
} from '../import/studentImport';
import { getSupabaseClient } from '../sync/supabaseRemote';

type SettingsSection = 'students' | 'courses' | 'rules' | 'backup';

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function SettingsPage() {
  const {
    db,
    deviceLabel,
    setDeviceLabel,
    userEmail,
    isCloudConfigured,
    pendingCount,
    lastSyncAt,
    triggerSync,
    signOut,
  } = useApp();

  const [section, setSection] = useState<SettingsSection>('students');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Formulario nuevo estudiante
  const [newLastNames, setNewLastNames] = useState('');
  const [newFirstNames, setNewFirstNames] = useState('');
  const [newCode, setNewCode] = useState('');

  // Importación desde CSV / XLSX
  const [importCandidates, setImportCandidates] = useState<ImportedStudentCandidate[] | null>(null);

  // Formulario nuevo curso / asignatura
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupParallel, setNewGroupParallel] = useState('A');
  const [newGroupLevel, setNewGroupLevel] = useState<Level>('egb_superior');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [assignGroupId, setAssignGroupId] = useState('');
  const [assignSchemeId, setAssignSchemeId] = useState('');

  // Respaldos y autenticación
  const [backupPassword, setBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [screenPin, setScreenPin] = useState(
    () => localStorage.getItem('milibreta_screen_pin') ?? '',
  );

  const data = useLiveQuery(async () => {
    const institutions = (await db.institutions.toArray()).filter(isLive);
    const years = (await db.academic_years.toArray()).filter(isLive);
    const activeYear = years.find((y) => y.is_active) ?? years[0] ?? null;
    const periods = (await db.academic_periods.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const groups = (await db.class_groups.toArray()).filter(isLive);
    const subjects = (await db.subjects.toArray()).filter(isLive);
    const assignments = (await db.teaching_assignments.toArray()).filter(isLive);
    const schemes = (await db.grading_schemes.toArray()).filter(isLive);
    const categories = (await db.evaluation_categories.toArray())
      .filter(isLive)
      .sort((a, b) => a.sort_order - b.sort_order);
    const students = (await db.students.toArray()).filter(isLive);
    const enrollments = (await db.enrollments.toArray()).filter(isLive);
    const lastBackupAt = await db.getMeta<string>('last_backup_at');

    return {
      institution: institutions[0] ?? null,
      activeYear,
      periods,
      groups,
      subjects,
      assignments,
      schemes,
      categories,
      students,
      enrollments,
      lastBackupAt: lastBackupAt ?? null,
    };
  }, [], null);

  if (!data) {
    return <div className="py-12 text-center text-slate-600">Cargando configuración…</div>;
  }

  const currentGroupId = selectedGroupId || data.groups[0]?.id || '';
  const groupEnrollments = data.enrollments
    .filter((e) => e.class_group_id === currentGroupId)
    .sort((a, b) => (a.list_number ?? 999) - (b.list_number ?? 999));

  const stuMap = new Map(data.students.map((s) => [s.id, s]));

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLastNames.trim() || !newFirstNames.trim() || !currentGroupId || !data.activeYear) return;
    setErrorMsg(null);
    const stu = await save(db, 'students', {
      last_names: newLastNames.trim(),
      first_names: newFirstNames.trim(),
      internal_code: newCode.trim() || null,
      archived_at: null,
    });
    await save(db, 'enrollments', {
      student_id: stu.id,
      class_group_id: currentGroupId,
      academic_year_id: data.activeYear.id,
      list_number: groupEnrollments.length + 1,
      status: 'active',
      status_changed_on: null,
    });
    setNewLastNames('');
    setNewFirstNames('');
    setNewCode('');
    setNotice(`Se agregó a ${stu.last_names} ${stu.first_names}.`);
  };

  const handleImportFile = async (file: File) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        setImportCandidates(parseCsvStudentRows(text, data.students));
      } else {
        const buf = await file.arrayBuffer();
        setImportCandidates(await parseXlsxStudentRows(buf, data.students));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo leer el archivo seleccionado.');
    }
  };

  const handleConfirmImport = async () => {
    if (!importCandidates || !currentGroupId || !data.activeYear) return;
    const chosen = importCandidates.filter(
      (c) => c.selected && c.lastNames.trim() && c.firstNames.trim(),
    );
    let nextNumber = groupEnrollments.length + 1;
    for (const c of chosen) {
      const stu = await save(db, 'students', {
        last_names: c.lastNames.trim(),
        first_names: c.firstNames.trim(),
        internal_code: c.internalCode,
        archived_at: null,
      });
      await save(db, 'enrollments', {
        student_id: stu.id,
        class_group_id: currentGroupId,
        academic_year_id: data.activeYear.id,
        list_number: c.listNumber ?? nextNumber++,
        status: 'active',
        status_changed_on: null,
      });
    }
    setImportCandidates(null);
    setNotice(`Se importaron ${chosen.length} estudiante(s) al curso.`);
  };

  const handleCreateCourseAndSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.activeYear) return;
    let targetGroupId = assignGroupId;
    if (!targetGroupId && newGroupName.trim()) {
      const g = await save(db, 'class_groups', {
        academic_year_id: data.activeYear.id,
        name: newGroupName.trim(),
        parallel: newGroupParallel.trim() || 'A',
        level: newGroupLevel,
      });
      targetGroupId = g.id;
    }
    if (!targetGroupId || !newSubjectName.trim()) return;
    const subj = await save(db, 'subjects', { name: newSubjectName.trim() });
    const schemeId = assignSchemeId || data.schemes[0]?.id;
    if (!schemeId) return;

    await save(db, 'teaching_assignments', {
      academic_year_id: data.activeYear.id,
      class_group_id: targetGroupId,
      subject_id: subj.id,
      grading_scheme_id: schemeId,
    });
    setNewGroupName('');
    setNewSubjectName('');
    setNotice('Curso y asignatura registrados correctamente.');
  };

  const handleExportBackup = async () => {
    setErrorMsg(null);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      if (backupPassword.trim()) {
        const enc = await createEncryptedBackup(db, backupPassword.trim());
        downloadTextFile(
          JSON.stringify(enc, null, 2),
          `Respaldo_Protegido_MiLibreta_${dateStr}.json`,
        );
        setNotice('Se descargó el respaldo protegido con contraseña (cifrado AES-256).');
      } else {
        const plain = await createPlainBackup(db);
        downloadTextFile(
          JSON.stringify(plain, null, 2),
          `Respaldo_MiLibreta_${dateStr}.json`,
        );
        setNotice('Se descargó el respaldo completo con firma de integridad SHA-256.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al generar respaldo');
    }
  };

  const handleRestoreFile = async (file: File) => {
    setErrorMsg(null);
    setNotice(null);
    if (pendingCount > 0) {
      const proceed = window.confirm(
        `Atención: Hay ${pendingCount} cambio(s) pendientes de sincronizar en este dispositivo. ¿Está segura de restaurar este respaldo y reemplazar los datos actuales?`,
      );
      if (!proceed) return;
    }
    try {
      const raw = await file.text();
      const counts = await restoreBackup(db, raw, restorePassword.trim() || undefined);
      setNotice(
        `Respaldo restaurado con éxito: ${counts.groups} cursos, ${counts.students} estudiantes y ${counts.grades} calificaciones recuperadas.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo restaurar el respaldo.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Navegación interna de Configuración */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        {(
          [
            ['students', 'Estudiantes y Matrículas', <Users className="h-4 w-4" />],
            ['courses', 'Cursos, Asignaturas y Períodos', <Plus className="h-4 w-4" />],
            ['rules', 'Reglas de Calificación', <Sliders className="h-4 w-4" />],
            ['backup', 'Respaldos, Cuenta y Privacidad', <ShieldCheck className="h-4 w-4" />],
          ] as [SettingsSection, string, React.ReactNode][]
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            data-testid={`settings-tab-${key}`}
            onClick={() => {
              setSection(key);
              setNotice(null);
              setErrorMsg(null);
            }}
            className={`flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              section === key
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div
          role="status"
          data-testid="settings-notice"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-950"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
          <span>{notice}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          data-testid="settings-error"
          className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-bold text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {/* =====================================================================
          SECCIÓN 1: GESTIÓN DE ESTUDIANTES E IMPORTACIÓN (Sección 8)
         ===================================================================== */}
      {section === 'students' && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Nómina de estudiantes por curso</h2>
                <p className="text-sm text-slate-600">
                  Los traslados o retiros conservan intactas sus calificaciones históricas.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Curso para gestionar estudiantes"
                  value={currentGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold"
                >
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} «{g.parallel}»
                    </option>
                  ))}
                </select>

                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span>Importar desde Excel / CSV</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    data-testid="input-import-students-file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImportFile(f);
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Asistente de revisión y corrección de importación */}
            {importCandidates && (
              <div className="mt-4 rounded-2xl border-2 border-teal-700 bg-teal-50/40 p-4">
                <h3 className="font-bold text-slate-900">
                  Revisión antes de importar ({importCandidates.length} filas leídas)
                </h3>
                <p className="text-xs text-slate-600">
                  Puede corregir apellidos o nombres directamente aquí. Los posibles duplicados vienen
                  desmarcados para evitar registros repetidos.
                </p>

                <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 font-bold">
                      <tr>
                        <th className="p-2">Importar</th>
                        <th className="p-2">N.°</th>
                        <th className="p-2">Apellidos</th>
                        <th className="p-2">Nombres</th>
                        <th className="p-2">Observaciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {importCandidates.map((cand, idx) => (
                        <tr key={idx}>
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={cand.selected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setImportCandidates((prev) =>
                                  prev!.map((item, i) =>
                                    i === idx ? { ...item, selected: checked } : item,
                                  ),
                                );
                              }}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="p-2">{cand.listNumber ?? idx + 1}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={cand.lastNames}
                              onChange={(e) => {
                                const val = e.target.value;
                                setImportCandidates((prev) =>
                                  prev!.map((item, i) =>
                                    i === idx ? { ...item, lastNames: val } : item,
                                  ),
                                );
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={cand.firstNames}
                              onChange={(e) => {
                                const val = e.target.value;
                                setImportCandidates((prev) =>
                                  prev!.map((item, i) =>
                                    i === idx ? { ...item, firstNames: val } : item,
                                  ),
                                );
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="p-2 text-amber-800">
                            {cand.issues.length > 0 ? cand.issues.join(' · ') : 'Listo'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setImportCandidates(null)}
                    className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-testid="btn-confirm-import-students"
                    onClick={handleConfirmImport}
                    className="min-h-10 rounded-xl bg-teal-700 px-4 py-1.5 text-xs font-bold text-white"
                  >
                    Confirmar importación
                  </button>
                </div>
              </div>
            )}

            {/* Formulario rápido para agregar un estudiante */}
            <form
              onSubmit={handleAddStudent}
              className="mt-4 grid grid-cols-1 gap-2.5 border-t border-slate-100 pt-4 sm:grid-cols-4"
            >
              <input
                type="text"
                required
                data-testid="input-new-student-lastnames"
                value={newLastNames}
                onChange={(e) => setNewLastNames(e.target.value)}
                placeholder="Apellidos (ej. Zambrano Vera)"
                className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
              <input
                type="text"
                required
                data-testid="input-new-student-firstnames"
                value={newFirstNames}
                onChange={(e) => setNewFirstNames(e.target.value)}
                placeholder="Nombres (ej. Ana Belén)"
                className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="Código interno (opcional)"
                className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
              <button
                type="submit"
                data-testid="btn-add-student"
                className="min-h-11 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
              >
                + Agregar estudiante
              </button>
            </form>

            {/* Tabla de estudiantes matriculados */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600">
                    <th className="px-3 py-2">N.°</th>
                    <th className="px-3 py-2">Apellidos</th>
                    <th className="px-3 py-2">Nombres</th>
                    <th className="px-3 py-2">Estado en el curso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {groupEnrollments.map((enr, i) => {
                    const stu = stuMap.get(enr.student_id);
                    if (!stu) return null;
                    return (
                      <tr key={enr.id}>
                        <td className="px-3 py-2 font-semibold text-slate-500">
                          {enr.list_number ?? i + 1}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{stu.last_names}</td>
                        <td className="px-3 py-2 text-slate-800">{stu.first_names}</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Estado de matrícula de ${stu.last_names}`}
                            value={enr.status}
                            onChange={async (e) => {
                              const st = e.target.value as EnrollmentStatus;
                              await save(db, 'enrollments', {
                                id: enr.id,
                                status: st,
                                status_changed_on: new Date().toISOString().slice(0, 10),
                              });
                            }}
                            className="min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold"
                          >
                            {Object.entries(ENROLLMENT_STATUS_LABELS).map(([k, lbl]) => (
                              <option key={k} value={k}>
                                {lbl}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          SECCIÓN 2: CURSOS, ASIGNATURAS Y PERÍODOS ACADÉMICOS
         ===================================================================== */}
      {section === 'courses' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Agregar curso o asignatura</h2>
            <form onSubmit={handleCreateCourseAndSubject} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Usar curso existente o crear uno nuevo
                </label>
                <select
                  value={assignGroupId}
                  onChange={(e) => setAssignGroupId(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">+ Crear un nuevo curso…</option>
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} «{g.parallel}» ({LEVEL_LABELS[g.level]})
                    </option>
                  ))}
                </select>
              </div>

              {!assignGroupId && (
                <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700">Nombre del curso</label>
                    <input
                      type="text"
                      required
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Ej. 9.º de Básica"
                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Paralelo</label>
                    <input
                      type="text"
                      required
                      value={newGroupParallel}
                      onChange={(e) => setNewGroupParallel(e.target.value)}
                      placeholder="B"
                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-bold text-slate-700">Subnivel</label>
                    <select
                      value={newGroupLevel}
                      onChange={(e) => setNewGroupLevel(e.target.value as Level)}
                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {Object.entries(LEVEL_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700">Nombre de la asignatura</label>
                <input
                  type="text"
                  required
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="Ej. Ciencias Naturales"
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Regla de calificación</label>
                <select
                  value={assignSchemeId || data.schemes[0]?.id || ''}
                  onChange={(e) => setAssignSchemeId(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {data.schemes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (v{s.scheme_version})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="min-h-11 w-full rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-800"
              >
                Guardar curso y asignatura
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">
              Períodos académicos ({data.activeYear?.name})
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Al cerrar un trimestre, sus promedios quedan ligados a la versión actual de la regla
              para que cambios posteriores nunca modifiquen notas históricas cerradas.
            </p>
            <div className="mt-4 space-y-2.5">
              {data.periods.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="font-bold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.closed_at
                        ? `Cerrado el ${new Date(p.closed_at).toLocaleDateString('es-EC')}`
                        : 'Abierto para registro'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await save(db, 'academic_periods', {
                        id: p.id,
                        closed_at: p.closed_at ? null : new Date().toISOString(),
                        locked_scheme_id: p.closed_at ? null : (data.schemes[0]?.id ?? null),
                      });
                    }}
                    className="min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
                  >
                    {p.closed_at ? 'Reabrir período' : 'Cerrar período'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          SECCIÓN 3: MOTOR ACADÉMICO CONFIGURABLE Y VERSIONADO (Sección 12)
         ===================================================================== */}
      {section === 'rules' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Reglas académicas y ponderaciones</h2>
              <p className="text-sm text-slate-600">
                Incluye como referencia el instructivo ecuatoriano 2025 (Formativa 70 %, Sumativa 30 %,
                truncado a 2 decimales sin redondeo) y escala cualitativa para Inicial/Preparatoria.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {data.schemes.map((scheme) => {
              const cats = data.categories.filter((c) => c.scheme_id === scheme.id);
              const issues = validateGradingConfig(
                scheme.config,
                cats.map((c) => ({ key: c.key, name: c.name, kind: c.kind, weight: c.weight })),
              );

              return (
                <div key={scheme.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${
                          scheme.status === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {scheme.status === 'confirmed'
                          ? `Confirmada (Versión ${scheme.scheme_version})`
                          : `Borrador (Versión ${scheme.scheme_version})`}
                      </span>
                      <h3 className="mt-1 text-lg font-bold text-slate-900">{scheme.name}</h3>
                      <p className="text-xs text-slate-600">{scheme.source_note}</p>
                    </div>

                    <div className="flex gap-2">
                      {scheme.status !== 'confirmed' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await save(db, 'grading_schemes', {
                              id: scheme.id,
                              status: 'confirmed',
                              confirmed_at: new Date().toISOString(),
                            });
                            setNotice(`Regla «${scheme.name}» confirmada.`);
                          }}
                          className="min-h-10 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white"
                        >
                          Confirmar regla institucional
                        </button>
                      )}
                      {scheme.config.mode === 'quantitative' && (
                        <button
                          type="button"
                          onClick={async () => {
                            const nextMode =
                              scheme.config.rounding.period.mode === 'truncate'
                                ? 'round_half_up'
                                : 'truncate';
                            // Crear nueva versión sin alterar períodos cerrados con la versión anterior
                            const newScheme = await save(db, 'grading_schemes', {
                              family_id: scheme.family_id,
                              scheme_version: scheme.scheme_version + 1,
                              name: scheme.name,
                              status: 'confirmed',
                              confirmed_at: new Date().toISOString(),
                              source_note: scheme.source_note,
                              config: {
                                ...scheme.config,
                                rounding: {
                                  category: { mode: nextMode, decimals: 2 },
                                  period: { mode: nextMode, decimals: 2 },
                                  final: { mode: nextMode, decimals: 2 },
                                },
                              },
                            });
                            for (const c of cats) {
                              await save(db, 'evaluation_categories', {
                                scheme_id: newScheme.id,
                                key: c.key,
                                name: c.name,
                                kind: c.kind,
                                weight: c.weight,
                                sort_order: c.sort_order,
                              });
                            }
                            setNotice(
                              `Se guardó la versión ${newScheme.scheme_version} (${
                                nextMode === 'truncate'
                                  ? 'Truncado a 2 decimales'
                                  : 'Redondeado a 2 decimales'
                              }). Los períodos cerrados conservan su versión original.`,
                            );
                          }}
                          className="min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
                        >
                          Cambiar entre Truncamiento y Redondeo (crea v{scheme.scheme_version + 1})
                        </button>
                      )}
                    </div>
                  </div>

                  {scheme.config.mode === 'quantitative' && (
                    <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                      <div className="rounded-xl bg-white p-3">
                        <span className="font-bold text-slate-700">Escala y aprobación:</span>
                        <p className="mt-1 text-slate-600">
                          De {scheme.config.scale.min} a {scheme.config.scale.max} · Aprueba con{' '}
                          {scheme.config.passingGrade} · Supletorio desde{' '}
                          {scheme.config.supplementary.eligibleFrom}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <span className="font-bold text-slate-700">Decimales:</span>
                        <p className="mt-1 text-slate-600">
                          {scheme.config.rounding.period.mode === 'truncate'
                            ? 'Truncado estricto sin redondeo'
                            : 'Redondeo estándar'}{' '}
                          ({scheme.config.rounding.period.decimals} decimales)
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <span className="font-bold text-slate-700">Categorías:</span>
                        <p className="mt-1 text-slate-600">
                          {cats.map((c) => `${c.name} (${c.weight ?? 100} %)`).join(' + ')}
                        </p>
                      </div>
                    </div>
                  )}

                  {issues.length > 0 && (
                    <p className="mt-2 text-xs font-bold text-red-700">{issues.join(' ')}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-xs font-bold uppercase text-slate-500">
              Agregar otra plantilla de regla de referencia:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SCHEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={async () => {
                    const familyId = crypto.randomUUID();
                    const s = await save(db, 'grading_schemes', {
                      family_id: familyId,
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
                        scheme_id: s.id,
                        key: c.key,
                        name: c.name,
                        kind: c.kind,
                        weight: c.weight,
                        sort_order: i + 1,
                      });
                    }
                    setNotice(`Se agregó la regla «${preset.name}».`);
                  }}
                  className="min-h-10 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
                >
                  + {preset.name}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          SECCIÓN 4: RESPALDOS, SINCRONIZACIÓN, SEGURIDAD Y PRIVACIDAD (Secciones 16, 17 y 18)
         ===================================================================== */}
      {section === 'backup' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Exportación y restauración de respaldos verificados */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Respaldos y recuperación ante daño o robo</h2>
            <p className="mt-1 text-sm text-slate-600">
              Descargue una copia completa de sus cursos y calificaciones. Si cambia de teléfono o
              computadora, podrá restaurarla íntegramente.
            </p>
            <p className="mt-1 text-xs font-semibold text-teal-800">
              Último respaldo descargado:{' '}
              {data.lastBackupAt
                ? new Date(data.lastBackupAt).toLocaleString('es-EC')
                : 'Aún no se ha descargado un respaldo manual'}
            </p>

            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Contraseña opcional para cifrar el archivo de respaldo (AES-256)
                </label>
                <input
                  type="password"
                  data-testid="input-backup-password"
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(e.target.value)}
                  placeholder="Dejar vacío para respaldo estándar o escribir clave…"
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <button
                type="button"
                data-testid="btn-download-backup"
                onClick={handleExportBackup}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-800"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
                <span>Descargar respaldo completo ahora</span>
              </button>
            </div>

            <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-bold text-slate-900">Restaurar desde un archivo de respaldo</h3>
              <input
                type="password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                placeholder="Contraseña del respaldo (solo si fue cifrado)"
                className="min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
              />
              <label className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-200">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Seleccionar archivo de respaldo (.json) para restaurar</span>
                <input
                  type="file"
                  accept=".json"
                  data-testid="input-restore-backup-file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleRestoreFile(f);
                  }}
                />
              </label>
            </div>
          </section>

          {/* Sincronización entre dispositivos, bloqueo en equipo compartido y privacidad */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Sincronización entre celular y computadora
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Nombre de este dispositivo (aparece en el historial y al comparar cambios):
              </p>
              <input
                type="text"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                aria-label="Nombre de este dispositivo"
                className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
              />
            </div>

            {/* Cuenta en la nube (Supabase Auth) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <Cloud className="h-5 w-5 text-teal-700" />
                <span>Cuenta de sincronización en la nube</span>
              </div>

              {userEmail ? (
                <div className="mt-2 space-y-2 text-sm">
                  <p className="text-slate-700">
                    Sesión activa: <strong>{userEmail}</strong>
                  </p>
                  <p className="text-xs text-slate-500">
                    Última sincronización confirmada por el servidor:{' '}
                    {lastSyncAt ? new Date(lastSyncAt).toLocaleString('es-EC') : 'Pendiente'}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => triggerSync()}
                      className="min-h-10 rounded-xl bg-teal-700 px-4 py-1.5 text-xs font-bold text-white"
                    >
                      Sincronizar ahora
                    </button>
                    <button
                      type="button"
                      onClick={() => signOut()}
                      className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </div>
              ) : isCloudConfigured ? (
                <form
                  className="mt-3 space-y-2.5"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const sb = getSupabaseClient();
                    if (!sb) return;
                    const { error } = await sb.auth.signInWithPassword({
                      email: authEmail,
                      password: authPassword,
                    });
                    if (error) setErrorMsg(error.message);
                    else setNotice('Sesión iniciada correctamente.');
                  }}
                >
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="Correo electrónico"
                    className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Contraseña"
                    className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                  <button
                    type="submit"
                    className="min-h-10 w-full rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white"
                  >
                    Iniciar sesión para sincronizar
                  </button>
                </form>
              ) : (
                <p className="mt-2 text-xs text-slate-600">
                  Trabajando en modo local sin servidor externo configurado. Todas sus notas se
                  guardan automáticamente en este dispositivo y puede trasladarlas entre equipos
                  mediante los respaldos seguros.
                </p>
              )}
            </div>

            {/* Bloqueo de pantalla en equipos compartidos (con nota honesta sobre cifrado local) */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Lock className="h-4 w-4 text-teal-700" />
                <span>Código rápido de pantalla para computadoras compartidas</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Nota de seguridad: este código evita miradas accidentales en la sala de profesores, pero no cifra
                el almacenamiento interno del navegador. Para protección criptográfica completa use la contraseña de su
                sistema operativo y descargue respaldos cifrados con AES-256.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  value={screenPin}
                  onChange={(e) => setScreenPin(e.target.value)}
                  placeholder="PIN de 4 dígitos (opcional)"
                  className="min-h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (screenPin.trim()) {
                      localStorage.setItem('milibreta_screen_pin', screenPin.trim());
                      setNotice('Código de bloqueo rápido activado.');
                    } else {
                      localStorage.removeItem('milibreta_screen_pin');
                      setNotice('Código de bloqueo rápido desactivado.');
                    }
                  }}
                  className="min-h-10 rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-bold text-white"
                >
                  Guardar PIN
                </button>
              </div>
            </div>

            {/* Protección de datos de menores (LOPDP Ecuador) y eliminación autorizada */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              <p className="font-bold text-slate-800">
                Privacidad y Protección de Datos Personales (LOPDP Ecuador)
              </p>
              <p className="mt-1">
                Mi Libreta aplica minimización de datos: solo registra nombres, apellidos y calificaciones
                académicas, sin recopilar números de cédula, direcciones ni teléfonos de menores de edad, y
                nunca envía datos estudiantiles a servicios de inteligencia artificial.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await seedDemoData(db);
                    setNotice('Datos de demostración recargados.');
                  }}
                  className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-100"
                >
                  Restablecer datos de demostración
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const warn =
                      pendingCount > 0
                        ? `¡Atención! Hay ${pendingCount} operaciones pendientes de sincronizar. `
                        : '';
                    if (
                      window.confirm(
                        `${warn}¿Desea eliminar todos los datos almacenados localmente en este navegador? Asegúrese de haber descargado antes su respaldo.`,
                      )
                    ) {
                      for (const t of DATA_TABLES) await db.table(t).clear();
                      await db.outbox.clear();
                      await db.conflicts.clear();
                      await db.meta.clear();
                      setNotice('Se eliminaron los datos locales de este dispositivo.');
                    }
                  }}
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-red-300 bg-white px-3 py-1.5 font-bold text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Borrar datos locales de este equipo</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

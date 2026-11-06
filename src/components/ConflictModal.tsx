/**
 * Ventana de resolución de conflictos entre dispositivos.
 *
 * Nunca aplica una política ciega de «último cambio gana»: muestra claramente
 * la nota guardada en cada dispositivo y permite a la profesora elegir cuál conservar.
 */
import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, Laptop, Smartphone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { gradeDisplay } from '../domain/gradeInput';
import type { GradeStatus } from '../domain/types';
import { resolveConflict } from '../sync/engine';

export function ConflictModal({ onClose }: { onClose: () => void }) {
  const { db, triggerSync } = useApp();
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), [], []);
  const students = useLiveQuery(() => db.students.toArray(), [], []);
  const evaluations = useLiveQuery(() => db.evaluations.toArray(), [], []);

  if (conflicts.length === 0) return null;

  const studentMap = new Map(students.map((s) => [s.id, `${s.last_names} ${s.first_names}`]));
  const evalMap = new Map(evaluations.map((e) => [e.id, e.name]));

  const handleResolve = async (conflictId: string, choice: 'local' | 'server') => {
    await resolveConflict(db, conflictId, choice);
    await triggerSync();
    const remaining = await db.conflicts.count();
    if (remaining === 0) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-200 pb-4">
          <div className="rounded-xl bg-amber-100 p-2.5 text-amber-800">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 id="conflict-modal-title" className="text-xl font-bold text-slate-900">
              Diferencia encontrada entre dispositivos ({conflicts.length})
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Esta misma nota se modificó en dos dispositivos distintos antes de sincronizar.
              Elija cuál valor desea conservar. Ningún dato se pierde sin su confirmación.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {conflicts.map((c) => {
            const localStatus = (c.local_payload.status as GradeStatus) ?? 'empty';
            const localValue = (c.local_payload.value as string | null) ?? null;
            const localQual = (c.local_payload.qualitative as string | null) ?? null;

            const serverStatus = (c.server_record.status as GradeStatus) ?? 'empty';
            const serverValue = (c.server_record.value as string | null) ?? null;
            const serverQual = (c.server_record.qualitative as string | null) ?? null;

            const stuId = (c.local_payload.student_id ?? c.server_record.student_id) as string;
            const evId = (c.local_payload.evaluation_id ?? c.server_record.evaluation_id) as string;
            const studentName = studentMap.get(stuId) ?? 'Estudiante';
            const evalName = evalMap.get(evId) ?? 'Evaluación';

            const localText =
              gradeDisplay({ status: localStatus, value: localValue, qualitative: localQual }) ||
              'Sin registrar';
            const serverText =
              gradeDisplay({ status: serverStatus, value: serverValue, qualitative: serverQual }) ||
              'Sin registrar';

            const serverDevice = (c.server_record.updated_by_device as string) || 'Otro dispositivo';
            const localDevice = c.local_device || 'Este dispositivo';

            return (
              <div key={c.id} className="rounded-xl border border-amber-300 bg-amber-50/50 p-4">
                <div className="mb-3">
                  <p className="font-bold text-slate-900">{studentName}</p>
                  <p className="text-sm text-slate-600">Evaluación: {evalName}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-800">
                        <Smartphone className="h-4 w-4" aria-hidden="true" />
                        <span>{localDevice} (este equipo)</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="conflict-local-value">
                        {localText}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResolve(c.id, 'local')}
                      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Usar {localText}</span>
                    </button>
                  </div>

                  <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <Laptop className="h-4 w-4" aria-hidden="true" />
                        <span>{serverDevice} (otro equipo)</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="conflict-server-value">
                        {serverText}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResolve(c.id, 'server')}
                      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-200"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Usar {serverText}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Revisar más tarde
          </button>
        </div>
      </div>
    </div>
  );
}

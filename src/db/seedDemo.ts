/**
 * Datos de demostración ficticios para aprender a utilizar Mi Libreta sin riesgo.
 *
 * Incluye:
 * - Institución ficticia y Año lectivo 2026-2027 (3 trimestres).
 * - Dos cursos/asignaturas:
 *   1) 8.º EGB «A» — Matemática (cuantitativa: Formativa 70 %, Sumativa 30 %, truncado a 2 decimales).
 *   2) Inicial 2 «A» — Ámbito Lógico-Matemático (cualitativa: I, EP, A, NE; sin promedios numéricos).
 * - Estudiantes ficticios con calificaciones de ejemplo, ausencias y notas pendientes.
 */
import type { LibretaDB } from './db';
import { configureDb, getContext, save } from './repo';
import { PRESET_EC_2025, PRESET_QUALITATIVE_INICIAL } from '../domain/presets';
import { gradeIdFor } from '../lib/ids';

export async function seedDemoData(db: LibretaDB): Promise<void> {
  const prevCtx = getContext(db);
  // Durante la carga inicial de demostración no encolamos en outbox si es demo local
  configureDb(db, { ...prevCtx });

  const inst = await save(db, 'institutions', {
    id: 'demo-inst-1',
    name: 'Unidad Educativa Fiscal «República del Ecuador» (Demostración)',
  });

  const year = await save(db, 'academic_years', {
    id: 'demo-year-2026',
    institution_id: inst.id,
    name: '2026 - 2027',
    regime: 'sierra_amazonia',
    is_active: true,
  });

  const t1 = await save(db, 'academic_periods', {
    id: 'demo-period-t1',
    academic_year_id: year.id,
    name: 'Primer Trimestre',
    kind: 'trimestre',
    sort_order: 1,
    closed_at: null,
    locked_scheme_id: null,
  });

  await save(db, 'academic_periods', {
    id: 'demo-period-t2',
    academic_year_id: year.id,
    name: 'Segundo Trimestre',
    kind: 'trimestre',
    sort_order: 2,
    closed_at: null,
    locked_scheme_id: null,
  });

  await save(db, 'academic_periods', {
    id: 'demo-period-t3',
    academic_year_id: year.id,
    name: 'Tercer Trimestre',
    kind: 'trimestre',
    sort_order: 3,
    closed_at: null,
    locked_scheme_id: null,
  });

  // Regla cuantitativa (referencia 2025)
  const quantScheme = await save(db, 'grading_schemes', {
    id: 'demo-scheme-quant-v1',
    family_id: 'demo-scheme-quant-family',
    scheme_version: 1,
    name: PRESET_EC_2025.name,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    source_note: PRESET_EC_2025.sourceNote,
    config: PRESET_EC_2025.config,
  });

  for (let i = 0; i < PRESET_EC_2025.categories.length; i++) {
    const c = PRESET_EC_2025.categories[i];
    await save(db, 'evaluation_categories', {
      id: `demo-cat-quant-${c.key}`,
      scheme_id: quantScheme.id,
      key: c.key,
      name: c.name,
      kind: c.kind,
      weight: c.weight,
      sort_order: i + 1,
    });
  }

  // Regla cualitativa (Inicial / Preparatoria)
  const qualScheme = await save(db, 'grading_schemes', {
    id: 'demo-scheme-qual-v1',
    family_id: 'demo-scheme-qual-family',
    scheme_version: 1,
    name: PRESET_QUALITATIVE_INICIAL.name,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    source_note: PRESET_QUALITATIVE_INICIAL.sourceNote,
    config: PRESET_QUALITATIVE_INICIAL.config,
  });

  for (let i = 0; i < PRESET_QUALITATIVE_INICIAL.categories.length; i++) {
    const c = PRESET_QUALITATIVE_INICIAL.categories[i];
    await save(db, 'evaluation_categories', {
      id: `demo-cat-qual-${c.key}`,
      scheme_id: qualScheme.id,
      key: c.key,
      name: c.name,
      kind: c.kind,
      weight: c.weight,
      sort_order: i + 1,
    });
  }

  // Cursos y asignaturas
  const group8A = await save(db, 'class_groups', {
    id: 'demo-group-8a',
    academic_year_id: year.id,
    name: '8.º de Básica',
    parallel: 'A',
    level: 'egb_superior',
  });

  const groupInicial = await save(db, 'class_groups', {
    id: 'demo-group-inicial',
    academic_year_id: year.id,
    name: 'Inicial 2',
    parallel: 'A',
    level: 'inicial',
  });

  const subjMath = await save(db, 'subjects', {
    id: 'demo-subj-mat',
    name: 'Matemática',
  });

  const subjLanguage = await save(db, 'subjects', {
    id: 'demo-subj-len',
    name: 'Lengua y Literatura',
  });

  const subjDiscovery = await save(db, 'subjects', {
    id: 'demo-subj-rel',
    name: 'Relaciones Lógico-Matemáticas',
  });

  const assign8AMath = await save(db, 'teaching_assignments', {
    id: 'demo-assign-8a-mat',
    academic_year_id: year.id,
    class_group_id: group8A.id,
    subject_id: subjMath.id,
    grading_scheme_id: quantScheme.id,
  });

  await save(db, 'teaching_assignments', {
    id: 'demo-assign-8a-len',
    academic_year_id: year.id,
    class_group_id: group8A.id,
    subject_id: subjLanguage.id,
    grading_scheme_id: quantScheme.id,
  });

  const assignInicial = await save(db, 'teaching_assignments', {
    id: 'demo-assign-inicial',
    academic_year_id: year.id,
    class_group_id: groupInicial.id,
    subject_id: subjDiscovery.id,
    grading_scheme_id: qualScheme.id,
  });

  // Estudiantes de 8.º EGB «A» (datos ficticios)
  const students8A = [
    { id: 'demo-stu-01', last_names: 'Alcívar Mendoza', first_names: 'Camila Sofía', code: 'EST-801' },
    { id: 'demo-stu-02', last_names: 'Benítez Zambrano', first_names: 'Mateo Sebastián', code: 'EST-802' },
    { id: 'demo-stu-03', last_names: 'Cedeño Vera', first_names: 'Valentina Isabel', code: 'EST-803' },
    { id: 'demo-stu-04', last_names: 'Chávez Quiroz', first_names: 'Diego Alejandro', code: 'EST-804' },
    { id: 'demo-stu-05', last_names: 'Espinoza Mora', first_names: 'Lucía Fernanda', code: 'EST-805' },
    { id: 'demo-stu-06', last_names: 'Guamán Quispe', first_names: 'Santiago Andrés', code: 'EST-806' },
    { id: 'demo-stu-07', last_names: 'Loor Intriago', first_names: 'Paula Andrea', code: 'EST-807' },
    { id: 'demo-stu-08', last_names: 'Macías Pincay', first_names: 'Nicolás Emilio', code: 'EST-808' },
  ];

  for (let i = 0; i < students8A.length; i++) {
    const s = students8A[i];
    await save(db, 'students', {
      id: s.id,
      last_names: s.last_names,
      first_names: s.first_names,
      internal_code: s.code,
      archived_at: null,
    });
    await save(db, 'enrollments', {
      id: `demo-enr-8a-${i + 1}`,
      student_id: s.id,
      class_group_id: group8A.id,
      academic_year_id: year.id,
      list_number: i + 1,
      status: 'active',
      status_changed_on: null,
    });
  }

  // Evaluaciones de Matemática 8.º «A» (Primer Trimestre)
  const evTarea1 = await save(db, 'evaluations', {
    id: 'demo-eval-t1',
    assignment_id: assign8AMath.id,
    period_id: t1.id,
    category_key: 'formativa',
    name: 'Tarea 1: Números enteros',
    date: '2026-09-15',
    weight: null,
    kind: 'regular',
    sort_order: 1,
  });

  const evTaller1 = await save(db, 'evaluations', {
    id: 'demo-eval-t2',
    assignment_id: assign8AMath.id,
    period_id: t1.id,
    category_key: 'formativa',
    name: 'Taller en clase',
    date: '2026-09-29',
    weight: null,
    kind: 'regular',
    sort_order: 2,
  });

  const evLeccion = await save(db, 'evaluations', {
    id: 'demo-eval-t3',
    assignment_id: assign8AMath.id,
    period_id: t1.id,
    category_key: 'formativa',
    name: 'Lección escrita',
    date: '2026-10-12',
    weight: null,
    kind: 'regular',
    sort_order: 3,
  });

  const evExamen = await save(db, 'evaluations', {
    id: 'demo-eval-ex1',
    assignment_id: assign8AMath.id,
    period_id: t1.id,
    category_key: 'sumativa',
    name: 'Proyecto / Examen Trimestral',
    date: '2026-11-02',
    weight: null,
    kind: 'regular',
    sort_order: 4,
  });

  // Calificaciones de ejemplo para 8.º «A»
  const sampleGrades: { stu: string; t1?: string; t2?: string; t3?: string; ex?: string; t3Status?: 'absent' | 'pending' }[] = [
    { stu: 'demo-stu-01', t1: '9.5', t2: '9.25', t3: '9.8', ex: '9.5' },
    { stu: 'demo-stu-02', t1: '8.12', t2: '8.5', t3: '8.74', ex: '9.1' },
    { stu: 'demo-stu-03', t1: '7.5', t2: '7.8', t3: '7.2', ex: '7.5' },
    { stu: 'demo-stu-04', t1: '6.5', t2: '6.0', t3: '6.8', ex: '6.25' },
    { stu: 'demo-stu-05', t1: '8.8', t2: '9.0', t3Status: 'absent', ex: '8.5' },
    { stu: 'demo-stu-06', t1: '7.0', t2: '7.5', t3Status: 'pending', ex: '7.2' },
    { stu: 'demo-stu-07', t1: '10', t2: '9.75', t3: '9.9', ex: '10' },
    { stu: 'demo-stu-08', t1: '8.0', t2: '8.25' }, // aún faltan t3 y examen por registrar
  ];

  for (const row of sampleGrades) {
    const pairs: [string, string | undefined, 'absent' | 'pending' | undefined][] = [
      [evTarea1.id, row.t1, undefined],
      [evTaller1.id, row.t2, undefined],
      [evLeccion.id, row.t3, row.t3Status],
      [evExamen.id, row.ex, undefined],
    ];
    for (const [evId, val, specialStatus] of pairs) {
      if (!val && !specialStatus) continue;
      const gId = await gradeIdFor(evId, row.stu);
      await save(db, 'grades', {
        id: gId,
        evaluation_id: evId,
        student_id: row.stu,
        status: specialStatus ?? 'graded',
        value: val ?? null,
        qualitative: null,
      });
    }
  }

  // Estudiantes de Inicial 2 «A» (escala cualitativa)
  const studentsInicial = [
    { id: 'demo-ini-01', last_names: 'Morales Vega', first_names: 'Emilia Paz', code: 'INI-101' },
    { id: 'demo-ini-02', last_names: 'Paredes Bravo', first_names: 'Joaquín Tomás', code: 'INI-102' },
    { id: 'demo-ini-03', last_names: 'Salazar Cordero', first_names: 'Martina Belén', code: 'INI-103' },
  ];

  for (let i = 0; i < studentsInicial.length; i++) {
    const s = studentsInicial[i];
    await save(db, 'students', {
      id: s.id,
      last_names: s.last_names,
      first_names: s.first_names,
      internal_code: s.code,
      archived_at: null,
    });
    await save(db, 'enrollments', {
      id: `demo-enr-ini-${i + 1}`,
      student_id: s.id,
      class_group_id: groupInicial.id,
      academic_year_id: year.id,
      list_number: i + 1,
      status: 'active',
      status_changed_on: null,
    });
  }

  const evDestreza1 = await save(db, 'evaluations', {
    id: 'demo-eval-ini-1',
    assignment_id: assignInicial.id,
    period_id: t1.id,
    category_key: 'destrezas',
    name: 'Clasifica objetos por color y tamaño',
    date: '2026-10-05',
    weight: null,
    kind: 'regular',
    sort_order: 1,
  });

  const qualGrades: [string, string][] = [
    ['demo-ini-01', 'A'],
    ['demo-ini-02', 'EP'],
    ['demo-ini-03', 'I'],
  ];
  for (const [stuId, code] of qualGrades) {
    const gId = await gradeIdFor(evDestreza1.id, stuId);
    await save(db, 'grades', {
      id: gId,
      evaluation_id: evDestreza1.id,
      student_id: stuId,
      status: 'graded',
      value: null,
      qualitative: code,
    });
  }

  await db.setMeta('setup_completed', true);
  await db.setMeta('is_demo_mode', true);
  await db.setMeta('last_assignment_id', assign8AMath.id);
}

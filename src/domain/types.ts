/**
 * Modelo de dominio de Mi Libreta.
 *
 * Cada entidad sincronizable comparte los mismos metadatos (SyncMeta).
 * Los valores numéricos de calificaciones y ponderaciones se guardan como
 * TEXTO decimal ("8.75") para no perder precisión con números de coma flotante.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Metadatos comunes
// ---------------------------------------------------------------------------
export const syncMetaSchema = z.object({
  id: z.string().min(1),
  owner_id: z.string().nullable(),
  /** Versión confirmada por el servidor (0 = todavía no existe en el servidor). */
  version: z.number().int().nonnegative(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  /** Nombre del dispositivo que hizo el último cambio (p. ej. «Celular»). */
  updated_by_device: z.string().nullable(),
  /** Secuencia del servidor. Solo la asigna el servidor. */
  server_seq: z.number().nullable().optional(),
});
export type SyncMeta = z.infer<typeof syncMetaSchema>;

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Número decimal inválido');

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------
export const profileSchema = syncMetaSchema.extend({
  display_name: z.string().max(120),
});
export type Profile = z.infer<typeof profileSchema>;

export const institutionSchema = syncMetaSchema.extend({
  name: z.string().min(1).max(200),
});
export type Institution = z.infer<typeof institutionSchema>;

export const REGIMES = ['sierra_amazonia', 'costa_galapagos', 'otro'] as const;
export const academicYearSchema = syncMetaSchema.extend({
  institution_id: z.string(),
  name: z.string().min(1).max(60),
  regime: z.enum(REGIMES),
  is_active: z.boolean(),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

export const PERIOD_KINDS = ['trimestre', 'quimestre', 'parcial', 'otro'] as const;
export const academicPeriodSchema = syncMetaSchema.extend({
  academic_year_id: z.string(),
  name: z.string().min(1).max(60),
  kind: z.enum(PERIOD_KINDS),
  sort_order: z.number().int(),
  /** Fecha de cierre. Un período cerrado queda ligado a una versión fija de las reglas. */
  closed_at: z.string().nullable(),
  locked_scheme_id: z.string().nullable(),
});
export type AcademicPeriod = z.infer<typeof academicPeriodSchema>;

export const LEVELS = [
  'inicial',
  'preparatoria',
  'egb_elemental',
  'egb_media',
  'egb_superior',
  'bachillerato',
  'otro',
] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = {
  inicial: 'Educación Inicial',
  preparatoria: 'Preparatoria (1.º EGB)',
  egb_elemental: 'EGB Elemental (2.º a 4.º)',
  egb_media: 'EGB Media (5.º a 7.º)',
  egb_superior: 'EGB Superior (8.º a 10.º)',
  bachillerato: 'Bachillerato',
  otro: 'Otro',
};

export const classGroupSchema = syncMetaSchema.extend({
  academic_year_id: z.string(),
  name: z.string().min(1).max(80),
  parallel: z.string().max(20),
  level: z.enum(LEVELS),
});
export type ClassGroup = z.infer<typeof classGroupSchema>;

export const subjectSchema = syncMetaSchema.extend({
  name: z.string().min(1).max(120),
});
export type Subject = z.infer<typeof subjectSchema>;

export const teachingAssignmentSchema = syncMetaSchema.extend({
  academic_year_id: z.string(),
  class_group_id: z.string(),
  subject_id: z.string(),
  grading_scheme_id: z.string(),
});
export type TeachingAssignment = z.infer<typeof teachingAssignmentSchema>;

export const studentSchema = syncMetaSchema.extend({
  last_names: z.string().min(1).max(120),
  first_names: z.string().min(1).max(120),
  /** Código opcional de la institución. No se pide cédula ni datos sensibles. */
  internal_code: z.string().max(40).nullable(),
  archived_at: z.string().nullable(),
});
export type Student = z.infer<typeof studentSchema>;

export const ENROLLMENT_STATUSES = ['active', 'withdrawn', 'transferred'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Activo',
  withdrawn: 'Retirado',
  transferred: 'Trasladado',
};
export const enrollmentSchema = syncMetaSchema.extend({
  student_id: z.string(),
  class_group_id: z.string(),
  academic_year_id: z.string(),
  list_number: z.number().int().positive().nullable(),
  status: z.enum(ENROLLMENT_STATUSES),
  status_changed_on: z.string().nullable(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

// ---------------------------------------------------------------------------
// Reglas de calificación (configurables y versionadas)
// ---------------------------------------------------------------------------
export const roundingSchema = z.object({
  mode: z.enum(['truncate', 'round_half_up', 'none']),
  decimals: z.number().int().min(0).max(4),
});
export type Rounding = z.infer<typeof roundingSchema>;

export const qualitativeOptionSchema = z.object({
  code: z.string().min(1).max(10),
  label: z.string().min(1).max(120),
});
export type QualitativeOption = z.infer<typeof qualitativeOptionSchema>;

export const equivalenceSchema = z.object({
  from: decimalString,
  to: decimalString,
  code: z.string().max(10),
  label: z.string().max(160),
});
export type Equivalence = z.infer<typeof equivalenceSchema>;

export const MISSING_POLICIES = ['exclude', 'zero'] as const;

export const gradingConfigSchema = z.object({
  mode: z.enum(['quantitative', 'qualitative']),
  scale: z.object({
    min: decimalString,
    max: decimalString,
    /** Decimales permitidos al ingresar una nota. */
    inputDecimals: z.number().int().min(0).max(4),
  }),
  qualitativeOptions: z.array(qualitativeOptionSchema),
  equivalences: z.array(equivalenceSchema),
  passingGrade: decimalString.nullable(),
  /** Cómo se promedian las evaluaciones dentro de una categoría. */
  withinCategory: z.enum(['simple', 'weighted']),
  /** Cómo se combinan las categorías para obtener la nota del período. */
  combineCategories: z.enum(['weighted', 'simple']),
  missing: z.object({
    empty: z.enum(MISSING_POLICIES),
    absent: z.enum(MISSING_POLICIES),
    pending: z.enum(MISSING_POLICIES),
  }),
  rounding: z.object({
    category: roundingSchema,
    period: roundingSchema,
    final: roundingSchema,
  }),
  periodCombination: z.enum(['simple', 'weighted']),
  /** Pesos por orden de período (1.º, 2.º, 3.º…) cuando periodCombination = weighted. */
  periodWeights: z.array(decimalString),
  improvement: z.object({
    enabled: z.boolean(),
    policy: z.enum(['replace_lowest_period_if_higher']),
  }),
  supplementary: z.object({
    enabled: z.boolean(),
    /** Promedio mínimo para tener derecho a supletorio (inclusive). */
    eligibleFrom: decimalString,
    /** Nota mínima en el supletorio para aprobar. */
    passScore: decimalString,
    /** Nota final que se registra si aprueba el supletorio. */
    resultWhenPassed: z.enum(['passing_grade', 'exam_score']),
  }),
});
export type GradingConfig = z.infer<typeof gradingConfigSchema>;

export const gradingSchemeSchema = syncMetaSchema.extend({
  /** Todas las versiones de una misma regla comparten family_id. */
  family_id: z.string(),
  scheme_version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  status: z.enum(['draft', 'confirmed']),
  confirmed_at: z.string().nullable(),
  /** Fuente o nota de verificación (p. ej. «Instructivo 2025, verificado por la Dirección»). */
  source_note: z.string().max(500),
  config: gradingConfigSchema,
});
export type GradingScheme = z.infer<typeof gradingSchemeSchema>;

export const CATEGORY_KINDS = ['formative', 'summative', 'other'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  formative: 'Formativa',
  summative: 'Sumativa',
  other: 'Otra',
};
export const evaluationCategorySchema = syncMetaSchema.extend({
  scheme_id: z.string(),
  /** Clave estable entre versiones de la regla (p. ej. "formativa"). */
  key: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  kind: z.enum(CATEGORY_KINDS),
  weight: decimalString.nullable(),
  sort_order: z.number().int(),
});
export type EvaluationCategory = z.infer<typeof evaluationCategorySchema>;

export const EVALUATION_KINDS = ['regular', 'improvement', 'supplementary'] as const;
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];
export const evaluationSchema = syncMetaSchema.extend({
  assignment_id: z.string(),
  /** Período (null para evaluaciones anuales: mejora o supletorio). */
  period_id: z.string().nullable(),
  category_key: z.string().nullable(),
  name: z.string().min(1).max(80),
  date: z.string().nullable(),
  weight: decimalString.nullable(),
  kind: z.enum(EVALUATION_KINDS),
  sort_order: z.number().int(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const GRADE_STATUSES = ['empty', 'graded', 'absent', 'pending'] as const;
export type GradeStatus = (typeof GRADE_STATUSES)[number];
export const GRADE_STATUS_LABELS: Record<GradeStatus, string> = {
  empty: 'Sin registrar',
  graded: 'Calificado',
  absent: 'Ausente',
  pending: 'Pendiente',
};
export const gradeSchema = syncMetaSchema.extend({
  evaluation_id: z.string(),
  student_id: z.string(),
  status: z.enum(GRADE_STATUSES),
  /** Valor numérico como texto decimal normalizado ("8.5"). */
  value: decimalString.nullable(),
  /** Código cualitativo (p. ej. "A" = Adquirido). */
  qualitative: z.string().max(10).nullable(),
});
export type Grade = z.infer<typeof gradeSchema>;

export const gradeRevisionSchema = z.object({
  id: z.string(),
  owner_id: z.string().nullable(),
  grade_id: z.string(),
  old_status: z.string().nullable(),
  old_value: z.string().nullable(),
  old_qualitative: z.string().nullable(),
  new_status: z.string(),
  new_value: z.string().nullable(),
  new_qualitative: z.string().nullable(),
  device: z.string().nullable(),
  changed_at: z.string(),
  server_seq: z.number().nullable().optional(),
});
export type GradeRevision = z.infer<typeof gradeRevisionSchema>;

/** Mapeo de una plantilla Excel institucional. */
export const templateColumnSchema = z.object({
  /** Letra de columna (p. ej. "D"). */
  column: z.string().regex(/^[A-Z]{1,3}$/),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('list_number') }),
    z.object({ type: z.literal('full_name') }),
    z.object({ type: z.literal('last_names') }),
    z.object({ type: z.literal('first_names') }),
    z.object({ type: z.literal('internal_code') }),
    z.object({ type: z.literal('evaluation'), evaluationId: z.string() }),
    z.object({ type: z.literal('category_average'), periodId: z.string(), categoryKey: z.string() }),
    z.object({ type: z.literal('period_average'), periodId: z.string() }),
    z.object({ type: z.literal('final_average') }),
    z.object({ type: z.literal('qualitative_equivalence'), periodId: z.string().nullable() }),
  ]),
});
export type TemplateColumn = z.infer<typeof templateColumnSchema>;

export const templateMappingSchema = z.object({
  sheetName: z.string(),
  firstDataRow: z.number().int().positive(),
  /** Cómo se ubica a cada estudiante dentro de la plantilla. */
  matchBy: z.enum(['order', 'list_number_column', 'name_column']),
  /** Columna usada para emparejar cuando matchBy no es "order". */
  matchColumn: z.string().regex(/^[A-Z]{1,3}$/).nullable(),
  columns: z.array(templateColumnSchema),
  /** Celdas fijas: p. ej. B3 = nombre del curso. */
  fixedCells: z.array(
    z.object({
      cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/),
      source: z.enum(['institution', 'academic_year', 'class_group', 'subject', 'period', 'teacher', 'date']),
    }),
  ),
});
export type TemplateMapping = z.infer<typeof templateMappingSchema>;

export const exportTemplateSchema = syncMetaSchema.extend({
  name: z.string().min(1).max(120),
  file_name: z.string().max(200),
  /** Archivo XLSX original en base64 (máx. ~5 MB). */
  file_base64: z.string(),
  assignment_id: z.string().nullable(),
  period_id: z.string().nullable(),
  mapping: templateMappingSchema.nullable(),
  verified_at: z.string().nullable(),
});
export type ExportTemplate = z.infer<typeof exportTemplateSchema>;

export const auditEventSchema = syncMetaSchema.extend({
  event_type: z.string().max(60),
  entity: z.string().max(60).nullable(),
  entity_id: z.string().nullable(),
  /** Detalles sin datos personales (conteos, identificadores internos). */
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

// ---------------------------------------------------------------------------
// Tablas sincronizables, en orden de dependencias (padres primero).
// ---------------------------------------------------------------------------
export const SYNC_TABLES = [
  'profiles',
  'institutions',
  'academic_years',
  'academic_periods',
  'class_groups',
  'subjects',
  'grading_schemes',
  'evaluation_categories',
  'teaching_assignments',
  'students',
  'enrollments',
  'evaluations',
  'grades',
  'export_templates',
  'audit_events',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Tablas que solo se descargan (las genera el servidor). */
export const PULL_ONLY_TABLES = ['grade_revisions'] as const;

export const TABLE_SCHEMAS = {
  profiles: profileSchema,
  institutions: institutionSchema,
  academic_years: academicYearSchema,
  academic_periods: academicPeriodSchema,
  class_groups: classGroupSchema,
  subjects: subjectSchema,
  grading_schemes: gradingSchemeSchema,
  evaluation_categories: evaluationCategorySchema,
  teaching_assignments: teachingAssignmentSchema,
  students: studentSchema,
  enrollments: enrollmentSchema,
  evaluations: evaluationSchema,
  grades: gradeSchema,
  export_templates: exportTemplateSchema,
  audit_events: auditEventSchema,
} as const;

export interface TableRowMap {
  profiles: Profile;
  institutions: Institution;
  academic_years: AcademicYear;
  academic_periods: AcademicPeriod;
  class_groups: ClassGroup;
  subjects: Subject;
  grading_schemes: GradingScheme;
  evaluation_categories: EvaluationCategory;
  teaching_assignments: TeachingAssignment;
  students: Student;
  enrollments: Enrollment;
  evaluations: Evaluation;
  grades: Grade;
  export_templates: ExportTemplate;
  audit_events: AuditEvent;
}

export const META_FIELDS = [
  'owner_id',
  'version',
  'updated_at',
  'deleted_at',
  'updated_by_device',
  'server_seq',
] as const;

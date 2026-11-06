/**
 * Base de datos local (IndexedDB mediante Dexie).
 *
 * Todo se escribe primero aquí. La sincronización con el servidor ocurre
 * después, a partir de la cola durable `outbox`.
 */
import Dexie, { type Table } from 'dexie';
import type {
  AcademicPeriod,
  AcademicYear,
  AuditEvent,
  ClassGroup,
  Enrollment,
  Evaluation,
  EvaluationCategory,
  ExportTemplate,
  Grade,
  GradeRevision,
  GradingScheme,
  Institution,
  Profile,
  Student,
  Subject,
  SyncTable,
  TeachingAssignment,
} from '../domain/types';

/** Operación pendiente de enviar al servidor. Idempotente gracias a op_id. */
export interface OutboxOp {
  seq?: number;
  op_id: string;
  table: SyncTable;
  record_id: string;
  /** Registro completo (sin metadatos controlados por el servidor). */
  payload: Record<string, unknown>;
  /** Versión del servidor sobre la que se hizo el cambio (0 = registro nuevo). */
  base_version: number;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

/** Cambio que no pudo aplicarse porque otro dispositivo modificó lo mismo. */
export interface ConflictEntry {
  id: string; // `${table}:${record_id}`
  table: SyncTable;
  record_id: string;
  local_payload: Record<string, unknown>;
  server_record: Record<string, unknown>;
  local_device: string | null;
  detected_at: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Historial local para «Deshacer» y para consultar cambios recientes. */
export interface LocalRevision {
  id?: number;
  table: SyncTable;
  record_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  at: string;
}

export class LibretaDB extends Dexie {
  profiles!: Table<Profile, string>;
  institutions!: Table<Institution, string>;
  academic_years!: Table<AcademicYear, string>;
  academic_periods!: Table<AcademicPeriod, string>;
  class_groups!: Table<ClassGroup, string>;
  subjects!: Table<Subject, string>;
  grading_schemes!: Table<GradingScheme, string>;
  evaluation_categories!: Table<EvaluationCategory, string>;
  teaching_assignments!: Table<TeachingAssignment, string>;
  students!: Table<Student, string>;
  enrollments!: Table<Enrollment, string>;
  evaluations!: Table<Evaluation, string>;
  grades!: Table<Grade, string>;
  export_templates!: Table<ExportTemplate, string>;
  audit_events!: Table<AuditEvent, string>;
  grade_revisions!: Table<GradeRevision, string>;
  outbox!: Table<OutboxOp, number>;
  conflicts!: Table<ConflictEntry, string>;
  meta!: Table<MetaEntry, string>;
  local_revisions!: Table<LocalRevision, number>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      profiles: 'id',
      institutions: 'id',
      academic_years: 'id, institution_id',
      academic_periods: 'id, academic_year_id',
      class_groups: 'id, academic_year_id',
      subjects: 'id',
      grading_schemes: 'id, family_id',
      evaluation_categories: 'id, scheme_id',
      teaching_assignments: 'id, academic_year_id, class_group_id',
      students: 'id',
      enrollments: 'id, student_id, class_group_id',
      evaluations: 'id, assignment_id, period_id',
      grades: 'id, evaluation_id, student_id',
      export_templates: 'id',
      audit_events: 'id',
      grade_revisions: 'id, grade_id',
      outbox: '++seq, &op_id, record_id, table',
      conflicts: 'id, table, record_id',
      meta: 'key',
      local_revisions: '++id, record_id, at',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const DATA_TABLES: SyncTable[] = [
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
];

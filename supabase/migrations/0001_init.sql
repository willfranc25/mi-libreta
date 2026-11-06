-- =============================================================================
-- MI LIBRETA - Esquema relacional, Row Level Security y motor de sincronización
-- =============================================================================
-- Principios:
-- 1. Aislamiento total por usuario (owner_id = auth.uid()) mediante RLS en TODAS las tablas.
-- 2. Nunca se usa user_metadata para autorización; solo auth.uid().
-- 3. Control de concurrencia optimista mediante `version` y secuencia `server_seq`.
-- 4. Operaciones idempotentes registradas en `sync_operations` (clave `op_id`).
-- 5. Historial automático de cambios de notas en `grade_revisions`.
-- 6. Datos fuente separados de promedios calculados (no se guardan promedios como fuente de verdad).

CREATE SEQUENCE IF NOT EXISTS public.global_server_seq START 1;

-- -----------------------------------------------------------------------------
-- 1. profiles (usuario propietario)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  display_name text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 2. institutions (institución educativa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institutions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 3. academic_years (años lectivos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  regime text NOT NULL CHECK (regime IN ('sierra_amazonia', 'costa_galapagos', 'otro')),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 4. academic_periods (trimestres u otros períodos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_periods (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('trimestre', 'quimestre', 'parcial', 'otro')),
  sort_order integer NOT NULL DEFAULT 1,
  closed_at timestamptz NULL,
  locked_scheme_id uuid NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 5. class_groups (cursos y paralelos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_groups (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  parallel text NOT NULL DEFAULT '',
  level text NOT NULL CHECK (level IN ('inicial', 'preparatoria', 'egb_elemental', 'egb_media', 'egb_superior', 'bachillerato', 'otro')),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 6. subjects (asignaturas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 7. grading_schemes (reglas y versiones de evaluación)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grading_schemes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  family_id uuid NOT NULL,
  scheme_version integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed')),
  confirmed_at timestamptz NULL,
  source_note text NOT NULL DEFAULT '',
  config jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq'),
  UNIQUE (owner_id, family_id, scheme_version)
);

-- -----------------------------------------------------------------------------
-- 8. evaluation_categories (categorías de calificaciones)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_categories (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  scheme_id uuid NOT NULL REFERENCES public.grading_schemes(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('formative', 'summative', 'other')),
  weight text NULL,
  sort_order integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq'),
  UNIQUE (scheme_id, key)
);

-- -----------------------------------------------------------------------------
-- 9. teaching_assignments (asignación de profesor, curso y asignatura)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teaching_assignments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  grading_scheme_id uuid NOT NULL REFERENCES public.grading_schemes(id),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 10. students (identidad mínima de estudiantes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  last_names text NOT NULL,
  first_names text NOT NULL,
  internal_code text NULL,
  archived_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 11. enrollments (matrícula del estudiante en un grupo y año)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  list_number integer NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'transferred')),
  status_changed_on text NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq'),
  UNIQUE (student_id, class_group_id)
);

-- -----------------------------------------------------------------------------
-- 12. evaluations (actividades calificables)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id) ON DELETE CASCADE,
  period_id uuid NULL REFERENCES public.academic_periods(id) ON DELETE CASCADE,
  category_key text NULL,
  name text NOT NULL,
  date text NULL,
  weight text NULL,
  kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'improvement', 'supplementary')),
  sort_order integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 13. grades (valores y estados de las calificaciones)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grades (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('empty', 'graded', 'absent', 'pending')),
  value text NULL,
  qualitative text NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq'),
  UNIQUE (evaluation_id, student_id)
);

-- -----------------------------------------------------------------------------
-- 14. grade_revisions (historial inmutable de modificaciones de notas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grade_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE CASCADE,
  old_status text NULL,
  old_value text NULL,
  old_qualitative text NULL,
  new_status text NOT NULL,
  new_value text NULL,
  new_qualitative text NULL,
  device text NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 15. export_templates (configuraciones para reportes y plantillas Excel)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.export_templates (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  file_name text NOT NULL,
  file_base64 text NOT NULL,
  assignment_id uuid NULL REFERENCES public.teaching_assignments(id) ON DELETE SET NULL,
  period_id uuid NULL REFERENCES public.academic_periods(id) ON DELETE SET NULL,
  mapping jsonb NULL,
  verified_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- -----------------------------------------------------------------------------
-- 16. sync_operations (operaciones idempotentes de sincronización)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_operations (
  op_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  base_version integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 17. audit_events (eventos relevantes sin datos personales sensibles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  event_type text NOT NULL,
  entity text NULL,
  entity_id text NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  updated_by_device text NULL,
  server_seq bigint NOT NULL DEFAULT nextval('public.global_server_seq')
);

-- Índices para sincronización rápida por server_seq y propietario
CREATE INDEX IF NOT EXISTS idx_grades_owner_seq ON public.grades(owner_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_evaluations_owner_seq ON public.evaluations(owner_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_students_owner_seq ON public.students(owner_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_enrollments_owner_seq ON public.enrollments(owner_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_revisions_owner_seq ON public.grade_revisions(owner_id, server_seq);

-- =============================================================================
-- Trigger de auditoría automática de calificaciones (grade_revisions)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_record_grade_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.grade_revisions (
      owner_id, grade_id, old_status, old_value, old_qualitative,
      new_status, new_value, new_qualitative, device
    ) VALUES (
      NEW.owner_id, NEW.id, NULL, NULL, NULL,
      NEW.status, NEW.value, NEW.qualitative, NEW.updated_by_device
    );
  ELSIF TG_OP = 'UPDATE' AND (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.value IS DISTINCT FROM NEW.value OR
    OLD.qualitative IS DISTINCT FROM NEW.qualitative
  ) THEN
    INSERT INTO public.grade_revisions (
      owner_id, grade_id, old_status, old_value, old_qualitative,
      new_status, new_value, new_qualitative, device
    ) VALUES (
      NEW.owner_id, NEW.id, OLD.status, OLD.value, OLD.qualitative,
      NEW.status, NEW.value, NEW.qualitative, NEW.updated_by_device
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grades_revision_trg ON public.grades;
CREATE TRIGGER grades_revision_trg
AFTER INSERT OR UPDATE ON public.grades
FOR EACH ROW EXECUTE FUNCTION public.trg_record_grade_revision();

-- =============================================================================
-- Row Level Security (RLS) estricto en las 17 tablas
-- =============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'profiles', 'institutions', 'academic_years', 'academic_periods',
    'class_groups', 'subjects', 'grading_schemes', 'evaluation_categories',
    'teaching_assignments', 'students', 'enrollments', 'evaluations',
    'grades', 'grade_revisions', 'export_templates', 'sync_operations', 'audit_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_select_own ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select_own ON public.%I FOR SELECT TO authenticated USING (owner_id = auth.uid());',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_insert_own ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert_own ON public.%I FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_update_own ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_update_own ON public.%I FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_delete_own ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete_own ON public.%I FOR DELETE TO authenticated USING (owner_id = auth.uid());',
      t, t
    );
  END LOOP;
END $$;

-- =============================================================================
-- RPC: sync_push — aplica un lote de operaciones con control de versión e idempotencia
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_push(ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  op jsonb;
  v_op_id uuid;
  v_table text;
  v_record_id uuid;
  v_base_version integer;
  v_device text;
  v_payload jsonb;
  v_uid uuid := auth.uid();
  v_prev_result jsonb;
  v_existing record;
  v_existing_json jsonb;
  v_new_version integer;
  v_item_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_allowed_tables text[] := ARRAY[
    'profiles', 'institutions', 'academic_years', 'academic_periods',
    'class_groups', 'subjects', 'grading_schemes', 'evaluation_categories',
    'teaching_assignments', 'students', 'enrollments', 'evaluations',
    'grades', 'export_templates', 'audit_events'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida';
  END IF;

  FOR op IN SELECT * FROM jsonb_array_elements(ops) LOOP
    v_op_id := (op->>'op_id')::uuid;
    v_table := op->>'table';
    v_record_id := (op->>'record_id')::uuid;
    v_base_version := COALESCE((op->>'base_version')::integer, 0);
    v_device := op->>'device';
    v_payload := op->'payload';

    -- 1. Idempotencia: si la operación ya se procesó, devolver exactamente el mismo resultado
    SELECT result INTO v_prev_result
    FROM public.sync_operations
    WHERE op_id = v_op_id AND owner_id = v_uid;

    IF v_prev_result IS NOT NULL THEN
      v_results := v_results || jsonb_build_array(v_prev_result);
      CONTINUE;
    END IF;

    IF NOT (v_table = ANY(v_allowed_tables)) THEN
      v_item_result := jsonb_build_object('op_id', v_op_id, 'status', 'error', 'error', 'Tabla no permitida');
      v_results := v_results || jsonb_build_array(v_item_result);
      CONTINUE;
    END IF;

    -- 2. Consultar estado actual del registro del propietario
    EXECUTE format('SELECT to_jsonb(t.*) AS data FROM public.%I t WHERE id = $1 AND owner_id = $2', v_table)
      INTO v_existing
      USING v_record_id, v_uid;

    v_existing_json := v_existing.data;

    IF v_existing_json IS NULL THEN
      -- Registro nuevo: versión 1
      v_new_version := 1;
      v_payload := (v_payload - 'owner_id' - 'version' - 'server_seq')
        || jsonb_build_object(
          'id', v_record_id,
          'owner_id', v_uid,
          'version', v_new_version,
          'updated_at', now(),
          'updated_by_device', v_device,
          'server_seq', nextval('public.global_server_seq')
        );

      EXECUTE format(
        'INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)',
        v_table, v_table
      ) USING v_payload;

      v_item_result := jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'version', v_new_version);

    ELSIF (v_existing_json->>'version')::integer = v_base_version THEN
      -- Coincide la versión base: actualizar e incrementar versión
      v_new_version := v_base_version + 1;
      v_payload := v_existing_json
        || (v_payload - 'owner_id' - 'version' - 'server_seq')
        || jsonb_build_object(
          'id', v_record_id,
          'owner_id', v_uid,
          'version', v_new_version,
          'updated_at', now(),
          'updated_by_device', v_device,
          'server_seq', nextval('public.global_server_seq')
        );

      EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND owner_id = $2', v_table)
        USING v_record_id, v_uid;
      EXECUTE format(
        'INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)',
        v_table, v_table
      ) USING v_payload;

      v_item_result := jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'version', v_new_version);

    ELSE
      -- Conflicto de versión: no se sobrescribe; se devuelve el registro del servidor
      v_item_result := jsonb_build_object(
        'op_id', v_op_id,
        'status', 'conflict',
        'record', v_existing_json
      );
    END IF;

    INSERT INTO public.sync_operations (op_id, owner_id, table_name, record_id, base_version, result)
    VALUES (v_op_id, v_uid, v_table, v_record_id, v_base_version, v_item_result);

    v_results := v_results || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN v_results;
END;
$$;

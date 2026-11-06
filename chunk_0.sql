INSERT INTO public._fn_builder (id, chunk) VALUES (0, 'CREATE OR REPLACE FUNCTION public.sync_push(ops jsonb)
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
  v_results jsonb := ''[]''::jsonb;
  v_allowed_tables text[] := ARRAY[
    ''profiles'', ''institutions'', ''academic_years'', ''academic_periods'',
    ''class_groups'', ''subjects'', ''grading_schemes'', ''evaluation_categories'',
    ''teaching_assignments'', ''students'', ''enrollments'', ''evaluations'',
    ''grades'', ''export_templates'', ''audit_events''
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION ''Autenticación requeri') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
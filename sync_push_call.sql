CALL public.exec_sql('CREATE OR REPLACE FUNCTION public.sync_push(ops jsonb)
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
    RAISE EXCEPTION ''Autenticación requerida'';
  END IF;

  FOR op IN SELECT * FROM jsonb_array_elements(ops) LOOP
    v_op_id := (op->>''op_id'')::uuid;
    v_table := op->>''table'';
    v_record_id := (op->>''record_id'')::uuid;
    v_base_version := COALESCE((op->>''base_version'')::integer, 0);
    v_device := op->>''device'';
    v_payload := op->''payload'';

    -- 1. Idempotencia: si la operación ya se procesó, devolver exactamente el mismo resultado
    SELECT result INTO v_prev_result
    FROM public.sync_operations
    WHERE op_id = v_op_id AND owner_id = v_uid;

    IF v_prev_result IS NOT NULL THEN
      v_results := v_results || jsonb_build_array(v_prev_result);
      CONTINUE;
    END IF;

    IF NOT (v_table = ANY(v_allowed_tables)) THEN
      v_item_result := jsonb_build_object(''op_id'', v_op_id, ''status'', ''error'', ''error'', ''Tabla no permitida'');
      v_results := v_results || jsonb_build_array(v_item_result);
      CONTINUE;
    END IF;

    -- 2. Consultar estado actual del registro del propietario
    EXECUTE format(''SELECT to_jsonb(t.*) AS data FROM public.%I t WHERE id = $1 AND owner_id = $2'', v_table)
      INTO v_existing
      USING v_record_id, v_uid;

    v_existing_json := v_existing.data;

    IF v_existing_json IS NULL THEN
      -- Registro nuevo: versión 1
      v_new_version := 1;
      v_payload := (v_payload - ''owner_id'' - ''version'' - ''server_seq'')
        || jsonb_build_object(
          ''id'', v_record_id,
          ''owner_id'', v_uid,
          ''version'', v_new_version,
          ''updated_at'', now(),
          ''updated_by_device'', v_device,
          ''server_seq'', nextval(''public.global_server_seq'')
        );

      EXECUTE format(
        ''INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)'',
        v_table, v_table
      ) USING v_payload;

      v_item_result := jsonb_build_object(''op_id'', v_op_id, ''status'', ''applied'', ''version'', v_new_version);

    ELSIF (v_existing_json->>''version'')::integer = v_base_version THEN
      -- Coincide la versión base: actualizar e incrementar versión
      v_new_version := v_base_version + 1;
      v_payload := v_existing_json
        || (v_payload - ''owner_id'' - ''version'' - ''server_seq'')
        || jsonb_build_object(
          ''id'', v_record_id,
          ''owner_id'', v_uid,
          ''version'', v_new_version,
          ''updated_at'', now(),
          ''updated_by_device'', v_device,
          ''server_seq'', nextval(''public.global_server_seq'')
        );

      EXECUTE format(''DELETE FROM public.%I WHERE id = $1 AND owner_id = $2'', v_table)
        USING v_record_id, v_uid;
      EXECUTE format(
        ''INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)'',
        v_table, v_table
      ) USING v_payload;

      v_item_result := jsonb_build_object(''op_id'', v_op_id, ''status'', ''applied'', ''version'', v_new_version);

    ELSE
      -- Conflicto de versión: no se sobrescribe; se devuelve el registro del servidor
      v_item_result := jsonb_build_object(
        ''op_id'', v_op_id,
        ''status'', ''conflict'',
        ''record'', v_existing_json
      );
    END IF;

    INSERT INTO public.sync_operations (op_id, owner_id, table_name, record_id, base_version, result)
    VALUES (v_op_id, v_uid, v_table, v_record_id, v_base_version, v_item_result);

    v_results := v_results || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN v_results;
END;
$$;
');
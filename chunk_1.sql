INSERT INTO public._fn_builder (id, chunk) VALUES (1, 'da'';
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
      v_item_result := jsonb_build_object(''op_id'', v_op_id, ''status'', ''error'', ''error'', ''') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
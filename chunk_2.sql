INSERT INTO public._fn_builder (id, chunk) VALUES (2, 'Tabla no permitida'');
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
          ''server_seq'', nextval(''public.global_ser') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
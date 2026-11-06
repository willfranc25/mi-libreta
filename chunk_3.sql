INSERT INTO public._fn_builder (id, chunk) VALUES (3, 'ver_seq'')
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
          ''server_seq'', nextv') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
INSERT INTO public._fn_builder (id, chunk) VALUES (4, 'al(''public.global_server_seq'')
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
    VALUES ') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
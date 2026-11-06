INSERT INTO public._fn_builder (id, chunk) VALUES (5, '(v_op_id, v_uid, v_table, v_record_id, v_base_version, v_item_result);

    v_results := v_results || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN v_results;
END;
$$;
') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;
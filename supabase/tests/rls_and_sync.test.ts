/**
 * Pruebas reales de PostgreSQL (mediante PGlite) sobre la migración SQL:
 * - Verifica que las 17 tablas tienen Row Level Security (RLS) activo y forzado.
 * - Comprueba aislamiento estricto entre Profesor A y Profesor B en SELECT, INSERT, UPDATE y DELETE.
 * - Prueba la función SQL `public.sync_push` (creación, actualización, idempotencia por op_id,
 *   detección de conflicto de versión y generación de `grade_revisions`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

describe('Esquema PostgreSQL, RLS y RPC sync_push', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();

    // Simulamos el esquema `auth` y el rol `authenticated` de Supabase
    await pg.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE authenticated_anon NOLOGIN;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT USAGE ON SCHEMA auth TO authenticated;
    `);

    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0001_init.sql'),
      'utf8',
    );
    await pg.exec(migrationSql);

    await pg.exec(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    `);
  });

  async function asUser<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) {
    await pg.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
    try {
      return await pg.query<T>(sql, params);
    } finally {
      await pg.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
    }
  }

  it('habilita y fuerza RLS en las 17 tablas del esquema', async () => {
    const res = await pg.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
    expect(res.rows.length).toBe(17);
    for (const row of res.rows) {
      expect(row.relrowsecurity, `${row.relname} debe tener RLS activo`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} debe forzar RLS`).toBe(true);
    }
  });

  it('aísla datos entre dos profesores en SELECT, INSERT, UPDATE y DELETE', async () => {
    const studentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    // Profesora A crea una estudiante
    await asUser(
      USER_A,
      `INSERT INTO public.students (id, owner_id, last_names, first_names) VALUES ($1, $2, 'Alcívar', 'Camila')`,
      [studentId, USER_A],
    );

    // Profesora A puede consultarla
    const seenByA = await asUser(USER_A, `SELECT * FROM public.students`);
    expect(seenByA.rows).toHaveLength(1);

    // Profesor B NO puede ver los estudiantes de la Profesora A
    const seenByB = await asUser(USER_B, `SELECT * FROM public.students`);
    expect(seenByB.rows).toHaveLength(0);

    // Profesor B intenta insertar un registro a nombre de la Profesora A → bloqueado por RLS WITH CHECK
    await expect(
      asUser(
        USER_B,
        `INSERT INTO public.students (id, owner_id, last_names, first_names) VALUES (gen_random_uuid(), $1, 'Intruso', 'Uno')`,
        [USER_A],
      ),
    ).rejects.toThrow(/row-level security/);

    // Profesor B intenta modificar o borrar la estudiante de la Profesora A → 0 filas afectadas
    await asUser(USER_B, `UPDATE public.students SET first_names = 'Modificado' WHERE id = $1`, [studentId]);
    await asUser(USER_B, `DELETE FROM public.students WHERE id = $1`, [studentId]);

    const verifyA = await asUser<{ first_names: string }>(
      USER_A,
      `SELECT first_names FROM public.students WHERE id = $1`,
      [studentId],
    );
    expect(verifyA.rows[0].first_names).toBe('Camila');
  });

  it('ejecuta sync_push con idempotencia, control de versión y registro en grade_revisions', async () => {
    const instId = '10000000-0000-4000-8000-000000000001';
    const yearId = '10000000-0000-4000-8000-000000000002';
    const groupId = '10000000-0000-4000-8000-000000000003';
    const subjId = '10000000-0000-4000-8000-000000000004';
    const schemeId = '10000000-0000-4000-8000-000000000005';
    const assignId = '10000000-0000-4000-8000-000000000006';
    const evalId = '10000000-0000-4000-8000-000000000007';
    const studentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const gradeId = '10000000-0000-4000-8000-000000000008';

    const setupOps = [
      {
        op_id: '20000000-0000-4000-8000-000000000001',
        table: 'institutions',
        record_id: instId,
        base_version: 0,
        device: 'Celular',
        payload: { name: 'Unidad Educativa Ejemplo' },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000002',
        table: 'academic_years',
        record_id: yearId,
        base_version: 0,
        device: 'Celular',
        payload: { institution_id: instId, name: '2026-2027', regime: 'sierra_amazonia', is_active: true },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000003',
        table: 'class_groups',
        record_id: groupId,
        base_version: 0,
        device: 'Celular',
        payload: { academic_year_id: yearId, name: '8.º EGB', parallel: 'A', level: 'egb_superior' },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000004',
        table: 'subjects',
        record_id: subjId,
        base_version: 0,
        device: 'Celular',
        payload: { name: 'Matemática' },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000005',
        table: 'grading_schemes',
        record_id: schemeId,
        base_version: 0,
        device: 'Celular',
        payload: {
          family_id: schemeId,
          scheme_version: 1,
          name: 'Referencia 2025',
          status: 'confirmed',
          source_note: 'Verificado',
          config: { mode: 'quantitative' },
        },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000006',
        table: 'teaching_assignments',
        record_id: assignId,
        base_version: 0,
        device: 'Celular',
        payload: {
          academic_year_id: yearId,
          class_group_id: groupId,
          subject_id: subjId,
          grading_scheme_id: schemeId,
        },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000007',
        table: 'evaluations',
        record_id: evalId,
        base_version: 0,
        device: 'Celular',
        payload: {
          assignment_id: assignId,
          period_id: null,
          category_key: 'formativa',
          name: 'Tarea 1',
          date: '2026-10-10',
          weight: null,
          kind: 'regular',
          sort_order: 1,
        },
      },
      {
        op_id: '20000000-0000-4000-8000-000000000008',
        table: 'grades',
        record_id: gradeId,
        base_version: 0,
        device: 'Celular',
        payload: {
          evaluation_id: evalId,
          student_id: studentId,
          status: 'graded',
          value: '8.75',
          qualitative: null,
        },
      },
    ];

    const push1 = await asUser<{ sync_push: { op_id: string; status: string; version: number }[] }>(
      USER_A,
      `SELECT public.sync_push($1::jsonb)`,
      [JSON.stringify(setupOps)],
    );
    expect(push1.rows[0].sync_push.every((r) => r.status === 'applied' && r.version === 1)).toBe(true);

    // Reintento idempotente con el mismo op_id: devuelve 'applied' v1 sin volver a insertar en grade_revisions
    const retry = await asUser<{ sync_push: { op_id: string; status: string; version: number }[] }>(
      USER_A,
      `SELECT public.sync_push($1::jsonb)`,
      [JSON.stringify([setupOps[7]])],
    );
    expect(retry.rows[0].sync_push[0]).toEqual({
      op_id: '20000000-0000-4000-8000-000000000008',
      status: 'applied',
      version: 1,
    });

    const revAfterRetry = await asUser(USER_A, `SELECT * FROM public.grade_revisions WHERE grade_id = $1`, [gradeId]);
    expect(revAfterRetry.rows).toHaveLength(1);

    // Conflicto: otro dispositivo intenta actualizar con base_version = 0 cuando ya está en versión 1
    const conflictPush = await asUser<{
      sync_push: { op_id: string; status: string; record: { value: string; version: number } }[];
    }>(USER_A, `SELECT public.sync_push($1::jsonb)`, [
      JSON.stringify([
        {
          op_id: '20000000-0000-4000-8000-000000000099',
          table: 'grades',
          record_id: gradeId,
          base_version: 0,
          device: 'Computadora',
          payload: {
            evaluation_id: evalId,
            student_id: studentId,
            status: 'graded',
            value: '9.50',
            qualitative: null,
          },
        },
      ]),
    ]);
    expect(conflictPush.rows[0].sync_push[0].status).toBe('conflict');
    expect(conflictPush.rows[0].sync_push[0].record.value).toBe('8.75');
    expect(conflictPush.rows[0].sync_push[0].record.version).toBe(1);
  });
});

import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/0001_init.sql', 'utf8');
const fn = sql.substring(sql.indexOf('CREATE OR REPLACE FUNCTION public.sync_push'));
const chunkSize = 800;
const chunks = [];
for (let i = 0; i < fn.length; i += chunkSize) {
  chunks.push(fn.substring(i, i + chunkSize));
}
console.log('Total chunks:', chunks.length);
chunks.forEach((c, idx) => {
  const esc = c.replaceAll("'", "''");
  fs.writeFileSync(`chunk_${idx}.sql`, `INSERT INTO public._fn_builder (id, chunk) VALUES (${idx}, '${esc}') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;`, 'utf8');
});

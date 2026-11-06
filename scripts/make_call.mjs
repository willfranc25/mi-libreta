import fs from 'node:fs';

const sql = fs.readFileSync('C:/Users/pilar/.gemini/antigravity/scratch/mi-libreta/supabase/migrations/0001_init.sql', 'utf8');
const fn = sql.substring(sql.indexOf('CREATE OR REPLACE FUNCTION public.sync_push'));
const escaped = fn.replaceAll("'", "''");
const call = `CALL public.exec_sql('${escaped}');`;
fs.writeFileSync('C:/Users/pilar/.gemini/antigravity/scratch/mi-libreta/sync_push_call.sql', call, 'utf8');
console.log('Written sync_push_call.sql, length:', call.length);

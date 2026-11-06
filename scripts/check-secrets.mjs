/**
 * Verifica que el código fuente público no contenga claves secretas de administración
 * (`service_role`, `SUPABASE_SERVICE_ROLE_KEY`, claves privadas PEM o JWT pegados).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [
  /SUPABASE_SERVICE_ROLE/i,
  /service_role/i,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /sb_secret_[a-zA-Z0-9_]+/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|html|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(process.cwd(), 'src'));
let violations = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      console.error(`Secreto o clave administrativa detectada en ${file}: ${pattern}`);
      violations++;
    }
  }
}

if (violations > 0) {
  process.exit(1);
}
console.log(`Verificación de seguridad completada: 0 secretos en ${files.length} archivos de src/.`);

# Despliegue y Configuración de Producción — Mi Libreta

Este documento describe cómo desplegar la base de datos en **Supabase** y la aplicación web instalable (PWA) en cualquier servicio de hosting estático con HTTPS (Cloudflare Pages, Netlify o Vercel).

---

## 1. Preparar la base de datos y autenticación en Supabase

1. Cree un nuevo proyecto en [Supabase](https://supabase.com).
2. En el panel de Supabase, abra **SQL Editor** y ejecute íntegramente el archivo de migración:
   - [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql)
   - Este script crea las 17 tablas relacionales, activa y fuerza **Row Level Security (RLS)** en todas ellas (aislando los datos por `owner_id = auth.uid()`), instala el trigger de auditoría inmutable `grade_revisions` y publica la función RPC `public.sync_push` para sincronización idempotente con control de versiones.
3. En **Authentication → Providers → Email**, habilite el inicio de sesión con correo y contraseña y cree la cuenta de la profesora.
4. En **Project Settings → API**, copie únicamente:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public key` → `VITE_SUPABASE_ANON_KEY`
   - **Advertencia crítica de seguridad:** Nunca copie ni exponga la clave `service_role` en variables `VITE_*` ni en el navegador.

---

## 2. Compilar y verificar antes de desplegar

Ejecute en la raíz del proyecto:

```bash
npm install
npm run check:secrets
npm test
npm run build
```

La carpeta `dist/` contendrá la aplicación lista para producción junto con el `manifest.webmanifest` y el Service Worker (`sw.js`) generado por Workbox.

---

## 3. Publicar en HTTPS (requisito obligatorio para PWA e instalación en Android/Windows)

Configure cualquiera de las siguientes plataformas apuntando al repositorio:

- **Comando de construcción (Build command):** `npm run build`
- **Directorio de salida (Output directory):** `dist`
- **Variables de entorno:**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- **Regla SPA (redirección de rutas):** Todas las rutas (`/libreta`, `/reportes`, `/configuracion`) deben servir `/index.html`.

Una vez publicada bajo HTTPS, el navegador en Android y Windows ofrecerá automáticamente el botón **«Instalar Mi Libreta»** y almacenará todos los recursos estáticos para abrir sin conexión a internet.

# Informe de Funcionalidades Completadas y Limitaciones Verificadas — Mi Libreta

## 1. Funcionalidades completadas y verificadas con pruebas automatizadas

1. **Arquitectura Local-First / Offline-First real (`src/db/`, `src/sync/`):**
   - Base de datos local en IndexedDB gestionada con **Dexie** (`LibretaDB`) con 15 tablas sincronizables, tabla `grade_revisions`, cola durable `outbox` con `op_id` único e idempotente, tabla `conflicts` y tabla `local_revisions` para deshacer modificaciones recientes.
   - Escrituras transaccionales validadas con **Zod** antes de tocar IndexedDB.
   - Indicador permanente y honesto en la cabecera: distingue expresamente **«Guardado en este dispositivo»**, **«Sin internet · Guardado en este dispositivo»**, **«Sincronizando…»**, **«Sincronizado»** (solo tras confirmación del servidor) y alerta de conflictos.

2. **Sincronización multi-dispositivo sin pérdida de datos (`src/sync/engine.ts`):**
   - Las calificaciones utilizan identificadores deterministas UUID v5 (`gradeIdFor(evaluationId, studentId)`), garantizando que una nota para el mismo estudiante y evaluación tenga el mismo UUID en el celular y en la computadora aunque ambos estén sin conexión.
   - Cuando ambos dispositivos modifican la misma nota sin internet con valores distintos, el servidor y el cliente detectan la diferencia de `version` y abren el diálogo **Diferencia encontrada entre dispositivos** (`ConflictModal`), mostrando el valor de cada equipo para que la profesora elija cuál conservar. Nunca se aplica una política ciega de «último cambio gana».
   - Si la respuesta de red se pierde tras enviar un lote, el reintento con el mismo `op_id` es idempotente y no duplica datos ni entradas en `grade_revisions`.

3. **Motor académico configurable, exacto y sin errores de coma flotante (`src/domain/engine.ts`):**
   - Implementado íntegramente con funciones puras y **`decimal.js`** (precisión de 40 dígitos significativos).
   - Incluye como configuración de referencia verificable el **Instructivo de Evaluación Estudiantil del Ecuador 2025** (Evaluación Formativa 70 % + Evaluación Sumativa 30 %, truncamiento estricto a 2 decimales sin redondeo, nota de aprobación 7,00 y elegibilidad a examen supletorio entre 4,01 y 6,99).
   - Incluye configuración cualitativa para **Educación Inicial y Preparatoria** (`I`, `EP`, `A`, `NE`), la cual registra niveles de logro sin generar promedios numéricos inapropiados.
   - Soporta versionado de reglas (`scheme_version`) y bloqueo de regla al cerrar un período académico (`locked_scheme_id`), de modo que un cambio posterior en la regla nunca altera calificaciones históricas de trimestres cerrados.
   - Desglose matemático paso a paso verificable por estudiante en un clic.

4. **Registro de calificaciones optimizado para Celular y Computadora (`src/pages/GradebookPage.tsx`):**
   - **Modo Celular:** selección rápida de curso y evaluación, visualización clara del nombre del estudiante, teclado numérico táctil grande (botones $\ge 44 \times 44\text{ px}$), soporte indistinto de coma o punto decimal (`8,5` o `8.5`), validación inmediata contra la escala configurada, distinción explícita entre **«Sin registrar»**, **«Ausente»**, **«Pendiente»** y nota numérica/cualitativa, y botón **«Guardar y siguiente estudiante»** sin cambiar de pantalla.
   - **Modo Computadora (Tabla):** estudiantes en filas, evaluaciones en columnas, cabeceras fijas, navegación con `Enter`, `Tab` y flechas, pegado directo de rangos de celdas desde Excel, búsqueda, filtro de estudiantes con notas pendientes y botón **«Deshacer último cambio»**.

5. **Reportes, PDF y Compatibilidad con Plantillas Originales de Excel (`src/reports/xlsxExporter.ts`):**
   - Advertencias previas a la generación cuando existen notas pendientes, ausencias, reglas en borrador o conflictos sin resolver.
   - Reporte por curso, resumen por evaluación, boletín individual por estudiante, cuadro anual por períodos, hoja imprimible en PDF y exportación estándar a `.xlsx`.
   - **Inyección XML no destructiva sobre plantillas `.xlsx` del colegio (`fillTemplatePreservingStructure`):** abre el contenedor ZIP de la plantilla original con `fflate`, analiza hojas y fórmulas, actualiza únicamente los nodos `<c>` de las celdas mapeadas en el XML de la hoja y **protege automáticamente cualquier celda que contenga una fórmula (`<f>`)**, conservando intactos celdas combinadas (`<mergeCells>`), estilos, áreas de impresión (`<pageSetup>`), imágenes/escudos y hojas adicionales.

6. **Seguridad, Privacidad (LOPDP Ecuador) y Respaldos Verificados (`supabase/migrations/0001_init.sql`, `src/backup/backup.ts`):**
   - **17 tablas en PostgreSQL** con `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` verificadas automáticamente con **PGlite** para `SELECT`, `INSERT`, `UPDATE` y `DELETE`.
   - Minimización de datos personales de menores de edad: no se solicita cédula, dirección, teléfono ni correo de estudiantes; no se envían datos a servicios de inteligencia artificial.
   - Respaldos manuales completos con firma de integridad **SHA-256** y opción de cifrado autenticado **AES-GCM de 256 bits** (PBKDF2-SHA256 con 150 000 iteraciones).

---

## 2. Limitaciones verificadas y decisiones transparentes

1. **Plantilla Excel oficial definitiva del colegio:**
   - Conforme a las secciones 14, 22 y 26 de la especificación, **no se ha inventado un formato oficial falso**. El módulo de importación, análisis de hojas/fórmulas, configuración de mapeo reutilizable e inyección XML no destructiva está completamente implementado y probado con una plantilla de prueba (`buildSampleSchoolTemplateXlsx`). Una vez que la institución educativa entregue su archivo `.xlsx` oficial, solo se debe cargar en **Reportes → Plantilla oficial de Excel del colegio** y asignar las letras de columna correspondientes.
2. **Formatos antiguos `.xls` binarios (Excel 97-2003):**
   - El procesador no destructivo trabaja sobre el estándar abierto `.xlsx` (OpenXML). Si el colegio entrega una plantilla en formato binario antiguo `.xls`, la profesora deberá abrirla una vez en Excel y guardarla como **Libro de Excel (`.xlsx`)** antes de subirla a Mi Libreta.
3. **Alcance del PIN visual en dispositivos compartidos:**
   - Tal como exige la sección 17 de la especificación, en la interfaz se informa expresamente que el código PIN rápido de bloqueo de pantalla protege frente a miradas accidentales en un equipo compartido, pero **no equivale a cifrado del almacenamiento IndexedDB del navegador**. Para protección criptográfica real se provee el respaldo cifrado con **AES-GCM-256** y se recomienda proteger la sesión del sistema operativo.
4. **Credenciales de Supabase en producción:**
   - No se incluyen credenciales inventadas. Sin variables `.env`, la aplicación funciona al 100 % en modo local offline-first con respaldos exportables; al configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example` y `DESPLIEGUE.md`), se activa la autenticación y sincronización en la nube entre celular y computadora.

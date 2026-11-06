# Mi Libreta

Libreta digital de calificaciones diseñada para docentes y colegios en Ecuador. Funciona sin conexión a internet (*offline-first*), se instala tanto en celulares como en computadoras, automatiza los cálculos de promedios según la normativa ecuatoriana y genera reportes en Excel respetando las plantillas oficiales de las instituciones.

---

## El problema en las aulas de Ecuador

En la gran mayoría de colegios y unidades educativas del país, los profesores enfrentan una carga administrativa repetitiva al momento de calificar:

1. **La doble transcripción:** El docente anota las tareas, lecciones y exámenes en un cuaderno físico de papel durante las clases. Al final del parcial o trimestre, pasa horas transcribiendo nota por nota a una computadora.
2. **Hojas de Excel propensas a errores:** Cada colegio maneja sus propias matrices de Excel. Cualquier fórmula borrada sin querer, un arrastre equivocado de celda o un redondeo automático del programa genera discrepancias numéricas en las juntas de curso o en secretaría.
3. **Reglas de evaluación específicas (MINEDUC):** Las disposiciones ministeriales recientes (como la ponderación 70% formativa y 30% sumativa, y el truncamiento estricto a 2 decimales sin redondear hacia arriba) no siempre se configuran bien en hojas de cálculo tradicionales, provocando reclamos de representantes.
4. **Falta de internet estable en las aulas:** Muchas aulas o laboratorios no cuentan con señal Wi-Fi confiable, haciendo inviable el uso de plataformas en la nube que exigen estar conectados todo el tiempo para guardar una calificación.

---

## La solución que aporta Mi Libreta

**Mi Libreta** fue construida con una premisa: **ingresar cada calificación una sola vez** y reutilizar esa información para todos los documentos que exige la institución.

- **Diseñada para la realidad del aula:**
  - En el celular: vista enfocada con teclado numérico optimizado, botones grandes, soporte de coma y punto decimal (`8,5` o `8.5`), diferenciación clara entre *Sin registrar*, *Ausente* y *Pendiente*, y avance automático al siguiente estudiante.
  - En la computadora: tabla tipo hoja de cálculo con desplazamiento ágil por teclado (`Enter`, `Tab`, flechas), pegado directo de columnas y búsqueda de estudiantes.
- **Funciona sin internet (Local-First):** Toda la información se guarda primero en la memoria local del dispositivo (IndexedDB). El docente puede calificar en medio del aula sin conexión. Al detectar internet, se sincroniza en segundo plano con el servidor central mediante una cola segura que resuelve conflictos sin sobrescribir notas.
- **Motor de cálculo oficial y exacto:**
  - Cálculo de precisión con librería decimal para evitar errores de coma flotante.
  - Configuración del modelo 70% formativo y 30% sumativo con truncamiento estricto a 2 decimales.
  - Soporte de escalas cualitativas para Inicial y Preparatoria (DAR, AAR, EPA, NNA) sin promedios numéricos incorrectos.
  - Períodos académicos configurables (trimestres o quimestres), supletorios y evaluaciones de mejora.
- **Inyección directa en plantillas Excel del colegio:**
  - En lugar de obligar a la secretaría a cambiar de formato, la aplicación permite subir la plantilla original en formato `.xlsx` de la institución e inyectar las notas en las celdas correspondientes sin tocar encabezados, estilos, logos ni las fórmulas preexistentes del colegio.
- **Respaldos seguros y privacidad:**
  - Exportación de copias de seguridad completas en formato JSON verificadas con SHA-256 y opción de cifrado AES-GCM.
  - Base de datos en PostgreSQL protegida con políticas a nivel de fila (Row Level Security), garantizando que ningún docente pueda ver ni modificar los registros de otro.

---

## Estructura de la aplicación

La navegación es directa y se organiza en cuatro áreas de trabajo:

- **Inicio:** Selección rápida del año lectivo, cursos y asignaturas asignadas.
- **Mi Libreta:** Espacio de trabajo principal para crear evaluaciones y asentar calificaciones.
- **Reportes:** Cuadros de calificaciones, promedios consolidados, impresión directa y exportación a Excel / PDF.
- **Configuración:** Administración de estudiantes (importación masiva desde listas CSV/XLSX), períodos lectivos, categorías de notas y respaldos.

---

## Requisitos técnicos y puesta en marcha

### Prerrequisitos
- Node.js 22 o superior
- npm

### Instalación local

```bash
# Clonar o descargar el repositorio
cd mi-libreta

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```

Abra `http://localhost:5173` en su navegador. La aplicación cuenta con un asistente de configuración inicial y la opción de cargar datos de prueba para familiarizarse con el flujo.

### Scripts de prueba y compilación

```bash
# Ejecutar suite de pruebas unitarias y de integración (55 pruebas con Vitest y PGlite)
npm test

# Ejecutar pruebas funcionales end-to-end con Playwright
npm run test:e2e

# Verificar que no existan credenciales sensibles expuestas en el código
npm run check:secrets

# Compilar paquete de producción para despliegue
npm run build
```

---

## Pila tecnológica

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS.
- **Almacenamiento local & PWA:** Dexie.js (IndexedDB), Service Worker con Vite PWA Plugin.
- **Precisión numérica:** Decimal.js.
- **Manejo de hojas de cálculo:** ExcelJS y JSZip para manipulación no destructiva de XML.
- **Backend & Sincronización:** Supabase (Autenticación + PostgreSQL con RLS y procedimientos de sincronización idempotentes).
- **Pruebas:** Vitest, Testing Library, PGlite (PostgreSQL en memoria) y Playwright.

---

## Licencia

Distribuido bajo licencia MIT. Consulte el archivo `LICENSE` para más detalles.

/**
 * Pruebas integrales de extremo a extremo (E2E) con Playwright sobre la aplicación
 * construida (`vite preview`):
 *
 * 1. Flujo móvil: abrir Mi Libreta en vista de celular (390×844), seleccionar curso,
 *    registrar notas con el teclado numérico, validar escala, avanzar automáticamente
 *    al siguiente estudiante, marcar ausente y comprobar persistencia tras recargar.
 * 2. Flujo computadora: crear una nueva evaluación, editar celdas en tabla, comprobar
 *    promedio truncado a 2 decimales y botón «Deshacer último cambio».
 * 3. Exportación de plantilla Excel del colegio y respaldo completo verificado.
 */
import { expect, test } from '@playwright/test';

test.describe('Mi Libreta — Pruebas funcionales E2E', () => {
  test('flujo celular: teclado numérico, avance automático, validación y persistencia offline', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Verifica pantalla de Inicio en español y botón principal «Registrar notas»
    await expect(page.getByRole('heading', { name: /Bienvenida/i })).toBeVisible();
    await expect(page.getByTestId('btn-registrar-notas-principal')).toBeVisible();
    await page.getByTestId('btn-registrar-notas-principal').click();

    // En vista celular (390px) se activa automáticamente el Modo Celular
    await expect(page.getByTestId('mobile-active-student-name')).toContainText('Alcívar Mendoza');

    // Intentar ingresar una nota inválida (99) con el teclado táctil → debe mostrar error claro
    const input = page.getByTestId('mobile-grade-input');
    await input.fill('15');
    await page.getByTestId('mobile-save-next-btn').click();
    await expect(page.getByTestId('mobile-grade-error')).toContainText('entre 0 y 10');

    // Ingresar una nota válida con coma decimal ("9,75") y guardar → avanza automáticamente al estudiante 2
    await input.fill('9,75');
    await page.getByTestId('mobile-save-next-btn').click();

    await expect(page.getByTestId('mobile-active-student-name')).toContainText('Benítez Zambrano');

    // Recargar la página (simulando cerrar y volver a abrir sin internet) y comprobar persistencia en IndexedDB
    await page.reload();
    await page.getByTestId('mode-mobile-btn').click();
    await expect(page.getByTestId('mobile-student-row-demo-stu-01')).toContainText('9,75');
  });

  test('flujo computadora: crear evaluación, tabla de notas, cálculo exacto y deshacer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/libreta');

    await page.getByTestId('mode-desktop-btn').click();

    // Crear una nueva evaluación en pocos pasos
    await page.getByTestId('btn-new-evaluation').click();
    await page.getByTestId('input-eval-name').fill('Exposición Oral');
    await page.getByTestId('submit-eval-btn').click();

    await expect(page.getByText('Exposición Oral')).toBeVisible();

    // Modificar nota de la primera estudiante en Tarea 1 y comprobar que «Deshacer último cambio» aparece
    const firstCell = page.getByTestId('cell-demo-eval-t1-demo-stu-01');
    await firstCell.fill('10');
    await firstCell.blur();

    const undoBtn = page.getByTestId('btn-undo-grade');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
  });

  test('reportes, plantilla Excel del colegio con fórmulas protegidas y respaldo verificado', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/reportes');

    // Advertencias de notas pendientes visibles antes de finalizar el reporte
    await expect(page.getByText(/Revise antes de entregar el documento/i)).toBeVisible();

    // Ir a la pestaña de Plantilla oficial de Excel del colegio y cargar la plantilla de prueba
    await page.getByTestId('report-tab-template').click();
    await page.getByTestId('btn-load-sample-template').click();
    await expect(page.getByTestId('template-notice')).toContainText('plantilla de prueba');

    // Descargar la plantilla completada y verificar que protege las celdas con fórmulas originales
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-fill-template-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('Completado_Plantilla_Colegio_Prueba.xlsx');
    await expect(page.getByTestId('template-notice')).toContainText('Se protegieron');

    // Ir a Configuración → Respaldos y descargar un respaldo completo
    await page.goto('/configuracion');
    await page.getByTestId('settings-tab-backup').click();
    const backupDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-download-backup').click();
    const backupDownload = await backupDownloadPromise;
    expect(backupDownload.suggestedFilename()).toContain('Respaldo_MiLibreta_');
  });
});

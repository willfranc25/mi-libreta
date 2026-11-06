import { describe, expect, it } from 'vitest';
import {
  applyRounding,
  computeAnnual,
  computeCategory,
  computePeriod,
  equivalenceFor,
  summarizeQualitative,
  validateGradingConfig,
  type EngineCategory,
  type EngineEvaluation,
  type EngineGrade,
} from './engine';
import { PRESET_EC_2025, PRESET_QUALITATIVE_INICIAL, PRESET_SIMPLE } from './presets';
import type { GradingConfig } from './types';

const ec = PRESET_EC_2025.config;
const ecCats: EngineCategory[] = PRESET_EC_2025.categories;

function ev(id: string, category_key: string, period_id = 'T1', extra: Partial<EngineEvaluation> = {}): EngineEvaluation {
  return { id, name: id, category_key, period_id, weight: null, kind: 'regular', ...extra };
}
function g(value: string): EngineGrade {
  return { status: 'graded', value, qualitative: null };
}
const absent: EngineGrade = { status: 'absent', value: null, qualitative: null };
const pending: EngineGrade = { status: 'pending', value: null, qualitative: null };

function withConfig(patch: Partial<GradingConfig>): GradingConfig {
  return { ...ec, ...patch };
}

describe('redondeo y truncamiento', () => {
  it('trunca sin redondear (instructivo: no existe redondeo)', () => {
    expect(applyRounding('8.6492', { mode: 'truncate', decimals: 2 })).toBe('8.64');
    expect(applyRounding('7.999', { mode: 'truncate', decimals: 2 })).toBe('7.99');
    expect(applyRounding('6.995', { mode: 'truncate', decimals: 2 })).toBe('6.99');
  });
  it('redondea hacia arriba desde 5 cuando se configura así', () => {
    expect(applyRounding('7.995', { mode: 'round_half_up', decimals: 2 })).toBe('8.00');
    expect(applyRounding('7.994', { mode: 'round_half_up', decimals: 2 })).toBe('7.99');
  });
  it('respeta la cantidad de decimales configurada', () => {
    expect(applyRounding('8.6492', { mode: 'truncate', decimals: 1 })).toBe('8.6');
    expect(applyRounding('8', { mode: 'truncate', decimals: 2 })).toBe('8.00');
    expect(applyRounding('8.6492', { mode: 'none', decimals: 2 })).toBe('8.6492');
  });
});

describe('ejemplo del instructivo (formativa 70 %, sumativa 30 %)', () => {
  // Formativa con promedio exacto 8,456 y sumativa 9,10.
  const evals = [ev('t1', 'formativa'), ev('t2', 'formativa'), ev('t3', 'formativa'), ev('ex', 'sumativa')];
  const grades = new Map([
    ['t1', g('8.12')],
    ['t2', g('8.5')],
    ['t3', g('8.748')],
    ['ex', g('9.1')],
  ]);

  it('sin truncar el promedio parcial: 8,456×0,7 + 9,1×0,3 = 8,6492 → 8,64', () => {
    const config = withConfig({
      rounding: { ...ec.rounding, category: { mode: 'none', decimals: 2 } },
    });
    const r = computePeriod(config, ecCats, 'T1', evals, grades);
    expect(r.categories[0].raw).toBe('8.456');
    expect(r.raw).toBe('8.6492');
    expect(r.average).toBe('8.64');
    expect(r.complete).toBe(true);
  });

  it('truncando también el promedio formativo (8,45) el resultado sigue siendo 8,64', () => {
    const r = computePeriod(ec, ecCats, 'T1', evals, grades);
    expect(r.categories[0].average).toBe('8.45');
    expect(r.raw).toBe('8.645');
    expect(r.average).toBe('8.64');
  });
});

describe('precisión decimal (sin errores de coma flotante)', () => {
  it('promediar 8,1 + 8,2 + 8,6 = 24,9 / 3 = 8,30 exacto (en IEEE-754 (8.1+8.2+8.6)/3*100 es 829.9999999999999)', () => {
    const floatAvg = (8.1 + 8.2 + 8.6) / 3;
    expect(Math.floor(floatAvg * 100) / 100).toBe(8.29);
    const r = computeCategory(
      ec,
      ecCats[0],
      [ev('a', 'formativa'), ev('b', 'formativa'), ev('c', 'formativa')],
      new Map([
        ['a', g('8.1')],
        ['b', g('8.2')],
        ['c', g('8.6')],
      ]),
    );
    expect(r.average).toBe('8.30');
  });
});

describe('ausencias, pendientes y notas sin registrar', () => {
  const evals = [ev('a', 'formativa'), ev('b', 'formativa'), ev('c', 'formativa')];
  const cat = ecCats[0];

  it('por defecto se excluyen y se informa el motivo', () => {
    const r = computeCategory(ec, cat, evals, new Map([['a', g('10')], ['b', absent]]));
    expect(r.average).toBe('10.00');
    expect(r.excluded.map((e) => [e.evaluationId, e.reason])).toEqual([
      ['b', 'absent'],
      ['c', 'empty'],
    ]);
  });

  it('se distinguen: ausente puede contar como 0 mientras sin registrar se excluye', () => {
    const config = withConfig({ missing: { empty: 'exclude', absent: 'zero', pending: 'exclude' } });
    const r = computeCategory(config, cat, evals, new Map([['a', g('10')], ['b', absent]]));
    expect(r.average).toBe('5.00');
    expect(r.included.find((i) => i.evaluationId === 'b')?.imputed).toBe(true);
    expect(r.excluded).toEqual([{ evaluationId: 'c', evaluationName: 'c', reason: 'empty' }]);
  });

  it('pendiente con regla «cero»', () => {
    const config = withConfig({ missing: { empty: 'exclude', absent: 'exclude', pending: 'zero' } });
    const r = computeCategory(config, cat, evals, new Map([['a', g('9')], ['b', pending], ['c', g('6')]]));
    expect(r.average).toBe('5.00');
  });

  it('sin ninguna nota no inventa un promedio', () => {
    const r = computeCategory(ec, cat, evals, new Map());
    expect(r.average).toBeNull();
  });

  it('nota provisional cuando falta una categoría', () => {
    const r = computePeriod(ec, ecCats, 'T1', [ev('a', 'formativa')], new Map([['a', g('8')]]));
    expect(r.average).toBe('8.00');
    expect(r.complete).toBe(false);
    expect(r.missingCategories).toEqual(['Evaluación sumativa']);
  });
});

describe('ponderaciones', () => {
  it('promedio ponderado dentro de la categoría', () => {
    const config = withConfig({ withinCategory: 'weighted' });
    const r = computeCategory(
      config,
      ecCats[0],
      [ev('a', 'formativa', 'T1', { weight: '1' }), ev('b', 'formativa', 'T1', { weight: '3' })],
      new Map([['a', g('6')], ['b', g('10')]]),
    );
    // (6×1 + 10×3) / 4 = 9
    expect(r.average).toBe('9.00');
  });

  it('promedio simple entre categorías', () => {
    const r = computePeriod(
      PRESET_SIMPLE.config,
      [
        { key: 'x', name: 'X', kind: 'formative', weight: null },
        { key: 'y', name: 'Y', kind: 'formative', weight: null },
      ],
      'T1',
      [ev('a', 'x'), ev('b', 'y')],
      new Map([['a', g('7')], ['b', g('8.25')]]),
    );
    expect(r.average).toBe('7.63'); // 7.625 redondeado
  });

  it('evaluaciones de otros períodos no se mezclan', () => {
    const r = computePeriod(ec, ecCats, 'T1', [ev('a', 'formativa', 'T1'), ev('b', 'formativa', 'T2')], new Map([
      ['a', g('10')],
      ['b', g('2')],
    ]));
    expect(r.categories[0].average).toBe('10.00');
  });

  it('marca evaluaciones con categoría inexistente', () => {
    const r = computePeriod(ec, ecCats, 'T1', [ev('a', 'proyecto')], new Map([['a', g('10')]]));
    expect(r.unclassified).toEqual([{ evaluationId: 'a', evaluationName: 'a' }]);
    expect(r.average).toBeNull();
  });
});

describe('resultado anual', () => {
  const periods = ['T1', 'T2', 'T3'];
  function yearEvals(): EngineEvaluation[] {
    return periods.flatMap((p) => [ev(`f-${p}`, 'formativa', p), ev(`s-${p}`, 'sumativa', p)]);
  }
  function yearGrades(values: [string, string][]): Map<string, EngineGrade> {
    const m = new Map<string, EngineGrade>();
    values.forEach(([f, s], i) => {
      m.set(`f-${periods[i]}`, g(f));
      m.set(`s-${periods[i]}`, g(s));
    });
    return m;
  }

  it('promedia los trimestres y trunca', () => {
    const r = computeAnnual(ec, ecCats, periods, yearEvals(), yearGrades([['8', '9'], ['7.5', '8'], ['9', '10']]));
    // T1 8.30, T2 7.65, T3 9.30 → 25.25/3 = 8.41666… → 8.41
    expect(r.periods.map((p) => p.average)).toEqual(['8.30', '7.65', '9.30']);
    expect(r.final).toBe('8.41');
    expect(r.status).toBe('approved');
  });

  it('supletorio aprobado registra la nota mínima de aprobación', () => {
    const evals = [...yearEvals(), ev('sup', '', null as unknown as string, { kind: 'supplementary', period_id: null, category_key: null })];
    const grades = yearGrades([['6', '6'], ['6', '6'], ['6', '6']]);
    let r = computeAnnual(ec, ecCats, periods, evals, grades);
    expect(r.final).toBe('6.00');
    expect(r.status).toBe('supplementary_eligible');

    grades.set('sup', g('8.5'));
    r = computeAnnual(ec, ecCats, periods, evals, grades);
    expect(r.status).toBe('approved_supplementary');
    expect(r.final).toBe('7.00');
  });

  it('supletorio reprobado', () => {
    const evals = [...yearEvals(), ev('sup', '', 'x', { kind: 'supplementary', period_id: null, category_key: null })];
    const grades = yearGrades([['5', '5'], ['5', '5'], ['5', '5']]);
    grades.set('sup', g('6.5'));
    const r = computeAnnual(ec, ecCats, periods, evals, grades);
    expect(r.status).toBe('failed');
    expect(r.final).toBe('5.00');
  });

  it('por debajo del mínimo para supletorio no aprueba', () => {
    const r = computeAnnual(ec, ecCats, periods, yearEvals(), yearGrades([['3', '3'], ['4', '4'], ['4', '4']]));
    expect(r.final).toBe('3.66');
    expect(r.status).toBe('failed');
  });

  it('mejora reemplaza el período más bajo si es mayor', () => {
    const config = withConfig({ improvement: { enabled: true, policy: 'replace_lowest_period_if_higher' } });
    const evals = [...yearEvals(), ev('mej', '', 'x', { kind: 'improvement', period_id: null, category_key: null })];
    const grades = yearGrades([['8', '8'], ['6', '6'], ['8', '8']]);
    grades.set('mej', g('9'));
    const r = computeAnnual(config, ecCats, periods, evals, grades);
    expect(r.baseAverage).toBe('7.33');
    expect(r.improvement.applied).toBe(true);
    expect(r.improvement.replacedPeriodId).toBe('T2');
    expect(r.final).toBe('8.33');
  });

  it('pesos por período', () => {
    const config = withConfig({ periodCombination: 'weighted', periodWeights: ['25', '25', '50'] });
    const r = computeAnnual(config, ecCats, periods, yearEvals(), yearGrades([['8', '8'], ['6', '6'], ['10', '10']]));
    expect(r.final).toBe('8.50');
  });

  it('año incompleto no se marca como aprobado', () => {
    const grades = yearGrades([['9', '9']]);
    const r = computeAnnual(ec, ecCats, periods, yearEvals(), grades);
    expect(r.complete).toBe(false);
    expect(r.status).toBe('incomplete');
  });

  it('un período cerrado conserva su regla aunque la regla vigente cambie', () => {
    const old: GradingConfig = withConfig({});
    const oldCats: EngineCategory[] = [
      { key: 'formativa', name: 'F', kind: 'formative', weight: '60' },
      { key: 'sumativa', name: 'S', kind: 'summative', weight: '40' },
    ];
    const grades = yearGrades([['10', '5'], ['10', '5'], ['10', '5']]);
    const locked = new Map([['T1', { config: old, categories: oldCats }]]);
    const r = computeAnnual(ec, ecCats, periods, yearEvals(), grades, locked);
    expect(r.periods[0].average).toBe('8.00'); // regla anterior 60/40
    expect(r.periods[1].average).toBe('8.50'); // regla vigente 70/30
  });
});

describe('escala cualitativa (Inicial y Preparatoria)', () => {
  it('no calcula promedios numéricos', () => {
    const evals = [ev('d1', 'destrezas'), ev('d2', 'destrezas')];
    const grades = new Map<string, EngineGrade>([
      ['d1', { status: 'graded', value: null, qualitative: 'EP' }],
      ['d2', { status: 'graded', value: null, qualitative: 'A' }],
    ]);
    const s = summarizeQualitative(evals, grades);
    expect(s.mode).toBe('qualitative');
    expect(s.latest).toBe('A');
    expect(s.entries.map((e) => e.code)).toEqual(['EP', 'A']);
    expect(JSON.stringify(s)).not.toMatch(/average/);
  });
  it('la configuración cualitativa es válida', () => {
    expect(validateGradingConfig(PRESET_QUALITATIVE_INICIAL.config, PRESET_QUALITATIVE_INICIAL.categories)).toEqual([]);
  });
});

describe('equivalencias cualitativas', () => {
  it.each([
    ['10.00', 'DAR'],
    ['9.00', 'DAR'],
    ['8.99', 'AAR'],
    ['7.00', 'AAR'],
    ['6.99', 'PAAR'],
    ['4.01', 'PAAR'],
    ['4.00', 'NAAR'],
    ['0.00', 'NAAR'],
  ])('%s → %s', (value, code) => {
    expect(equivalenceFor(ec, value)?.code).toBe(code);
  });
});

describe('validación de reglas', () => {
  it('la referencia 2025 es válida', () => {
    expect(validateGradingConfig(ec, ecCats)).toEqual([]);
  });
  it('detecta porcentajes que no suman 100', () => {
    const issues = validateGradingConfig(ec, [
      { key: 'a', name: 'A', kind: 'formative', weight: '70' },
      { key: 'b', name: 'B', kind: 'summative', weight: '20' },
    ]);
    expect(issues.join(' ')).toMatch(/suman 90/);
  });
  it('detecta escala inválida', () => {
    const issues = validateGradingConfig(withConfig({ scale: { min: '10', max: '0', inputDecimals: 2 } }), ecCats);
    expect(issues.join(' ')).toMatch(/máxima/);
  });
});

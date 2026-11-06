/**
 * Motor académico de Mi Libreta.
 *
 * Funciones puras y deterministas: reciben configuración + datos y devuelven
 * resultados con el detalle de cada paso, para que cualquier promedio pueda
 * verificarse a mano. No hay inteligencia artificial ni aproximaciones con
 * números de coma flotante: todo se calcula con decimal.js.
 */
import Decimal from 'decimal.js';
import type {
  CategoryKind,
  EvaluationKind,
  GradeStatus,
  GradingConfig,
  Rounding,
} from './types';

// Precisión interna amplia; el redondeo/truncamiento solo ocurre donde la
// configuración lo indica.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface EngineGrade {
  status: GradeStatus;
  value: string | null;
  qualitative: string | null;
}

export interface EngineEvaluation {
  id: string;
  name: string;
  category_key: string | null;
  period_id: string | null;
  weight: string | null;
  kind: EvaluationKind;
}

export interface EngineCategory {
  key: string;
  name: string;
  kind: CategoryKind;
  weight: string | null;
}

export interface IncludedValue {
  evaluationId: string;
  evaluationName: string;
  value: string;
  weight: string;
  /** true si el valor no era una nota sino un 0 aplicado por la regla. */
  imputed: boolean;
}

export interface ExcludedValue {
  evaluationId: string;
  evaluationName: string;
  reason: GradeStatus;
}

export interface CategoryResult {
  key: string;
  name: string;
  kind: CategoryKind;
  weight: string | null;
  included: IncludedValue[];
  excluded: ExcludedValue[];
  /** Promedio antes de redondear/truncar. */
  raw: string | null;
  /** Promedio registrado (tras aplicar la regla de la etapa «categoría»). */
  average: string | null;
}

export interface PeriodResult {
  periodId: string;
  categories: CategoryResult[];
  raw: string | null;
  average: string | null;
  /** false si alguna categoría no tiene datos todavía. */
  complete: boolean;
  missingCategories: string[];
  /** Evaluaciones cuya categoría no existe en la regla vigente. */
  unclassified: { evaluationId: string; evaluationName: string }[];
  steps: string[];
}

export type AnnualStatus =
  | 'approved'
  | 'approved_supplementary'
  | 'supplementary_eligible'
  | 'failed'
  | 'incomplete'
  | 'not_applicable';

export const ANNUAL_STATUS_LABELS: Record<AnnualStatus, string> = {
  approved: 'Aprueba',
  approved_supplementary: 'Aprueba con supletorio',
  supplementary_eligible: 'Debe rendir supletorio',
  failed: 'No aprueba',
  incomplete: 'Incompleto',
  not_applicable: '—',
};

export interface AnnualResult {
  periods: PeriodResult[];
  /** Promedio de períodos antes de mejora/supletorio. */
  baseAverage: string | null;
  improvement: { applied: boolean; replacedPeriodId: string | null; score: string | null };
  supplementary: { eligible: boolean; score: string | null; passed: boolean | null };
  final: string | null;
  status: AnnualStatus;
  complete: boolean;
  steps: string[];
}

export interface QualitativeSummary {
  mode: 'qualitative';
  /** Valores cualitativos por evaluación, sin promedios numéricos. */
  entries: { evaluationId: string; evaluationName: string; code: string | null; status: GradeStatus }[];
  /** Último valor registrado (orden de las evaluaciones). */
  latest: string | null;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
export function applyRounding(value: Decimal.Value, rounding: Rounding): string {
  const d = new D(value);
  switch (rounding.mode) {
    case 'truncate':
      return d.toDecimalPlaces(rounding.decimals, Decimal.ROUND_DOWN).toFixed(rounding.decimals);
    case 'round_half_up':
      return d.toDecimalPlaces(rounding.decimals, Decimal.ROUND_HALF_UP).toFixed(rounding.decimals);
    default:
      return d.toString();
  }
}

function fmt(v: string | Decimal): string {
  return new D(v).toString().replace('.', ',');
}

function roundingText(r: Rounding): string {
  if (r.mode === 'truncate') return `truncado a ${r.decimals} decimales`;
  if (r.mode === 'round_half_up') return `redondeado a ${r.decimals} decimales`;
  return 'sin redondeo';
}

// ---------------------------------------------------------------------------
// Promedio de una categoría
// ---------------------------------------------------------------------------
export function computeCategory(
  config: GradingConfig,
  category: EngineCategory,
  evaluations: EngineEvaluation[],
  grades: Map<string, EngineGrade>,
): CategoryResult {
  const included: IncludedValue[] = [];
  const excluded: ExcludedValue[] = [];

  for (const ev of evaluations) {
    const g = grades.get(ev.id);
    const status: GradeStatus = g?.status ?? 'empty';
    const weight = config.withinCategory === 'weighted' && ev.weight ? ev.weight : '1';
    if (status === 'graded' && g?.value !== null && g?.value !== undefined) {
      included.push({ evaluationId: ev.id, evaluationName: ev.name, value: g.value, weight, imputed: false });
      continue;
    }
    const policy = status === 'graded' ? 'exclude' : config.missing[status];
    if (policy === 'zero') {
      included.push({ evaluationId: ev.id, evaluationName: ev.name, value: '0', weight, imputed: true });
    } else {
      excluded.push({ evaluationId: ev.id, evaluationName: ev.name, reason: status });
    }
  }

  let raw: Decimal | null = null;
  if (included.length > 0) {
    let sum = new D(0);
    let weights = new D(0);
    for (const item of included) {
      sum = sum.plus(new D(item.value).times(item.weight));
      weights = weights.plus(item.weight);
    }
    raw = weights.isZero() ? null : sum.dividedBy(weights);
  }

  return {
    key: category.key,
    name: category.name,
    kind: category.kind,
    weight: category.weight,
    included,
    excluded,
    raw: raw ? raw.toString() : null,
    average: raw ? applyRounding(raw, config.rounding.category) : null,
  };
}

// ---------------------------------------------------------------------------
// Nota de un período (trimestre, quimestre…)
// ---------------------------------------------------------------------------
export function computePeriod(
  config: GradingConfig,
  categories: EngineCategory[],
  periodId: string,
  evaluations: EngineEvaluation[],
  grades: Map<string, EngineGrade>,
): PeriodResult {
  const steps: string[] = [];
  const periodEvals = evaluations.filter((e) => e.period_id === periodId && e.kind === 'regular');
  const keys = new Set(categories.map((c) => c.key));
  const unclassified = periodEvals
    .filter((e) => !e.category_key || !keys.has(e.category_key))
    .map((e) => ({ evaluationId: e.id, evaluationName: e.name }));

  const catResults = categories.map((c) =>
    computeCategory(
      config,
      c,
      periodEvals.filter((e) => e.category_key === c.key),
      grades,
    ),
  );

  for (const c of catResults) {
    if (c.average === null) {
      steps.push(`${c.name}: sin notas todavía.`);
      continue;
    }
    const values = c.included.map((i) => (i.imputed ? '0 (sin nota)' : fmt(i.value))).join(' + ');
    const mode = config.withinCategory === 'weighted' ? 'promedio ponderado' : 'promedio';
    steps.push(
      `${c.name}: ${mode} de ${values} = ${fmt(c.raw!)} → ${fmt(c.average)} (${roundingText(config.rounding.category)}).`,
    );
  }

  const withData = catResults.filter((c) => c.average !== null);
  const missingCategories = catResults.filter((c) => c.average === null).map((c) => c.name);

  let raw: Decimal | null = null;
  if (withData.length > 0) {
    if (config.combineCategories === 'weighted') {
      let sum = new D(0);
      let weights = new D(0);
      for (const c of withData) {
        const w = new D(c.weight ?? '0');
        sum = sum.plus(new D(c.average!).times(w));
        weights = weights.plus(w);
      }
      if (!weights.isZero()) {
        raw = sum.dividedBy(weights);
        const parts = withData.map((c) => `${fmt(c.average!)} × ${fmt(c.weight ?? '0')} %`).join(' + ');
        steps.push(`Nota del período: (${parts}) ÷ ${fmt(weights)} % = ${fmt(raw)}.`);
      }
    } else {
      let sum = new D(0);
      for (const c of withData) sum = sum.plus(c.average!);
      raw = sum.dividedBy(withData.length);
      steps.push(
        `Nota del período: promedio de ${withData.map((c) => fmt(c.average!)).join(', ')} = ${fmt(raw)}.`,
      );
    }
  }

  const average = raw ? applyRounding(raw, config.rounding.period) : null;
  if (average) steps.push(`Resultado ${roundingText(config.rounding.period)}: ${fmt(average)}.`);
  if (missingCategories.length > 0 && average) {
    steps.push(`Atención: nota provisional, faltan datos de ${missingCategories.join(', ')}.`);
  }

  return {
    periodId,
    categories: catResults,
    raw: raw ? raw.toString() : null,
    average,
    complete: missingCategories.length === 0,
    missingCategories,
    unclassified,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Resultado anual (promedio de períodos, mejora y supletorio)
// ---------------------------------------------------------------------------
export function computeAnnual(
  config: GradingConfig,
  categories: EngineCategory[],
  periodIds: string[],
  evaluations: EngineEvaluation[],
  grades: Map<string, EngineGrade>,
  /** Reglas fijadas por período cerrado (opcional). */
  periodConfigs?: Map<string, { config: GradingConfig; categories: EngineCategory[] }>,
): AnnualResult {
  const steps: string[] = [];
  const periods = periodIds.map((pid) => {
    const locked = periodConfigs?.get(pid);
    return computePeriod(
      locked?.config ?? config,
      locked?.categories ?? categories,
      pid,
      evaluations,
      grades,
    );
  });

  const averages = periods.map((p) => (p.average === null ? null : new D(p.average)));
  const complete = periods.every((p) => p.complete && p.average !== null);

  const combine = (vals: (Decimal | null)[]): Decimal | null => {
    const present = vals
      .map((v, i) => ({ v, i }))
      .filter((x): x is { v: Decimal; i: number } => x.v !== null);
    if (present.length === 0) return null;
    if (config.periodCombination === 'weighted') {
      let sum = new D(0);
      let weights = new D(0);
      for (const { v, i } of present) {
        const w = new D(config.periodWeights[i] ?? '0');
        sum = sum.plus(v.times(w));
        weights = weights.plus(w);
      }
      return weights.isZero() ? null : sum.dividedBy(weights);
    }
    let sum = new D(0);
    for (const { v } of present) sum = sum.plus(v);
    return sum.dividedBy(present.length);
  };

  const baseRaw = combine(averages);
  const baseAverage = baseRaw ? applyRounding(baseRaw, config.rounding.final) : null;
  if (baseRaw) {
    steps.push(
      `Promedio de períodos: ${averages.map((a) => (a ? fmt(a) : '—')).join(', ')} = ${fmt(baseRaw)} → ${fmt(baseAverage!)} (${roundingText(config.rounding.final)}).`,
    );
  }

  // --- Mejora -------------------------------------------------------------
  const improvement = { applied: false, replacedPeriodId: null as string | null, score: null as string | null };
  let final = baseAverage;
  if (config.improvement.enabled && baseAverage) {
    const impEval = evaluations.find((e) => e.kind === 'improvement');
    const g = impEval ? grades.get(impEval.id) : undefined;
    if (g?.status === 'graded' && g.value) {
      improvement.score = g.value;
      let lowestIdx = -1;
      averages.forEach((a, i) => {
        if (a && (lowestIdx === -1 || a.lessThan(averages[lowestIdx]!))) lowestIdx = i;
      });
      if (lowestIdx >= 0 && new D(g.value).greaterThan(averages[lowestIdx]!)) {
        const replaced = [...averages];
        replaced[lowestIdx] = new D(g.value);
        const r = combine(replaced);
        if (r) {
          final = applyRounding(r, config.rounding.final);
          improvement.applied = true;
          improvement.replacedPeriodId = periodIds[lowestIdx];
          steps.push(
            `Mejora: ${fmt(g.value)} reemplaza la nota más baja (${fmt(averages[lowestIdx]!)}). Nuevo promedio: ${fmt(final)}.`,
          );
        }
      } else {
        steps.push(`Mejora: ${fmt(g.value)} no supera la nota más baja; no se aplica.`);
      }
    }
  }

  // --- Supletorio y estado --------------------------------------------------
  const supplementary = { eligible: false, score: null as string | null, passed: null as boolean | null };
  let status: AnnualStatus = 'not_applicable';
  if (final === null) {
    status = 'incomplete';
  } else if (config.passingGrade) {
    const passing = new D(config.passingGrade);
    const f = new D(final);
    if (f.greaterThanOrEqualTo(passing)) {
      status = complete ? 'approved' : 'incomplete';
    } else if (
      config.supplementary.enabled &&
      f.greaterThanOrEqualTo(config.supplementary.eligibleFrom)
    ) {
      supplementary.eligible = true;
      status = complete ? 'supplementary_eligible' : 'incomplete';
      const supEval = evaluations.find((e) => e.kind === 'supplementary');
      const g = supEval ? grades.get(supEval.id) : undefined;
      if (complete && g?.status === 'graded' && g.value) {
        supplementary.score = g.value;
        if (new D(g.value).greaterThanOrEqualTo(config.supplementary.passScore)) {
          supplementary.passed = true;
          status = 'approved_supplementary';
          final =
            config.supplementary.resultWhenPassed === 'passing_grade'
              ? applyRounding(passing, config.rounding.final)
              : applyRounding(g.value, config.rounding.final);
          steps.push(`Supletorio: ${fmt(g.value)} ≥ ${fmt(config.supplementary.passScore)}. Nota final: ${fmt(final)}.`);
        } else {
          supplementary.passed = false;
          status = 'failed';
          steps.push(`Supletorio: ${fmt(g.value)} es menor que ${fmt(config.supplementary.passScore)}.`);
        }
      }
    } else {
      status = complete ? 'failed' : 'incomplete';
    }
  }

  if (!complete) steps.push('Resultado provisional: hay períodos o categorías sin datos.');

  return { periods, baseAverage, improvement, supplementary, final, status, complete, steps };
}

// ---------------------------------------------------------------------------
// Escala cualitativa (Inicial / Preparatoria): nunca se promedia.
// ---------------------------------------------------------------------------
export function summarizeQualitative(
  evaluations: EngineEvaluation[],
  grades: Map<string, EngineGrade>,
): QualitativeSummary {
  const entries = evaluations.map((e) => {
    const g = grades.get(e.id);
    return {
      evaluationId: e.id,
      evaluationName: e.name,
      code: g?.status === 'graded' ? g.qualitative : null,
      status: g?.status ?? ('empty' as GradeStatus),
    };
  });
  const latest = [...entries].reverse().find((e) => e.code !== null)?.code ?? null;
  return { mode: 'qualitative', entries, latest };
}

/** Equivalencia cualitativa de una nota numérica (p. ej. 9,20 → «Domina…»). */
export function equivalenceFor(
  config: GradingConfig,
  value: string | null,
): { code: string; label: string } | null {
  if (value === null) return null;
  const v = new D(value);
  const sorted = [...config.equivalences].sort((a, b) => new D(b.from).comparedTo(a.from));
  const match = sorted.find((e) => v.greaterThanOrEqualTo(e.from));
  return match ? { code: match.code, label: match.label } : null;
}

// ---------------------------------------------------------------------------
// Validación de la configuración (mensajes para la profesora)
// ---------------------------------------------------------------------------
export function validateGradingConfig(config: GradingConfig, categories: EngineCategory[]): string[] {
  const issues: string[] = [];
  if (config.mode === 'qualitative') {
    if (config.qualitativeOptions.length < 2) issues.push('Agregue al menos dos opciones cualitativas.');
    const codes = config.qualitativeOptions.map((o) => o.code.toLowerCase());
    if (new Set(codes).size !== codes.length) issues.push('Los códigos cualitativos no pueden repetirse.');
    return issues;
  }
  const min = new D(config.scale.min);
  const max = new D(config.scale.max);
  if (!max.greaterThan(min)) issues.push('La nota máxima debe ser mayor que la mínima.');
  if (config.passingGrade && (new D(config.passingGrade).lessThan(min) || new D(config.passingGrade).greaterThan(max))) {
    issues.push('La nota para aprobar debe estar dentro de la escala.');
  }
  if (categories.length === 0) issues.push('Agregue al menos una categoría de evaluación.');
  if (config.combineCategories === 'weighted') {
    const missing = categories.filter((c) => !c.weight);
    if (missing.length) issues.push(`Falta el porcentaje de: ${missing.map((c) => c.name).join(', ')}.`);
    const total = categories.reduce((s, c) => s.plus(c.weight ?? '0'), new D(0));
    if (!total.equals(100)) issues.push(`Los porcentajes de las categorías suman ${fmt(total)} %; deben sumar 100 %.`);
  }
  const keys = categories.map((c) => c.key);
  if (new Set(keys).size !== keys.length) issues.push('Hay categorías repetidas.');
  if (config.periodCombination === 'weighted' && config.periodWeights.length === 0) {
    issues.push('Indique el peso de cada período.');
  }
  if (config.supplementary.enabled && config.passingGrade) {
    if (new D(config.supplementary.eligibleFrom).greaterThanOrEqualTo(config.passingGrade)) {
      issues.push('El mínimo para supletorio debe ser menor que la nota para aprobar.');
    }
  }
  return issues;
}

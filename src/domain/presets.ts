/**
 * Plantillas de reglas de calificación.
 *
 * IMPORTANTE: son puntos de partida de REFERENCIA. Se crean como «borrador»
 * y la profesora debe confirmarlas con su institución antes de usarlas en
 * documentos oficiales. No se asume que una regla sea universal.
 */
import type { CategoryKind, GradingConfig } from './types';

export interface SchemePreset {
  id: string;
  name: string;
  description: string;
  sourceNote: string;
  config: GradingConfig;
  categories: { key: string; name: string; kind: CategoryKind; weight: string | null }[];
}

const truncate2 = { mode: 'truncate', decimals: 2 } as const;

export const ECUADOR_EQUIVALENCES = [
  { from: '9', to: '10', code: 'DAR', label: 'Domina los aprendizajes requeridos' },
  { from: '7', to: '8.99', code: 'AAR', label: 'Alcanza los aprendizajes requeridos' },
  { from: '4.01', to: '6.99', code: 'PAAR', label: 'Está próximo a alcanzar los aprendizajes requeridos' },
  { from: '0', to: '4', code: 'NAAR', label: 'No alcanza los aprendizajes requeridos' },
];

export const PRESET_EC_2025: SchemePreset = {
  id: 'ec-2025-formativa-sumativa',
  name: 'Formativa 70 % · Sumativa 30 % (referencia Ecuador 2025)',
  description:
    'Escala de 0 a 10. Evaluación formativa 70 % y sumativa 30 %. Resultados truncados a dos decimales, sin redondeo. Aprueba con 7.',
  sourceNote:
    'Referencia: Instructivo de evaluación estudiantil del Ministerio de Educación del Ecuador (2025) para determinados niveles. Verifique con su institución antes de confirmar.',
  config: {
    mode: 'quantitative',
    scale: { min: '0', max: '10', inputDecimals: 2 },
    qualitativeOptions: [],
    equivalences: ECUADOR_EQUIVALENCES,
    passingGrade: '7',
    withinCategory: 'simple',
    combineCategories: 'weighted',
    missing: { empty: 'exclude', absent: 'exclude', pending: 'exclude' },
    rounding: { category: truncate2, period: truncate2, final: truncate2 },
    periodCombination: 'simple',
    periodWeights: [],
    improvement: { enabled: false, policy: 'replace_lowest_period_if_higher' },
    supplementary: {
      enabled: true,
      eligibleFrom: '4.01',
      passScore: '7',
      resultWhenPassed: 'passing_grade',
    },
  },
  categories: [
    { key: 'formativa', name: 'Evaluación formativa', kind: 'formative', weight: '70' },
    { key: 'sumativa', name: 'Evaluación sumativa', kind: 'summative', weight: '30' },
  ],
};

export const PRESET_QUALITATIVE_INICIAL: SchemePreset = {
  id: 'ec-inicial-preparatoria-cualitativa',
  name: 'Cualitativa: Inicial y Preparatoria (referencia)',
  description:
    'Registro de destrezas con escala cualitativa (Iniciado, En proceso, Adquirido, No evaluado). No calcula promedios numéricos.',
  sourceNote:
    'Referencia: escala cualitativa usada en Educación Inicial y Preparatoria. Verifique los códigos con su institución.',
  config: {
    mode: 'qualitative',
    scale: { min: '0', max: '10', inputDecimals: 0 },
    qualitativeOptions: [
      { code: 'I', label: 'Iniciado' },
      { code: 'EP', label: 'En proceso' },
      { code: 'A', label: 'Adquirido' },
      { code: 'NE', label: 'No evaluado' },
    ],
    equivalences: [],
    passingGrade: null,
    withinCategory: 'simple',
    combineCategories: 'simple',
    missing: { empty: 'exclude', absent: 'exclude', pending: 'exclude' },
    rounding: { category: truncate2, period: truncate2, final: truncate2 },
    periodCombination: 'simple',
    periodWeights: [],
    improvement: { enabled: false, policy: 'replace_lowest_period_if_higher' },
    supplementary: { enabled: false, eligibleFrom: '0', passScore: '0', resultWhenPassed: 'passing_grade' },
  },
  categories: [{ key: 'destrezas', name: 'Destrezas', kind: 'formative', weight: null }],
};

export const PRESET_SIMPLE: SchemePreset = {
  id: 'promedio-simple',
  name: 'Promedio simple (personalizable)',
  description: 'Escala de 0 a 10. Todas las notas valen lo mismo. Redondeo a dos decimales.',
  sourceNote: 'Regla personalizada. Ajústela a las indicaciones de su institución.',
  config: {
    mode: 'quantitative',
    scale: { min: '0', max: '10', inputDecimals: 2 },
    qualitativeOptions: [],
    equivalences: ECUADOR_EQUIVALENCES,
    passingGrade: '7',
    withinCategory: 'simple',
    combineCategories: 'simple',
    missing: { empty: 'exclude', absent: 'exclude', pending: 'exclude' },
    rounding: {
      category: { mode: 'round_half_up', decimals: 2 },
      period: { mode: 'round_half_up', decimals: 2 },
      final: { mode: 'round_half_up', decimals: 2 },
    },
    periodCombination: 'simple',
    periodWeights: [],
    improvement: { enabled: false, policy: 'replace_lowest_period_if_higher' },
    supplementary: { enabled: false, eligibleFrom: '4.01', passScore: '7', resultWhenPassed: 'passing_grade' },
  },
  categories: [{ key: 'actividades', name: 'Actividades', kind: 'formative', weight: null }],
};

export const SCHEME_PRESETS = [PRESET_EC_2025, PRESET_QUALITATIVE_INICIAL, PRESET_SIMPLE];

/** Sugerencia de regla según el nivel del curso. */
export function suggestedPresetForLevel(level: string): SchemePreset {
  return level === 'inicial' || level === 'preparatoria' ? PRESET_QUALITATIVE_INICIAL : PRESET_EC_2025;
}

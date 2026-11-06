import { describe, expect, it } from 'vitest';
import { formatDecimal, gradeDisplay, parseGradeInput } from './gradeInput';
import { PRESET_EC_2025, PRESET_QUALITATIVE_INICIAL } from './presets';

const q = PRESET_EC_2025.config;
const ql = PRESET_QUALITATIVE_INICIAL.config;

describe('lectura de notas', () => {
  it('acepta coma o punto decimal', () => {
    expect(parseGradeInput('8,5', q)).toMatchObject({ ok: true, status: 'graded', value: '8.5' });
    expect(parseGradeInput('8.5', q)).toMatchObject({ ok: true, status: 'graded', value: '8.5' });
    expect(parseGradeInput(' 10 ', q)).toMatchObject({ ok: true, value: '10' });
    expect(parseGradeInput(',5', q)).toMatchObject({ ok: true, value: '0.5' });
    expect(parseGradeInput('7,25', q)).toMatchObject({ ok: true, value: '7.25' });
  });
  it('rechaza valores fuera de la escala', () => {
    expect(parseGradeInput('10,01', q)).toMatchObject({ ok: false });
    expect(parseGradeInput('11', q)).toMatchObject({ ok: false, error: 'La nota debe estar entre 0 y 10' });
    expect(parseGradeInput('-1', q)).toMatchObject({ ok: false });
  });
  it('rechaza texto y formatos ambiguos', () => {
    expect(parseGradeInput('ocho', q).ok).toBe(false);
    expect(parseGradeInput('8,5,1', q).ok).toBe(false);
    expect(parseGradeInput('8.', q).ok).toBe(false);
    expect(parseGradeInput('1e1', q).ok).toBe(false);
  });
  it('rechaza más decimales de los permitidos', () => {
    expect(parseGradeInput('8,555', q)).toMatchObject({ ok: false, error: 'Use máximo 2 decimales' });
  });
  it('distingue sin registrar, ausente y pendiente', () => {
    expect(parseGradeInput('', q)).toMatchObject({ ok: true, status: 'empty' });
    expect(parseGradeInput('a', q)).toMatchObject({ ok: true, status: 'absent' });
    expect(parseGradeInput('Aus', q)).toMatchObject({ ok: true, status: 'absent' });
    expect(parseGradeInput('p', q)).toMatchObject({ ok: true, status: 'pending' });
  });
  it('escala cualitativa usa códigos y no confunde «A» con ausente', () => {
    expect(parseGradeInput('a', ql)).toMatchObject({ ok: true, status: 'graded', qualitative: 'A' });
    expect(parseGradeInput('ep', ql)).toMatchObject({ ok: true, status: 'graded', qualitative: 'EP' });
    expect(parseGradeInput('aus', ql)).toMatchObject({ ok: true, status: 'absent' });
    expect(parseGradeInput('8', ql)).toMatchObject({ ok: false });
  });
});

describe('presentación', () => {
  it('usa coma decimal', () => {
    expect(formatDecimal('8.5')).toBe('8,5');
    expect(formatDecimal('8.5', 2)).toBe('8,50');
    expect(formatDecimal(null)).toBe('');
  });
  it('muestra estados', () => {
    expect(gradeDisplay({ status: 'absent', value: null, qualitative: null })).toBe('Aus.');
    expect(gradeDisplay({ status: 'empty', value: null, qualitative: null })).toBe('');
    expect(gradeDisplay(undefined)).toBe('');
  });
});

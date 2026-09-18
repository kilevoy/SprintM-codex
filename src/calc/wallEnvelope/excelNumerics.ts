/**
 * Числовые повадки Excel, без которых не сходится паритет.
 *
 * Excel хранит числа в обычном double, но перед ОКРВВЕРХ/ОКРУГЛ приводит
 * значение к 15 значащим десятичным цифрам. Из-за этого `4,2/1,4` для него
 * ровно 3, а для IEEE754 — 3,0000000000000004, и «наивный» Math.ceil даёт
 * на единицу больше.
 *
 * Поймано на сценарии стены 30×4,2 при шаге 1400 мм: Excel считал 2 ряда
 * прогонов (TQ3), а расчёт без этой поправки — 3, из-за чего расходились
 * выбранный шаг и кронштейн. См.
 * scripts/oracle/compare_wall_envelope_calculator.mjs.
 */

/** Приведение к 15 значащим цифрам — то, что Excel делает перед округлением. */
export function toExcelPrecision(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(15));
}

/** ОКРВВЕРХ.МАТ(значение; 1). */
export function excelCeiling(value: number): number {
  return Math.ceil(toExcelPrecision(value));
}

/** ОКРУГЛ(значение; знаков) — для положительных значений совпадает с half-up. */
export function excelRound(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(toExcelPrecision(value * factor)) / factor;
}

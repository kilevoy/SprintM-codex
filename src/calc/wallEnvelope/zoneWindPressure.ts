/**
 * Коэффициент ветровой нагрузки зоны стены (C3 на листах «Расчет Угловая» и
 * «Расчет Рядовая» книги «Калькулятор ограждайки v1.5.xlsx»).
 *
 * Цепочка исходника ('Ветер по СП'):
 *   C8  = MAX(5; Лист1!B8)                -- высота по коньку, не ниже 5 м
 *   C9  = Лист1!B17                       -- w0 ветрового района, кПа
 *   C11 = k(ze)                           -- по высоте и типу местности
 *   C12 = ζ(ze)                           -- коэффициент пульсации
 *   C13 = γf = 1,4
 *   F6  = 2,2 (угловая зона) / G6 = 1,4 (рядовая зона) -- пиковые
 *         аэродинамические коэффициенты, «без ν» (см. подпись F4)
 *   F7  = C9*C11*(1+C12)*F6*C13           -- угловая зона
 *   G7  = C9*C11*(1+C12)*G6*C13           -- рядовая зона
 * и уже на расчётном листе:
 *   C3  = F7 (или G7) * Лист1!B3          -- B3 = γn
 *
 * Обе таблицы — СП 20.13330 (11.2 для k и 11.4 для ζ); в книге они
 * интерполируются линейно внутри отрезка, в который попала высота
 * (блоки «Интерполяция» N52:P63 и W52:AB63 + MATCH с приближённым поиском).
 */

export type TerrainType = "A" | "B" | "C";

/** γf — коэффициент надёжности по ветровой нагрузке ('Ветер по СП'!C13). */
const GAMMA_F = 1.4;

/** Пиковые аэродинамические коэффициенты зон ('Ветер по СП'!F6/G6). */
const PEAK_COEFFICIENT: Record<WallZone, number> = {
  corner: 2.2,
  regular: 1.4,
};

/** Минимальная расчётная высота ('Ветер по СП'!C8 = MAX(5; h)). */
const MIN_HEIGHT_m = 5;

export type WallZone = "corner" | "regular";

/** Высоты обеих таблиц СП, м ('Ветер по СП'!J52:J64 и R52:R64). */
const TABLE_HEIGHTS_m = [5, 10, 20, 40, 60, 80, 100, 150, 200, 250, 300, 350, 480];

/** k(ze) — СП 20.13330, таблица 11.2 ('Ветер по СП'!K52:M64). */
const HEIGHT_FACTOR: Record<TerrainType, number[]> = {
  A: [0.75, 1.0, 1.25, 1.5, 1.7, 1.85, 2.0, 2.25, 2.45, 2.65, 2.75, 2.75, 2.75],
  B: [0.5, 0.65, 0.85, 1.1, 1.3, 1.45, 1.6, 1.9, 2.1, 2.3, 2.5, 2.75, 2.75],
  C: [0.4, 0.4, 0.55, 0.8, 1.0, 1.15, 1.25, 1.55, 1.8, 2.0, 2.2, 2.35, 2.75],
};

/** ζ(ze) — СП 20.13330, таблица 11.4 ('Ветер по СП'!S52:U64). */
const PULSATION_FACTOR: Record<TerrainType, number[]> = {
  A: [0.85, 0.76, 0.69, 0.62, 0.58, 0.56, 0.54, 0.51, 0.49, 0.47, 0.46, 0.46, 0.46],
  B: [1.22, 1.06, 0.92, 0.8, 0.74, 0.7, 0.67, 0.62, 0.58, 0.56, 0.54, 0.52, 0.5],
  C: [1.78, 1.78, 1.5, 1.26, 1.14, 1.06, 1.0, 0.9, 0.84, 0.8, 0.76, 0.73, 0.68],
};

/**
 * Линейная интерполяция внутри отрезка таблицы, в который попала высота.
 * Выше последней строки таблицы (480 м) исходник даёт #ССЫЛКА!; здесь
 * значение фиксируется на последней строке — высота ангара до неё не
 * доходит, а NaN дальше по расчёту хуже любой границы.
 */
function interpolateByHeight(table: number[], height_m: number): number {
  if (height_m <= TABLE_HEIGHTS_m[0]) return table[0];
  const last = TABLE_HEIGHTS_m.length - 1;
  if (height_m >= TABLE_HEIGHTS_m[last]) return table[last];
  let i = 0;
  while (TABLE_HEIGHTS_m[i + 1] <= height_m) i += 1;
  const h0 = TABLE_HEIGHTS_m[i];
  const h1 = TABLE_HEIGHTS_m[i + 1];
  return table[i] + ((table[i + 1] - table[i]) * (height_m - h0)) / (h1 - h0);
}

/** k(ze) — высотный коэффициент ('Ветер по СП'!C11). */
export function windHeightFactor(ridgeHeight_m: number, terrain: TerrainType): number {
  return interpolateByHeight(HEIGHT_FACTOR[terrain], Math.max(MIN_HEIGHT_m, ridgeHeight_m));
}

/** ζ(ze) — коэффициент пульсации давления ('Ветер по СП'!C12). */
export function windPulsationFactor(ridgeHeight_m: number, terrain: TerrainType): number {
  return interpolateByHeight(PULSATION_FACTOR[terrain], Math.max(MIN_HEIGHT_m, ridgeHeight_m));
}

export interface ZoneWindPressureInput {
  /** w0 ветрового района, кПа (Лист1!B17 = 'Ветер по СП'!C9). */
  w0_kPa: number;
  /** Высота по коньку, м (Лист1!B8); ниже 5 м не опускается. */
  ridgeHeight_m: number;
  terrain: TerrainType;
  /** γn — коэффициент надёжности по ответственности (Лист1!B3). */
  gammaN: number;
  zone: WallZone;
}

/**
 * C3 расчётного листа — множитель, на который затем умножается
 * аэродинамический коэффициент по тяготеющей ширине (AD4) при расчёте
 * изгибающего момента прогона.
 */
export function zoneWindPressureFactor(input: ZoneWindPressureInput): number {
  const k = windHeightFactor(input.ridgeHeight_m, input.terrain);
  const zeta = windPulsationFactor(input.ridgeHeight_m, input.terrain);
  return input.w0_kPa * k * (1 + zeta) * PEAK_COEFFICIENT[input.zone] * GAMMA_F * input.gammaN;
}

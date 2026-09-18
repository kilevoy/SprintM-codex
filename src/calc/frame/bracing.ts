import type { Span } from "../../types/common";

/** Погонный вес квадратной трубы, т/п.м (ячейки L83:L85 ведомости). */
const TUBE_MASS_t_per_m = {
  "60х3": 0.00525,
  "80х3": 0.0072,
  "120х3": 0.011,
} as const;

export type StrutTube = keyof typeof TUBE_MASS_t_per_m;

/** Погонный вес уголка, т/п.м (столбец J ведомости, строки 85–97). */
const ANGLE_MASS_t_per_m = {
  "63х5": 0.00481,
  "80х4": 0.0096,
  "160х4": 0.0194,
} as const;

/**
 * Цены за тонну. Источник — «Прайс для предрасчетов (не изменять).xlsx»,
 * лист «Перекупные», цены от 02.09.2026. Лист даёт ДВЕ строки на каждую
 * позицию, и это важно:
 *
 *              нелегированная   легированная
 *   Лист          137 770         145 480
 *   Труба         136 050         150 420
 *   Уголок        165 600         172 500
 *
 * ВНИМАНИЕ: труба и лист ниже взяты из нелегированной строки, а уголок —
 * из ЛЕГИРОВАННОЙ. Значение унаследовано из ведомости 22316 и совпадает
 * с сегодняшней ценой легированного уголка ровно. Действительно ли
 * уголок легированный — вопрос 11 расчётчику; на 21876 разница между
 * строками даёт 3 187 ₽, на крупных объектах больше.
 */
const PRICE_per_t = {
  tube: 136050,
  angle: 172500,
  plate: 137770,
} as const;

/**
 * «Вес фасонок на раму», кг (ячейка M87 ведомости — вбита вручную).
 *
 * Это «металлоемкость узловых пластин» ВЫБРАННОЙ строки банка сечений:
 * "22316" (18м, k=0,8, с/в 4/1) — 264 в банке и 264 в ведомости;
 * "22318" (15м, k=1,0, с/в 4/1) — 238 и 238. Поэтому основной источник —
 * банк, а эта таблица остаётся запасной на случай, когда строки нет.
 */
const GUSSET_MASS_PER_FRAME_kg: Partial<Record<Span, number>> = {
  15: 238,
  18: 264,
};

/** Связи, для которых горизонтальные и вертикальные диагонали всегда труба 80х3 (L85). */
const BRACE_TUBE: StrutTube = "80х3";
/** Надбавка на раскрой/стыки диагоналей — 1,1 в обеих ведомостях. */
const BRACE_ALLOWANCE = 1.1;

/**
 * Коэффициент горизонтальных связей (сколько связей на здание) — зависит
 * от пролёта, не от габаритов конкретного объекта.
 *
 * Объяснение расчётчика (вопрос 02): «В расчётах 22316, 22318, 22285
 * пролёт больше 12 м, соответственно мы не можем поделить горизонтальные
 * связи на 2 по 6 м, а в расчётах 22326 и 22329 пролёт меньше 12 м, и
 * поэтому получается по 2 горизонтальные связи с каждой стороны». То
 * есть при пролёте ≤ 12 м здание укладывается в один шестиметровый
 * полупролёт с каждой стороны конька — связей вдвое меньше.
 *
 * Подтверждено на пяти реальных проектах: 18/15/18 м (все > 12) → 8;
 * 10,4 и 12 м (оба ≤ 12) → 4.
 */
function horizBraceCoef(span_m: number): number {
  return span_m <= 12 ? 4 : 8;
}

/**
 * Длина одной горизонтальной связи (гипотенуза) — тоже зависит от той же
 * границы, что и их количество, и не совпадение: связей вдвое меньше,
 * потому что каждая идёт на вдвое большее горизонтальное расстояние.
 *
 * Катет — не всегда пролёт/4. Подтверждено раздельно на двух реальных
 * проектах, где катет и шаг рам не совпадают числом (иначе было бы не
 * различить катет от шага под корнем):
 *   «22285» (пролёт 18 > 12, шаг 4): L92 = √(4,5² + 4²) = 6,0208 —
 *     катет 4,5 = пролёт/4, а не пролёт/2 (9).
 *   «21987» (пролёт 12 ≤ 12, шаг 4,5): L92 = √(6² + 4,5²) = 7,5 —
 *     катет 6 = пролёт/2, а не пролёт/4 (3).
 */
function horizBraceRun_m(span_m: number): number {
  return span_m <= 12 ? span_m / 2 : span_m / 4;
}

export interface BracingInput {
  span_m: Span;
  length_m: number;
  height_m: number;
  /** Шаг рам, м. */
  framePitch_m: number;
  frameCount: number;
  /** «Количество распорок из трубы» (K95) — вбито вручную, 3 в обоих проектах. */
  tubeStrutCount?: number;
  /** Труба распорок: 80х3 в "22316", 60х3 в "22318" — выбирается вручную. */
  strutTube?: StrutTube;
  /**
   * Слагаемое, вписанное в формулу руками: 0,432 т в "22316" и 0,795 т
   * в "22318". Правила для него не найдено — см. вопрос расчётчику.
   */
  extraTubeMass_t?: number;
  /**
   * Периметр обрамления оконных проёмов, п.м (L156) — уже с округлением
   * ширины вверх до кратного шагу рам, см. windowFramingPerimeter_m.
   */
  windowFramingPerimeter_m?: number;
  /** «Металлоемкость узловых пластин» из выбранной строки банка сечений, кг на раму. */
  gussetMassPerFrame_kg?: number | null;
}

export interface BracingItem {
  name: string;
  /** Количество, т. */
  mass_t: number | null;
  unitPrice_per_t: number;
  cost: number | null;
  /** Из чего сложилась масса — для показа и сверки. */
  breakdown?: { name: string; mass_t: number }[];
}

export interface BracingTakeoff {
  items: BracingItem[];
  totalMass_kg: number | null;
  /** Стоимость без накладных — накладные 2% начисляются на весь раздел F85:F98. */
  totalCost: number | null;
  /** Чего не хватает, если раздел неполный. */
  missing?: string;
}

/**
 * Связи, распорки и фасонки — строки 96–98 ведомости («Конструкции из
 * труб», «Уголок», «Лист»).
 *
 * Формулы сняты с обеих реальных ведомостей и воспроизводятся точно:
 *
 *   Конструкции из труб (т) =
 *       4 × (высота + 0,5) × 0,0194            стойки, уголок 160х4
 *     + масса_трубы × распорок × длина          распорки
 *     + 2×к(пролёт) × √((пролёт/4)² + шаг²) × 0,0072 × 1,1   горизонтальные связи
 *     +  4 × √(высота²    + шаг²) × 0,0072 × 1,1   вертикальные связи
 *     + ручная добавка
 *     + 0,0096 × периметр обрамления окон        уголок 80х4
 *
 * к(пролёт) — 4 при пролёте ≤ 12 м, 8 при пролёте больше (см.
 * horizBraceCoef): при пролёте ≤ 12 м здание укладывается в один
 * шестиметровый полупролёт с каждой стороны конька, связей нужно вдвое
 * меньше.
 *
 *   Уголок (т) = (рам − 2) × пролёт × 2 × 0,00481
 *
 *   Лист (т)   = рам × вес_фасонок_на_раму / 1000
 *
 * Сверка: "22316" (18×30, h5, шаг 4,5, 8 рам, распорки 80х3, добавка
 * 0,432 т, окно 30 м → обрамление 31,5 м, периметр 65 м) → 3,1503 т /
 * 1,0390 т / 2,112 т. Файл в этом месте хранит периметр как 62 м (окно
 * 30 м как есть, без округления до кратного шагу) — расчётчик
 * подтвердила, что это ошибка файла (вопрос 01), поэтому с ним мы
 * расходимся здесь намеренно, см. computeProject.test.ts.
 * "22318" (15×24, h5, шаг 4, 7 рам, распорки 60х3, добавка 0,795 т,
 * окон нет) → 2,4974 т / 0,7215 т / 1,666 т.
 *
 * ЧТО ЗАДАЁТСЯ ВРУЧНУЮ И ПРАВИЛА ДЛЯ ЭТОГО НЕТ:
 *   · слагаемое 0,432 / 0,795 т — зависимости от габаритов не видно;
 *   · размер трубы распорок (80х3 против 60х3);
 *   · их количество (3 в обоих проектах).
 *
 * «Вес фасонок на раму» руки не требует: это «металлоемкость узловых
 * пластин» выбранной строки банка сечений (см. gussetMassPerFrame_kg).
 *
 * Катет горизонтальной связи взят как пролёт/4 при пролёте больше 12 м
 * и пролёт/2 при пролёте ≤ 12 м (см. horizBraceRun_m) — та же граница,
 * что и у количества связей, и по той же причине: связей вдвое меньше,
 * значит каждая перекрывает вдвое большее расстояние.
 */
export function computeBracing(input: BracingInput): BracingTakeoff {
  const strutTube = input.strutTube ?? BRACE_TUBE;
  const strutCount = input.tubeStrutCount ?? 3;
  const extra_t = input.extraTubeMass_t ?? 0;
  const windowPerimeter_m = input.windowFramingPerimeter_m ?? 0;

  const braceTube_t_per_m = TUBE_MASS_t_per_m[BRACE_TUBE];
  const horizBraceLength_m = Math.hypot(horizBraceRun_m(input.span_m), input.framePitch_m);
  const vertBraceLength_m = Math.hypot(input.height_m, input.framePitch_m);

  const tubeParts = [
    {
      name: "Стойки (уголок 160х4)",
      mass_t: 4 * (input.height_m + 0.5) * ANGLE_MASS_t_per_m["160х4"],
    },
    {
      name: `Распорки (труба ${strutTube})`,
      mass_t: TUBE_MASS_t_per_m[strutTube] * strutCount * input.length_m,
    },
    {
      name: "Горизонтальные связи",
      mass_t: 2 * horizBraceCoef(input.span_m) * horizBraceLength_m * braceTube_t_per_m * BRACE_ALLOWANCE,
    },
    {
      name: "Вертикальные связи",
      mass_t: 4 * vertBraceLength_m * braceTube_t_per_m * BRACE_ALLOWANCE,
    },
    { name: "Добавка (вручную)", mass_t: extra_t },
    {
      name: "Обрамление окон (уголок 80х4)",
      mass_t: ANGLE_MASS_t_per_m["80х4"] * windowPerimeter_m,
    },
  ];

  const tubeMass_t = tubeParts.reduce((s, p) => s + p.mass_t, 0);
  const angleMass_t =
    (input.frameCount - 2) * input.span_m * 2 * ANGLE_MASS_t_per_m["63х5"];

  const gusset_kg = input.gussetMassPerFrame_kg ?? GUSSET_MASS_PER_FRAME_kg[input.span_m] ?? null;
  const plateMass_t = gusset_kg === null ? null : (input.frameCount * gusset_kg) / 1000;

  const items: BracingItem[] = [
    {
      name: "Конструкции из труб",
      mass_t: tubeMass_t,
      unitPrice_per_t: PRICE_per_t.tube,
      cost: tubeMass_t * PRICE_per_t.tube,
      breakdown: tubeParts.filter((p) => p.mass_t > 0),
    },
    {
      name: "Уголок",
      mass_t: angleMass_t,
      unitPrice_per_t: PRICE_per_t.angle,
      cost: angleMass_t * PRICE_per_t.angle,
    },
    {
      name: "Лист (фасонки)",
      mass_t: plateMass_t,
      unitPrice_per_t: PRICE_per_t.plate,
      cost: plateMass_t === null ? null : plateMass_t * PRICE_per_t.plate,
    },
  ];

  const incomplete = items.some((i) => i.cost === null);

  return {
    items,
    totalMass_kg: incomplete
      ? null
      : items.reduce((s, i) => s + (i.mass_t ?? 0), 0) * 1000,
    totalCost: incomplete ? null : items.reduce((s, i) => s + (i.cost ?? 0), 0),
    missing: incomplete ? "вес узловых пластин (нет в банке сечений)" : undefined,
  };
}

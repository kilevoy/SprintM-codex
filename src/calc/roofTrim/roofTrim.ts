import type { BuildingGeometry } from "../geometry/types";

export interface RoofTrimItem {
  name: string;
  count: number;
  unit: string;
  unitMass_kg: number;
  unitPrice: number;
  mass_kg: number;
  cost: number;
}

export interface RoofTrimTakeoff {
  items: RoofTrimItem[];
  subtotalCost: number;
  /** Накладные расходы, ₽ — 2% от суммы позиций (строка "Накладные расходы:" в исходной ведомости). */
  overheadCost: number;
  totalCost: number;
  totalMass_kg: number;
}

/** Накладные расходы на раздел "Кровля" — 0,02 в обоих реальных проектах. */
const OVERHEAD_RATE = 0.02;

/**
 * Масса и цена единицы — раздел "Кровля" (доборные элементы).
 *
 * Значения закэшированы в обеих реальных ведомостях ("22316" и "22318",
 * лист "12м", столбцы E и H, строки 72–79) и полностью совпадают.
 * Ссылаются на внешний прайс "[2]Профлист,доборы".
 *
 * ВРЕМЕННОЕ РЕШЕНИЕ: как и в остальных разделах, цены взяты из кэша
 * ведомостей, чтобы итог можно было сверить с расчётом расчётчика
 * позиция в позицию; на актуальный прайс переводим после совпадения.
 *
 * У уплотнителя в исходнике масса не указана — считаем её нулевой,
 * чтобы итог по массе совпадал с ведомостью.
 */
const TRIM_UNITS = {
  sheet07: { name: "Лист 0,7мм оц", unit: "м²", unitMass_kg: 5.6, unitPrice: 603.84 },
  ridgeCap: { name: "Конёк плоский (2м)", unit: "шт.", unitMass_kg: 1.7, unitPrice: 1692 },
  gable: { name: "Фронтон (2м)", unit: "шт.", unitMass_kg: 1.662, unitPrice: 732 },
  snowGuard: { name: "Снегозадержатель", unit: "шт.", unitMass_kg: 4, unitPrice: 1807 },
  sealant: { name: "Уплотнитель (2м)", unit: "шт.", unitMass_kg: 0, unitPrice: 612 },
} as const;

export interface RoofTrimOptions {
  /**
   * Снегозадержатель. В исходнике это множитель 0/1 у строки 78, который
   * расчётчик ставит вручную; на листе "вывод" подборщика ему
   * соответствует поле "Прогон под снегозадержание" (есть/нет).
   * В проекте "22316" (Березовский) включён, в "22318" (Сургут) — нет.
   */
  snowGuards: boolean;
  /**
   * Стены обшиты профнастилом. Влияет только на коэффициент листа 0,7:
   * 1,11 под профнастилом против 1,10 под сэндвичем.
   */
  wallIsProfnastil?: boolean;
}

/**
 * Ведомость доборных элементов кровли.
 *
 * Формулы подтверждены дословным совпадением в обеих реальных
 * ведомостях ("22316" и "22318", лист "12м", строки 72–81):
 *
 *   Лист 0,7мм оц      = длина × 0,5 × 1,1         (под сэндвичем)
 *                      = длина × 0,5 × 1,11        (под профнастилом)
 *   Конёк плоский (2м) = ВВЕРХ(длина / 1,9)       (шт)
 *   Фронтон (2м)       = ВВЕРХ(2 × пролёт / 1,8)  (шт)
 *   Снегозадержатель   = 2 × длина / 1,4          (шт, если включён)
 *   Уплотнитель (2м)   = 2 × конёк                (шт)
 *
 * КОЭФФИЦИЕНТ ЛИСТА зависит от обшивки и разделён ровно по семи книгам,
 * все по активному листу:
 *
 *   1,10   22316, 22318, 22326, 22285   — сэндвич
 *   1,11   21876, 22258, 22304          — профнастил
 *
 * Разница копеечная (на 21876 это 92,38 ₽ с накладными), но она была
 * единственным расхождением раздела «Кровля» после сверки с 21876!F82.
 *
 * Позиции "вент. Конька", "С-18 0,5мм" и "С-44 0,7мм" в обоих проектах
 * умножены на 0 (профлистовые варианты обшивки не применяются, здание
 * из сэндвич-панелей) — поэтому здесь их нет.
 *
 * Контрольные значения: 22316 (18×30, снегозадержатель есть) ->
 * 151 676,26 ₽ / 202,5 кг; 22318 (15×24, без снегозадержателя) ->
 * 59 489,14 ₽ / 124,3 кг.
 */
export function computeRoofTrim(
  geometry: Pick<BuildingGeometry, "span_m" | "length_m">,
  options: RoofTrimOptions,
): RoofTrimTakeoff {
  const { span_m, length_m } = geometry;

  const ridgeCap = Math.ceil(length_m / 1.9);

  const counts: [keyof typeof TRIM_UNITS, number][] = [
    ["sheet07", length_m * 0.5 * (options.wallIsProfnastil ? 1.11 : 1.1)],
    ["ridgeCap", ridgeCap],
    ["gable", Math.ceil((2 * span_m) / 1.8)],
    ["snowGuard", options.snowGuards ? (2 * length_m) / 1.4 : 0],
    ["sealant", 2 * ridgeCap],
  ];

  const items: RoofTrimItem[] = counts.map(([key, count]) => {
    const { name, unit, unitMass_kg, unitPrice } = TRIM_UNITS[key];
    return {
      name,
      count,
      unit,
      unitMass_kg,
      unitPrice,
      mass_kg: count * unitMass_kg,
      cost: count * unitPrice,
    };
  });

  const subtotalCost = items.reduce((sum, i) => sum + i.cost, 0);
  const overheadCost = subtotalCost * OVERHEAD_RATE;

  return {
    items,
    subtotalCost,
    overheadCost,
    totalCost: subtotalCost + overheadCost,
    totalMass_kg: items.reduce((sum, i) => sum + i.mass_kg, 0),
  };
}

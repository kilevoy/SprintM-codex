import type { BuildingGeometry } from "../geometry/types";

export interface WallTrimItem {
  name: string;
  count: number;
  unit: string;
  unitMass_kg: number;
  unitPrice: number;
  mass_kg: number;
  cost: number;
}

export interface WallTrimTakeoff {
  items: WallTrimItem[];
  subtotalCost: number;
  /** Накладные расходы, ₽ — 2% от суммы позиций. */
  overheadCost: number;
  totalCost: number;
  totalMass_kg: number;
}

/** Накладные расходы на раздел "Стены" — 0,02 в обоих реальных проектах. */
const OVERHEAD_RATE = 0.02;

/**
 * Масса и цена единицы — раздел "Стены" (строки 38–39 ведомости).
 * Значения закэшированы в обеих реальных ведомостях и совпадают.
 *
 * ВРЕМЕННОЕ РЕШЕНИЕ: цены, как и в остальных разделах, взяты из кэша
 * ведомости, чтобы итог сходился с расчётом расчётчика позиция в
 * позицию; на актуальный прайс переводим после полной сверки.
 */
const TRIM_UNITS = {
  innerAngle: { name: "У.115 внутренний (2м)", unit: "шт", unitMass_kg: 0.9, unitPrice: 800 },
  outerAngle: { name: "У.115 наружный (2м)", unit: "шт", unitMass_kg: 2.3, unitPrice: 800 },
} as const;

/**
 * Под профлистом идут другие уголки — «Уголок 50х50», элемент
 * ТРЁХметровый, поэтому делитель 2,9, а не 1,9 (те же 10 см на нахлёст).
 *
 * Цена наружного зависит от покрытия: 640 ₽ окрашенный (21876, 21604),
 * 440 ₽ оцинкованный (22258). Входа «покрытие стен» в SprintM пока нет —
 * обшивка везде считается окрашенной, поэтому здесь тоже 640.
 */
const PROFNASTIL_TRIM_UNITS = {
  innerAngle: { name: "Уголок 50х50 вн", unit: "шт", unitMass_kg: 0.9, unitPrice: 640 },
  outerAngle: { name: "Уголок 50х50 нар", unit: "шт", unitMass_kg: 2.3, unitPrice: 640 },
} as const;

/** Рабочая длина элемента, м: 2 м у У.115 и 3 м у уголка 50х50, минус нахлёст. */
const USABLE_LENGTH_m = { sandwich: 1.9, profnastil: 2.9 } as const;

/**
 * Ведомость раздела "Стены" — угловые доборные элементы.
 *
 * Формулы подтверждены дословным совпадением в обеих реальных
 * ведомостях ("22316" и "22318", лист "12м", строки 38–44):
 *
 *   У.115 внутренний = (3 × длина + 2 × пролёт) / 1,9
 *   У.115 наружный   = 4 × высота / 1,9
 *
 * Делитель 1,9 — рабочая длина элемента: сам элемент двухметровый, 10см
 * уходит на нахлёст.
 *
 * Остальные строки раздела (ПС 245х65, ПС 145 окрашенные, С-18, КФ) в
 * обоих проектах обнулены, поэтому сюда не входят. За счёт этого раздел
 * воспроизводится целиком: 62 703,16 ₽ для "22316" и 52 395,79 ₽ для
 * "22318" — значения ячейки F44.
 */
export function computeWallTrim(
  geometry: Pick<BuildingGeometry, "span_m" | "length_m" | "height_m">,
  options: { wallIsProfnastil?: boolean } = {},
): WallTrimTakeoff {
  const { span_m, length_m, height_m } = geometry;
  const wallIsProfnastil = options.wallIsProfnastil === true;
  const units = wallIsProfnastil ? PROFNASTIL_TRIM_UNITS : TRIM_UNITS;
  const usable = wallIsProfnastil ? USABLE_LENGTH_m.profnastil : USABLE_LENGTH_m.sandwich;

  // Внутренний уголок под профлистом не считается: во всех трёх
  // профлистовых ведомостях внутренней обшивки нет, и формула дописана
  // множителем 0 на 21876 и 22258. На 21604 множитель не дописан и
  // уголок посчитан (62 шт) — формула там та же самая, так что это
  // похоже на недосмотр, а не на другое правило. Вопрос расчётчику.
  const counts: [keyof typeof TRIM_UNITS, number][] = [
    ["innerAngle", wallIsProfnastil ? 0 : (3 * length_m + 2 * span_m) / usable],
    ["outerAngle", (4 * height_m) / usable],
  ];

  const items: WallTrimItem[] = counts.map(([key, count]) => {
    const { name, unit, unitMass_kg, unitPrice } = units[key];
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

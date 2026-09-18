import type { BuildingGeometry } from "./types";

export interface FrameExtraItem {
  name: string;
  count: number;
  unit: string;
  unitMass_kg: number;
  unitPrice: number;
  mass_kg: number;
  cost: number;
}

export interface FrameExtrasTakeoff {
  items: FrameExtraItem[];
  totalMass_kg: number;
  totalCost: number;
}

/**
 * Масса и цена единицы — прочие профили раздела "Каркас" (строки 26–28
 * ведомости). Значения закэшированы в обеих реальных ведомостях и
 * совпадают.
 *
 * ВРЕМЕННОЕ РЕШЕНИЕ: цены взяты из кэша ведомости, а не из прайса, —
 * чтобы итог сходился с расчётом расчётчика позиция в позицию.
 */
const EXTRA_UNITS = {
  ps145: { name: "ПС 145х1,5", unit: "п.м.", unitMass_kg: 2.95, unitPrice: 450.45 },
  flatSheet: { name: "Лист пл. оц. 1мм (тяж)", unit: "м²", unitMass_kg: 7.95, unitPrice: 782.8 },
  psh61: { name: "ПШ 61х1", unit: "п.м.", unitMass_kg: 1.628, unitPrice: 200 },
} as const;

/**
 * Прочие профили раздела "Каркас" — то, что идёт помимо колонн, ригелей
 * и прогонов.
 *
 * Формулы подтверждены дословным совпадением в обеих реальных
 * ведомостях ("22316" и "22318", лист "12м", строки 26–28):
 *
 *   ПС 145х1,5             = 4 × длина
 *   Лист пл. оц. 1мм (тяж) = кол-во_рам × 2 × пролёт × 0,05 × 1,1 × 2
 *   ПШ 61х1                = 2 × (пролёт + 2 × высота) × 1,1
 *
 * Проверено на "22316" (18×30, высота 5, 8 рам): 120 п.м., 31,68 м² и
 * 61,6 п.м.; на "22318" (15×24, 7 рам): 96 п.м., 23,1 м² и 55 п.м.
 *
 * Позиции ПГС 145х70х2 и ПП150х1,5 того же раздела в обоих проектах
 * умножены на 0, поэтому сюда не входят.
 *
 * ПОД ПРОФЛИСТОМ «ПС 145х1,5» и «ПШ 61х1» НЕ СЧИТАЮТСЯ. Обе формулы в
 * профлистовых ведомостях дописаны множителем 0:
 *
 *   21876: ПС 145х1,5 = 4*C9*0        ПШ 61х1 = 2*(C8+2*C9)*1.1*0
 *   21604: то же самое
 *
 * ЧТО ЭТО ЗА СТРОКА: **водосток**, а не стеновой прогон. 22318 называет
 * позицию дословно — «ПС 145х1,5 водосток»; на активных листах всех
 * объектов маркер столбца A — «вод». Односкатные книги (21777, 22251)
 * дают `2 × длина` вместо четырёх: один карниз вместо двух.
 *
 * ОБНУЛЕНИЕ ПОД ПРОФЛИСТОМ — РЕШЕНИЕ ПО ОБЪЕКТУ, А НЕ ПРАВИЛО. Из трёх
 * профлистовых объектов зануляют двое:
 *
 *   21876 (12×30×4,5)  `4*C9*0` → 0
 *   22258 (15×34×4,7)  `4*C9*0` → 0
 *   22304 (18×40×7,5)  `4*C9`   → 160 п.м., 72 072 ₽   ← НЕ занулён
 *
 * Здесь всегда зануляется под профлистом, то есть на объектах вроде
 * 22304 водосток будет потерян. Вопрос 1 в docs/ВОПРОСЫ_РАСЧЁТЧИКУ.md.
 *
 * Стеновые прогоны к этой строке отношения не имеют: под сэндвичем они
 * лежат в строках 34–37 раздела «Стены» и во всех восьми проверенных
 * сэндвич-книгах равны НУЛЮ (см. пункт 9 раздела 12 аудита).
 */
export function computeFrameExtras(
  geometry: Pick<BuildingGeometry, "span_m" | "length_m" | "height_m">,
  frameCount: number,
  options: { wallIsProfnastil?: boolean } = {},
): FrameExtrasTakeoff {
  const { span_m, length_m, height_m } = geometry;
  const wallIsProfnastil = options.wallIsProfnastil === true;

  const counts: [keyof typeof EXTRA_UNITS, number][] = [
    ["ps145", wallIsProfnastil ? 0 : 4 * length_m],
    ["flatSheet", frameCount * 2 * span_m * 0.05 * 1.1 * 2],
    ["psh61", wallIsProfnastil ? 0 : 2 * (span_m + 2 * height_m) * 1.1],
  ];

  const items: FrameExtraItem[] = counts.map(([key, count]) => {
    const { name, unit, unitMass_kg, unitPrice } = EXTRA_UNITS[key];
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

  return {
    items,
    totalMass_kg: items.reduce((sum, i) => sum + i.mass_kg, 0),
    totalCost: items.reduce((sum, i) => sum + i.cost, 0),
  };
}

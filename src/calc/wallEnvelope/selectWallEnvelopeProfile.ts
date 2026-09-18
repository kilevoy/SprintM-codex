import profilesRaw from "../../data/wallEnvelopeProfiles.generated.json";
import { excelCeiling } from "./excelNumerics";
import type { WallEnvelopeProfile } from "./types";

interface WallEnvelopeProfileCatalog {
  sourceSha256: string;
  rows: WallEnvelopeProfile[];
}

const catalog = profilesRaw as WallEnvelopeProfileCatalog;

/**
 * Шаги перебора в «Расчет Угловая»/«Расчет Рядовая»: 500…3000 мм с шагом 10 мм
 * (матрица AWX:BGN, 251 столбец).
 */
const STEP_MIN_mm = 500;
const STEP_MAX_mm = 3000;
const STEP_INCREMENT_mm = 10;

/**
 * Разрешённые семейства профиля (Лист1!V89:W94) — фиксированная таблица
 * калькулятора v1.5, не зависит от сценария (нет формул в ячейках).
 */
const ALLOWED_FAMILIES: Record<string, boolean> = {
  ПП: true,
  ПС: true,
  ПГССигма: false,
  ТПП: false,
  ТПС: false,
  ТПГС: false,
};

/**
 * Разрешённые типы сечения (Лист1!V102:W105) — тоже фиксированная таблица.
 */
const ALLOWED_SECTION_TYPES: Record<string, boolean> = {
  "]": true,
  "][": true,
  "[]": true,
  "[-]": true,
};

/**
 * Разрешённые типы кронштейна (Лист1!V97:W99) — тоже фиксированная таблица;
 * в v1.5 все три разрешены всегда.
 */
const ALLOWED_BRACKETS: Record<string, boolean> = {
  МП220: true,
  МП350: true,
  МП390: true,
};

/**
 * Требуемая толщина утепления по типу покрытия (Лист1!J89:L93).
 * Для профнастила — 0; для «нашей послойки» — по числу в названии.
 */
export function requiredInsulationForCovering_mm(coveringType: string): number {
  const match = /^наше (\d+) мм/.exec(coveringType);
  if (!match) return 0;
  const value = Number(match[1]);
  return [100, 150, 200, 250].includes(value) ? value : 0;
}

/**
 * Аэродинамический коэффициент AD4: 'Ветер по СП'!V5:AD6, INDEX/MATCH с
 * приближённым поиском (MATCH(...,1)) — это СТУПЕНЧАТАЯ функция (берётся
 * значение ближайшей МЕНЬШЕЙ или равной точки таблицы), а НЕ линейная
 * интерполяция: часть промежуточных точек (3, 4, 7.5, 15) уже стоит в самой
 * таблице готовыми числами (сами они получены интерполяцией при заполнении
 * книги, но заново на лету не интерполируются).
 * Проверено на живом расчёте: тяготеющая ширина 8.22 м и 8.28 м обе дают
 * 0.8 (ближайшая меньшая точка — 7.5 м), а не промежуточное значение между
 * 7.5 и 10 м, которое дала бы линейная интерполяция.
 */
const WIND_COEFFICIENT_BREAKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 1],
  [3, 0.95],
  [4, 0.9],
  [5, 0.85],
  [7.5, 0.8],
  [10, 0.75],
  [15, 0.7],
  [20, 0.65],
];

export function windCoefficientByTributaryWidth(width_m: number): number {
  let coefficient = WIND_COEFFICIENT_BREAKPOINTS[0][1];
  for (const [breakpoint_m, value] of WIND_COEFFICIENT_BREAKPOINTS) {
    if (width_m < breakpoint_m) break;
    coefficient = value;
  }
  return coefficient;
}

/**
 * Масса «стойки» на метр высоты по высоте профиля (Лист1!B14:C24), для строк
 * каталога, где раскрепление обязательно (`bracing === "да"`).
 */
const STUD_MASS_BY_HEIGHT: ReadonlyArray<readonly [number, number]> = [
  [105, 1.5106],
  [110, 1.5106],
  [145, 1.7846],
  [150, 1.8237],
  [170, 1.9803],
  [195, 2.1759],
  [200, 2.2151],
  [220, 2.3716],
  [245, 3.5004],
  [250, 3.5004],
  [300, 4.7534],
];

function studMassPerMeter_kg(height_mm: number): number {
  const exact = STUD_MASS_BY_HEIGHT.find(([h]) => h === height_mm);
  if (exact) return exact[1];
  const sorted = [...STUD_MASS_BY_HEIGHT].sort((a, b) => a[0] - b[0]);
  const match = sorted.find(([h]) => h >= height_mm);
  return (match ?? sorted[sorted.length - 1])[1];
}

/**
 * Коэффициент числа шагов рам на «вес стойки» (Расчет.../T4):
 * 0 при шаге рам ≤2 м, 1 при ≤4, 2 при ≤6, иначе 3.
 */
function studCountFactor(framePitch_m: number): number {
  if (framePitch_m <= 2) return 0;
  if (framePitch_m <= 4) return 1;
  if (framePitch_m <= 6) return 2;
  return 3;
}

export interface WallEnvelopeSelectionInput {
  /** Минимальный/максимальный шаг зоны, мм (Лист1!B23:B24 или B28:B29). */
  minStep_mm: number;
  maxStep_mm: number;
  /** Тип покрытия стены — определяет требуемую толщину утепления профиля. */
  coveringType: string;
  /** Высота зоны, м: для торца — до конька, для продольной стены — до карниза (Лист1!B12). */
  zoneHeight_m: number;
  /** Шаг рам, м (Лист1!B13). */
  framePitch_m: number;
  /**
   * Ограничения высоты профиля, мм (Лист1!B34 = мин, B33 = макс). 0/145мм и
   * т.п.; «любая» на листе означает открытый диапазон — передавайте
   * Number.NEGATIVE_INFINITY/Number.POSITIVE_INFINITY соответственно.
   */
  minHeight_mm: number;
  maxHeight_mm: number;
  /** Ограничения толщины-класса профиля (Лист1!B35:B36, «любая» → 0..100). */
  minThicknessClass: number;
  maxThicknessClass: number;
  /**
   * Коэффициент ветровой нагрузки зоны (C3 = 'Ветер по СП'!F7 или G7 × γn),
   * см. zoneWindPressure.ts.
   */
  windPressureFactor: number;
  /**
   * Лист1!B32 — принудительный коэффициент использования сечения;
   * 0 (по умолчанию) означает «взять из столбца O каталога».
   *
   * Исходник: X = W * ЕСЛИ(B32=0; O; B32) * ЕСЛИ(класс толщины=1; P4; 1).
   * В снимке каталога `capacity_X` уже посчитан при B32=0, поэтому для
   * ненулевого B32 он пересчитывается через сохранённый `usageFactor` (=O).
   */
  momentFactorOverride?: number;
}

export interface WallEnvelopeSelectionResult {
  step_mm: number;
  profile: WallEnvelopeProfile;
  score: number;
  utilization: number;
  windBendingMoment_kNm: number;
}

/**
 * Полный перебор матрицы AWX:BGN «Расчет Угловая»/«Расчет Рядовая»:
 * для каждого шага (500…3000 мм, шаг 10 мм) и каждой строки каталога (864
 * профиля) проверяется допустимость (JW) и считается ранг TQ; итог —
 * глобальный минимум score по всей сетке (шаг × профиль), что и находит
 * MIN(AWX7:BGN7) через приём SMALL(...,1) на каждый столбец (BGQ/BGS/BGT/BGU).
 *
 * Сверено на живом расчёте «Калькулятор ограждайки v1.5.xlsx»
 * (CalculateFullRebuild, без изменений в файле):
 *  - угловая зона (Благовещенск, 24×24×9.3, шаг рам 6, профлист,
 *    B33=B34=145): шаг 1370, []ПП 145x45x1,5/МП390, score 233.41455363000006;
 *  - рядовая зона (тот же объект): шаг 1380, []ПП 145x45x1,2/МП350,
 *    score 188.57523862.
 * См. docs/parity/wall-envelope-engine-extraction.md.
 */
export function selectWallEnvelopeProfile(
  input: WallEnvelopeSelectionInput,
): WallEnvelopeSelectionResult | null {
  const requiredInsulation_mm = requiredInsulationForCovering_mm(input.coveringType);
  const studFactor = studCountFactor(input.framePitch_m);
  const studBaseWeight = studFactor * input.zoneHeight_m;
  const momentFactorOverride = input.momentFactorOverride ?? 0;

  let best: WallEnvelopeSelectionResult | null = null;

  for (let step_mm = STEP_MIN_mm; step_mm <= STEP_MAX_mm; step_mm += STEP_INCREMENT_mm) {
    if (step_mm < input.minStep_mm || step_mm > input.maxStep_mm) continue;

    const tributaryWidth_m = (step_mm / 1000) * input.framePitch_m;
    const windCoefficient = windCoefficientByTributaryWidth(tributaryWidth_m);
    const windPressure_kPa = input.windPressureFactor * windCoefficient;
    const windBendingMoment_kNm =
      windPressure_kPa * (step_mm / 1000) * input.framePitch_m ** 2 * 0.125;

    const rowsInZone = excelCeiling(input.zoneHeight_m / (step_mm / 1000)) - 1;
    const rowLengthTerm = rowsInZone * input.framePitch_m;

    catalog.rows.forEach((profile, index) => {
      if (!ALLOWED_FAMILIES[profile.family]) return;
      if (!ALLOWED_SECTION_TYPES[profile.sectionType]) return;
      if (!ALLOWED_BRACKETS[profile.material]) return;
      // Q7/S7 в исходнике: разрешённость кронштейна и совместимость со
      // стойками — статические свойства строки в v1.5 (не зависят от
      // сценария, см. docs/parity/wall-envelope-engine-extraction.md).
      if (!profile.jointFactor_Q) return;
      if (!profile.jointFactor_S) return;
      if (profile.thickness_mm > input.maxThicknessClass) return;
      if (profile.thickness_mm < input.minThicknessClass) return;
      if (profile.height_mm < input.minHeight_mm) return;
      if (profile.height_mm > input.maxHeight_mm) return;
      if (profile.insulation_mm !== requiredInsulation_mm) return;

      const capacity =
        momentFactorOverride === 0
          ? profile.capacity_X
          : (profile.capacity_X / profile.usageFactor) * momentFactorOverride;
      const utilization = windBendingMoment_kNm / capacity;
      if (utilization > 1) return;

      const studWeight_kg = profile.bracing === "да" ? studBaseWeight * studMassPerMeter_kg(profile.height_mm) : 0;

      const score =
        rowLengthTerm * profile.massSection_kg_m +
        profile.massProfile_kg_m * input.framePitch_m +
        rowsInZone * profile.jointMass_kg +
        (index + 1) / 1_000_000 -
        step_mm / 1_000_000_000 +
        profile.massProfile_kg_m * input.framePitch_m +
        studWeight_kg;

      if (best === null || score < best.score) {
        best = { step_mm, profile, score, utilization, windBendingMoment_kNm };
      }
    });
  }

  return best;
}

export function wallEnvelopeSelectionCatalogSourceSha256(): string {
  return catalog.sourceSha256;
}

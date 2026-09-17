/**
 * Коэффициенты схем оконных ригелей из листа «Лист1».
 *
 * Источник: книга «Таблица по подбору сечений ... версия 1,5.xlsx»,
 * Лист1!I34:L38. Это именно коэффициенты расчётной схемы, а не
 * готовое правило выбора профиля. Само сечение по-прежнему должно
 * проходить проверки листа «Расчет».
 */
export type WindowRigelType = 1 | 2 | 3 | 4 | 5;

export interface WindowRigelFactors {
  type: WindowRigelType;
  moment: number;
  length: number;
  deflection: number;
}

export interface WindowRigelProfile {
  name: string;
  steel: "С245" | "С345";
  massPerM_kg: number;
  area_cm2: number;
  ix_cm4: number;
  iy_cm4: number;
  wx_cm3: number;
  wy_cm3: number;
}

/** Чёрная профильная труба: «Перекупные» → «Нелегированная сталь» → «Труба». */
export const WINDOW_RIGEL_TUBE_PRICE_PER_TON = 136050;

/**
 * Минимальный каталог профилей, перенесённый из
 * data/facadePostCatalog.json (того же блока R:AF листа «Расчет»).
 * Цены намеренно отсутствуют: в книге подбора они не являются источником
 * цены продажи, а отдельный прайс для оконных ригелей ещё не подтверждён.
 */
import profilesRaw from "../../data/facadePostCatalog.json";

const profiles = profilesRaw as Array<Record<string, string>>;

export function getWindowRigelProfiles(): WindowRigelProfile[] {
  return profiles
    .filter((row) => row["сталь"] === "С245" || row["сталь"] === "С345")
    .filter((row) => /^(кв\.(80|100)х|пр\.120х80х)(2,5|3|4|5|6|7)/.test(row["сечение"] ?? ""))
    .map((row) => ({
      name: row["сечение"],
      steel: row["сталь"] as "С245" | "С345",
      massPerM_kg: Number(row["вес_кг"]),
      area_cm2: Number(row["A_см2"]),
      ix_cm4: Number(row["Ix_см4"]),
      iy_cm4: Number(row["Iy_см4"]),
      wx_cm3: Number(row["Wx_см3"]),
      wy_cm3: Number(row["Wy_см3"]),
    }));
}

export interface WindowRigelSelectionInput {
  type: WindowRigelType;
  height_m: number;
  framePitch_m: number;
  verticalLoad_kPa: number;
  windLoad_kPa: number;
  maxUtilization?: number;
}

export interface WindowRigelSelection {
  type: WindowRigelType;
  profile: WindowRigelProfile;
  utilization: { slenderness: number; strength: number; verticalDeflection: number; horizontalDeflection: number };
  lowerLength_m: number;
  upperLength_m: number;
}

/** Подбор минимального профиля по формулам листа «Расчет». */
export function selectWindowRigel(input: WindowRigelSelectionInput): WindowRigelSelection | null {
  const factors = windowRigelFactors(input.type);
  const maxUtilization = input.maxUtilization ?? 0.85;
  const profiles = getWindowRigelProfiles().filter((p) => p.steel === "С245");
  const verticalLoadTerm = input.verticalLoad_kPa * input.height_m + 0.6 * 0.32 * 0.5;
  const horizontalLoadTerm = input.windLoad_kPa * (input.height_m + 1.2) / 2;
  const verticalMoment = verticalLoadTerm * input.framePitch_m ** 2 * factors.moment;
  const horizontalMoment = horizontalLoadTerm * input.framePitch_m ** 2 * 0.125;
  const calculationLength = input.framePitch_m * factors.length;

  for (const profile of profiles.sort((a, b) => a.massPerM_kg - b.massPerM_kg)) {
    const slenderness = Math.max(
      calculationLength * 100 / profile.ix_cm4,
      input.framePitch_m * 100 / profile.iy_cm4,
    ) / 200;
    const strength = (
      (verticalMoment + profile.massPerM_kg * input.framePitch_m ** 2 * 0.125 / 100) / (profile.wx_cm3 / 1e6) +
      horizontalMoment / (profile.wy_cm3 / 1e6)
    ) / 1000 / 240;
    const verticalDeflection = Math.max(
      (5 / 384 * (verticalLoadTerm + profile.massPerM_kg / 100) * input.framePitch_m ** 4 / (2.06e8 * profile.ix_cm4 / 1e8)) /
        (input.framePitch_m / 300) * factors.deflection,
      (5 / 384 * horizontalLoadTerm * input.framePitch_m ** 4 / (2.06e8 * profile.iy_cm4 / 1e8)) /
        (input.framePitch_m / 200),
    );
    const horizontalDeflection = verticalDeflection;
    if (Math.max(slenderness, strength, verticalDeflection, horizontalDeflection) <= maxUtilization) {
      return {
        type: input.type,
        profile,
        utilization: { slenderness, strength, verticalDeflection, horizontalDeflection },
        lowerLength_m: input.framePitch_m,
        upperLength_m: calculationLength,
      };
    }
  }
  return null;
}

const FACTORS: Record<WindowRigelType, WindowRigelFactors> = {
  1: { type: 1, moment: 0.125, length: 1, deflection: 1 },
  2: { type: 2, moment: 0.055, length: 5 / 6, deflection: 0.13 },
  3: { type: 3, moment: 0.062, length: 0.33, deflection: 0.24 },
  4: { type: 4, moment: 0.078, length: 0.5, deflection: 0.5 },
  5: { type: 5, moment: 0.073, length: 0.75, deflection: 0.2 },
};

export function windowRigelFactors(type: WindowRigelType): WindowRigelFactors {
  return FACTORS[type];
}

export function isWindowRigelType(value: number): value is WindowRigelType {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

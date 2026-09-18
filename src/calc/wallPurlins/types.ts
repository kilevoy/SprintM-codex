export interface WallPurlinProfile {
  /** Имя строки из таблицы «Расчёт Угловая» (включая обозначение схемы). */
  profile: string;
  family: string;
  sectionType: string;
  bracing: string;
  thickness_mm: number;
  height_mm: number;
  usageFactor: number;
  material: string;
  insulation_mm: number;
  /** Несущая характеристика исходной строки X (единицы Excel сохраняются). */
  capacity_X: number;
  jointFactor_Q: number;
  jointFactor_S: number;
  massProfile_kg_m: number;
  massSection_kg_m: number;
  jointMass_kg: number;
}

export interface WallPurlinZoneInput {
  /** Расчётная длина стены/зоны вдоль фасада, м. */
  length_m: number;
  /** Высота стены в данной зоне, м. Для торца — высота по коньку. */
  height_m: number;
  /** Принятый шаг ригелей, мм. */
  step_mm: number;
  /** Шаг рам/крепления кронштейнов, м. */
  framePitch_m: number;
  /** Число стен, для которых применяется эта зона. */
  wallCount?: number;
  /** Поправка на крайние ряды из Excel (обычно 0 или 1). */
  edgeRowCorrection?: number;
  /** Шаг кронштейнов вдоль стены, м. */
  bracketSpacing_m?: number;
}

export interface WallPurlinZoneTakeoff {
  rows: number;
  profileLength_m: number;
  bracketCount: number;
  profileMass_kg: number;
  bracketMass_kg: number;
  totalMass_kg: number;
}

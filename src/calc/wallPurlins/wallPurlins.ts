import profilesRaw from "../../data/wallPurlinProfiles.generated.json";
import type {
  WallPurlinProfile,
  WallPurlinZoneInput,
  WallPurlinZoneTakeoff,
} from "./types";

interface WallPurlinProfileCatalog {
  sourceSha256: string;
  rows: WallPurlinProfile[];
}

const catalog = profilesRaw as WallPurlinProfileCatalog;

/**
 * Удаляет только служебные маркеры схемы из имени Excel. Сечения, материал и
 * тип усиления не преобразуются: именно эти значения должны пройти сверку с
 * исходной книгой до автоматического подбора.
 */
export function displayWallPurlinProfileName(profile: string): string {
  let start = 0;
  while (start < profile.length && (profile[start] === "[" || profile[start] === "]")) start += 1;
  return profile.slice(start).trim();
}

export interface WallPurlinProfileQuery {
  height_mm: number;
  thickness_mm: number;
  material?: string;
  insulation_mm?: number;
  family?: string;
  sectionType?: string;
}

/** Возвращает строки исходной таблицы, подходящие по явно заданным признакам. */
export function findWallPurlinProfiles(query: WallPurlinProfileQuery): WallPurlinProfile[] {
  return catalog.rows.filter((row) =>
    row.height_mm === query.height_mm &&
    row.thickness_mm === query.thickness_mm &&
    (query.material === undefined || row.material === query.material) &&
    (query.insulation_mm === undefined || row.insulation_mm === query.insulation_mm) &&
    (query.family === undefined || row.family === query.family) &&
    (query.sectionType === undefined || row.sectionType === query.sectionType),
  );
}

/**
 * Воспроизводит расчёт зоны из «Лист1» без подмены геометрии:
 * F = CEILING(высота×1000 / шаг, 1) + поправка края,
 * длина профиля = F × длина зоны,
 * масса = длина профиля × масса сечения.
 *
 * Кронштейны считаются отдельно, поскольку в Excel они зависят от выбранной
 * схемы стены и шага рам. До полной сверки листов это намеренно явный вход,
 * а не скрытая эвристика.
 */
export function computeWallPurlinZone(
  input: WallPurlinZoneInput,
  profile: WallPurlinProfile,
): WallPurlinZoneTakeoff {
  if (input.length_m < 0 || input.height_m < 0 || input.step_mm <= 0 || input.framePitch_m <= 0) {
    throw new Error("Параметры зоны стеновых прогонов должны быть положительными");
  }
  const wallCount = input.wallCount ?? 1;
  const edgeRowCorrection = input.edgeRowCorrection ?? 0;
  const rows = Math.ceil((input.height_m * 1000) / input.step_mm) + edgeRowCorrection;
  const profileLength_m = rows * input.length_m * wallCount;
  const bracketSpacing_m = input.bracketSpacing_m ?? input.framePitch_m;
  const bracketCount = Math.ceil((input.length_m / bracketSpacing_m) * wallCount);
  const profileMass_kg = profileLength_m * profile.massSection_kg_m;
  const bracketMass_kg = bracketCount * profile.jointMass_kg;
  return {
    rows,
    profileLength_m,
    bracketCount,
    profileMass_kg,
    bracketMass_kg,
    totalMass_kg: profileMass_kg + bracketMass_kg,
  };
}

export function wallPurlinCatalogSourceSha256(): string {
  return catalog.sourceSha256;
}

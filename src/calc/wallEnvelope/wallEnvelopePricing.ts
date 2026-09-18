import pricesRaw from "../../data/framePGSPrices.json";
import type { WallEnvelopeProfile } from "./types";

interface PriceRow {
  name: string;
  group: string;
  price0: number;
  unit: string;
  weight_kg: number;
  priceSale: number;
}

const priceRows = Object.values(pricesRaw as Record<string, PriceRow[]>).flat();

/**
 * Разбор имени профиля из каталога подборщика.
 *
 * В таблице подборщика имена записаны неоднородно: `]ПП 110x45x1` — через
 * латинскую «x» и с пробелом, `[-]ПС145х45х1,2` — через кириллическую «х»
 * и без пробела. Ведущие символы — обозначение сечения, а не часть имени.
 */
export function parseWallEnvelopeProfileName(profile: string): {
  family: string;
  height_mm: number;
  width_mm: number;
  thickness: string;
} | null {
  const match = /^[[\]-]*([А-Яа-яЁёA-Za-z]+)\s*(\d+)[xх](\d+)[xх]([\d,.]+)/.exec(profile);
  if (!match) return null;
  // Подборщик пишет целую толщину как «1» и «2», прайс — как «1,0» и «2,0».
  const thickness = match[4].replace(".", ",");
  return {
    family: match[1],
    height_mm: Number(match[2]),
    width_mm: Number(match[3]),
    thickness: thickness.includes(",") ? thickness : `${thickness},0`,
  };
}

/**
 * Имя позиции прайса ИНСИ для профиля стеновой обвязки.
 *
 * Марка стали в подборщике записана как «МП350»/«МП390», а в прайсе — как
 * суффикс «П350»/«П390»; у «МП220» суффикса нет. Обвязка идёт
 * оцинкованной: это внутренняя конструкция, снаружи её закрывает обшивка.
 */
export function wallEnvelopePriceName(profile: WallEnvelopeProfile): string | null {
  const parsed = parseWallEnvelopeProfileName(profile.profile);
  if (!parsed) return null;
  const grade = /^МП(\d+)$/.exec(profile.material);
  const gradeSuffix = grade && grade[1] !== "220" ? ` П${grade[1]}` : "";
  return (
    `${parsed.family} ${parsed.height_mm}х${parsed.width_mm} без перфор. ` +
    `${parsed.thickness}${gradeSuffix} (Оцинк.)`
  );
}

export interface WallEnvelopePrice {
  name: string;
  /** Цена за погонный метр ПРОФИЛЯ, ₽. */
  pricePerMeter: number;
  /** Масса погонного метра по прайсу, кг. */
  weight_kg_per_m: number;
}

/**
 * Цена профиля обвязки по прайсу ИНСИ.
 *
 * Сверено с объектной ведомостью 21876: `ПП 145х45х1,2` идёт там по
 * 314,0 ₽/п.м. при 2,14 кг/м, а прайс даёт 313,95 и 2,1378; `ПП
 * 145х45х1,5` — 402,2 против 402,15. То есть ведомость берёт `priceSale`.
 */
export function wallEnvelopeProfilePrice(profile: WallEnvelopeProfile): WallEnvelopePrice | null {
  const name = wallEnvelopePriceName(profile);
  if (name === null) return null;
  const row = priceRows.find((candidate) => candidate.name === name);
  if (!row) return null;
  return { name: row.name, pricePerMeter: row.priceSale, weight_kg_per_m: row.weight_kg };
}

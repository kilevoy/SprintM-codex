import { describe, expect, it } from "vitest";
import { findWallEnvelopeProfiles } from "./wallEnvelope";
import {
  parseWallEnvelopeProfileName,
  wallEnvelopePriceName,
  wallEnvelopeProfilePrice,
} from "./wallEnvelopePricing";

function profile(height_mm: number, thickness_mm: number, material: string, sectionType: string) {
  const row = findWallEnvelopeProfiles({ height_mm, thickness_mm, material, insulation_mm: 0 }).find(
    (candidate) => candidate.sectionType === sectionType,
  );
  if (!row) throw new Error(`нет строки каталога ${height_mm}x${thickness_mm} ${material}`);
  return row;
}

describe("цена профиля стеновой обвязки", () => {
  it("разбирает оба написания имени из подборщика", () => {
    // Латинская «x» с пробелом и кириллическая «х» без пробела.
    expect(parseWallEnvelopeProfileName("]ПП 110x45x1")).toEqual({
      family: "ПП",
      height_mm: 110,
      width_mm: 45,
      thickness: "1,0",
    });
    expect(parseWallEnvelopeProfileName("[-]ПС145х45х1,2")).toEqual({
      family: "ПС",
      height_mm: 145,
      width_mm: 45,
      thickness: "1,2",
    });
  });

  it("марка стали становится суффиксом прайса, у МП220 суффикса нет", () => {
    expect(wallEnvelopePriceName(profile(145, 1.2, "МП350", "[]"))).toBe(
      "ПП 145х45 без перфор. 1,2 П350 (Оцинк.)",
    );
    expect(wallEnvelopePriceName(profile(145, 1, "МП220", "]"))).toBe(
      "ПП 145х45 без перфор. 1,0 (Оцинк.)",
    );
  });

  it("цены совпадают с объектной ведомостью 21876", () => {
    // Ведомость: ПП 145х45х1,2 — 314,0 ₽/п.м. при 2,14 кг/м;
    //            ПП 145х45х1,5 — 402,2 ₽/п.м.
    const thin = wallEnvelopeProfilePrice(profile(145, 1.2, "МП350", "[]"));
    expect(thin?.pricePerMeter).toBeCloseTo(313.95, 2);
    expect(thin?.weight_kg_per_m).toBeCloseTo(2.1378, 4);

    const thick = wallEnvelopeProfilePrice(profile(145, 1.5, "МП350", "[]"));
    expect(thick?.pricePerMeter).toBeCloseTo(402.15, 2);
  });

  it("честно отдаёт null там, где прайс такой марки не содержит", () => {
    // П390 при толщине 1,2 в прайсе ИНСИ отсутствует — это пробел прайса,
    // а не ошибка сопоставления, и выдумывать цену здесь нельзя.
    expect(wallEnvelopeProfilePrice(profile(145, 1.2, "МП390", "[]"))).toBeNull();
  });
});

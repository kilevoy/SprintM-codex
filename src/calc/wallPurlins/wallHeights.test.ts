import { describe, expect, it } from "vitest";
import { ridgeRiseFactor, wallPurlinHeights } from "./wallHeights";

/**
 * Эталон — рабочая тетрадь расчётчика и его же копии калькулятора,
 * сохранённые по объектам (scripts/oracle/inputs/wall-purlin-object-runs.json).
 */
describe("высоты стен по правилу расчётчика", () => {
  it("21604: пролёт 18, карниз 7, уклон 15° — торец 9,75 и вдоль 7,5", () => {
    const h = wallPurlinHeights({ span_m: 18, eaveHeight_m: 7, roofSlopeDeg: 15 });
    expect(h.gable_m).toBeCloseTo(9.75, 9);
    expect(h.longitudinal_m).toBeCloseTo(7.5, 9);
  });

  it("21876: пролёт 12, карниз 4,5, уклон 15° — торец 6,5", () => {
    const h = wallPurlinHeights({ span_m: 12, eaveHeight_m: 4.5, roofSlopeDeg: 15 });
    expect(h.gable_m).toBeCloseTo(6.5, 9);
    // Расчётчик вбил на продольной 4,8 вместо 5,0; на итог это не влияет
    // (см. тест на 720 п.м.), но правило даёт именно 5,0.
    expect(h.longitudinal_m).toBeCloseTo(5, 9);
  });

  it("22317: уклон 6° даёт подъём вдвое с лишним меньше — торец 7,4", () => {
    const h = wallPurlinHeights({ span_m: 12, eaveHeight_m: 6.3, roofSlopeDeg: 6 });
    expect(h.gable_m).toBeCloseTo(7.4, 9);
    expect(h.longitudinal_m).toBeCloseTo(6.8, 9);
  });

  it("0,25 и 0,1 — округления расчётчика, а не тангенсы уклона", () => {
    expect(ridgeRiseFactor(15)).toBe(0.25);
    expect(ridgeRiseFactor(6)).toBe(0.1);
    // Через тангенс 21604 дал бы 9,91 вместо 9,75 — это и есть цена ошибки.
    const viaTangent = 9 * Math.tan((15 * Math.PI) / 180) + 7.5;
    expect(viaTangent).toBeCloseTo(9.912, 3);
    expect(wallPurlinHeights({ span_m: 18, eaveHeight_m: 7, roofSlopeDeg: 15 }).gable_m).not.toBeCloseTo(
      viaTangent,
      2,
    );
  });

  it("добавка к карнизу переопределяется вариантом +1,3 из тетради", () => {
    const h = wallPurlinHeights({ span_m: 18, eaveHeight_m: 7, roofSlopeDeg: 15, allowance_m: 1.3 });
    expect(h.longitudinal_m).toBeCloseTo(8.3, 9);
    expect(h.gable_m).toBeCloseTo(10.55, 9);
  });

  it("добавка одинакова для обеих стен — разница только в подъёме кровли", () => {
    const h = wallPurlinHeights({ span_m: 24, eaveHeight_m: 6, roofSlopeDeg: 15 });
    expect(h.gable_m - h.longitudinal_m).toBeCloseTo(24 / 2 * 0.25, 9);
  });
});

import { describe, expect, it } from "vitest";
import {
  windowFramingCost,
  windowFramingMass_kg,
  windowRigelByHeight,
  WINDOW_RIGEL_TUBE_PRICE_PER_TON,
} from "./windowRigels";

describe("правило сечения оконного ригеля", () => {
  it("до 1,5 м — труба 80×4", () => {
    for (const height of [0.8, 1, 1.5]) {
      const rigel = windowRigelByHeight(height);
      expect(rigel.kind).toBe("tube");
      if (rigel.kind !== "tube") return;
      expect(rigel.profile.name).toBe("кв.80х4");
      expect(rigel.profile.massPerM_kg).toBe(9.6);
    }
  });

  it("от 1,5 до 3 м — труба 120×4", () => {
    for (const height of [1.6, 2.4, 3]) {
      const rigel = windowRigelByHeight(height);
      expect(rigel.kind).toBe("tube");
      if (rigel.kind !== "tube") return;
      expect(rigel.profile.name).toBe("пр.120х80х4");
      expect(rigel.profile.massPerM_kg).toBe(12);
    }
  });

  it("выше 3 м — витраж, автоматически не считается", () => {
    expect(windowRigelByHeight(3.2).kind).toBe("curtain-wall");
    expect(windowFramingMass_kg({ height_m: 3.2, framePitch_m: 6, count: 1 })).toBeNull();
  });

  it("берёт обычную чёрную трубу, а не оцинкованную", () => {
    const rigel = windowRigelByHeight(1);
    expect(rigel.kind).toBe("tube");
    if (rigel.kind !== "tube") return;
    // Каталог сталей — С245/С345, без оцинковки; цена — «Перекупные» → «Труба».
    expect(rigel.profile.steel).toBe("С245");
    expect(WINDOW_RIGEL_TUBE_PRICE_PER_TON).toBe(136050);
  });

  it("масса обрамления считается по формуле O26 подборщика", () => {
    // O26 = (нижний × шаг + верхний × (2×высота + шаг)) × кол-во.
    // Окно 1,2 м при шаге рам 6: труба 80×4, 9,6 кг/м.
    // (9,6×6 + 9,6×(2×1,2 + 6)) × 2 = (57,6 + 80,64) × 2 = 276,48
    const mass = windowFramingMass_kg({ height_m: 1.2, framePitch_m: 6, count: 2 });
    expect(mass).toBeCloseTo(276.48, 6);
    expect(windowFramingCost(mass ?? 0)).toBeCloseTo((276.48 / 1000) * 136050, 6);
  });

  it("окно выше полутора метров тяжелее за счёт трубы 120×4", () => {
    const low = windowFramingMass_kg({ height_m: 1.4, framePitch_m: 6, count: 1 }) ?? 0;
    const high = windowFramingMass_kg({ height_m: 1.6, framePitch_m: 6, count: 1 }) ?? 0;
    expect(high).toBeGreaterThan(low);
  });
});

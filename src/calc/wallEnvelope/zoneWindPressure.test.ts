import { describe, expect, it } from "vitest";
import {
  windHeightFactor,
  windPulsationFactor,
  zoneWindPressureFactor,
} from "./zoneWindPressure";

/**
 * Значения сверены с живыми ячейками «Калькулятор ограждайки v1.5.xlsx»
 * (Excel COM, CalculateFullRebuild, книга не изменена) на её собственном
 * сохранённом сценарии: Благовещенск, w0=0.3 кПа ('Ветер по СП'!C9),
 * высота по коньку 10.5 м (C8), тип местности «В» (C4), γn=0.8 (Лист1!B3).
 */
describe("ветровое давление зоны стены (C3)", () => {
  it("k(ze) интерполируется как в книге: 0.66 на 10.5 м, тип местности В", () => {
    expect(windHeightFactor(10.5, "B")).toBeCloseTo(0.66, 12);
  });

  it("ζ(ze) интерполируется как в книге: 1.053 на 10.5 м, тип местности В", () => {
    expect(windPulsationFactor(10.5, "B")).toBeCloseTo(1.053, 12);
  });

  it("на узле таблицы берётся само табличное значение без интерполяции", () => {
    expect(windHeightFactor(20, "B")).toBe(0.85);
    expect(windPulsationFactor(20, "B")).toBe(0.92);
  });

  it("ниже 5 м высота поднимается до 5 м (MAX(5;h) исходника)", () => {
    expect(windHeightFactor(3, "B")).toBe(windHeightFactor(5, "B"));
    expect(windPulsationFactor(3, "B")).toBe(windPulsationFactor(5, "B"));
  });

  it("угловая зона даёт C3 = 1.001601216", () => {
    const c3 = zoneWindPressureFactor({
      w0_kPa: 0.3,
      ridgeHeight_m: 10.5,
      terrain: "B",
      gammaN: 0.8,
      zone: "corner",
    });
    expect(c3).toBeCloseTo(1.001601216, 12);
  });

  it("рядовая зона даёт C3 = 0.637382592", () => {
    const c3 = zoneWindPressureFactor({
      w0_kPa: 0.3,
      ridgeHeight_m: 10.5,
      terrain: "B",
      gammaN: 0.8,
      zone: "regular",
    });
    expect(c3).toBeCloseTo(0.637382592, 12);
  });

  it("без γn получается сама «пиковая нагрузка без ν» F7/G7 книги", () => {
    const corner = zoneWindPressureFactor({
      w0_kPa: 0.3,
      ridgeHeight_m: 10.5,
      terrain: "B",
      gammaN: 1,
      zone: "corner",
    });
    const regular = zoneWindPressureFactor({
      w0_kPa: 0.3,
      ridgeHeight_m: 10.5,
      terrain: "B",
      gammaN: 1,
      zone: "regular",
    });
    expect(corner).toBeCloseTo(1.25200152, 12);
    expect(regular).toBeCloseTo(0.79672824, 12);
  });
});

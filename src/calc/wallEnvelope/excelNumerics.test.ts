import { describe, expect, it } from "vitest";
import { excelCeiling, excelRound, toExcelPrecision } from "./excelNumerics";

describe("числовые повадки Excel", () => {
  it("4,2/1,4 для Excel ровно 3, а не 3,0000000000000004", () => {
    expect(4.2 / 1.4).not.toBe(3);
    expect(toExcelPrecision(4.2 / 1.4)).toBe(3);
    expect(excelCeiling(4.2 / 1.4)).toBe(3);
    // Без поправки получилось бы 4 — именно эта единица и уводила подбор
    // шага на соседний профиль (см. сценарий min-height-clamped-5m).
    expect(Math.ceil(4.2 / 1.4)).toBe(4);
  });

  it("не трогает значения, которые действительно надо округлить вверх", () => {
    expect(excelCeiling(3.0001)).toBe(4);
    expect(excelCeiling(2.5)).toBe(3);
    expect(excelCeiling(7)).toBe(7);
  });

  it("ОКРУГЛ до одного знака", () => {
    expect(excelRound(2.25, 1)).toBe(2.3);
    expect(excelRound(4.04, 1)).toBe(4);
    expect(excelRound(12 / 6, 1)).toBe(2);
  });
});

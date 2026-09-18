import { describe, expect, it } from "vitest";
import { selectWallPurlinProfile } from "./selectWallPurlinProfile";

/**
 * Оба сценария сверены напрямую с «Калькулятор ограждайки v1.5.xlsx»
 * (Excel COM, CalculateFullRebuild, файл не изменён — SHA-256 до/после
 * совпадает с docs/parity/wall-purlin-engine-extraction.md):
 *
 * Лист1: Благовещенск, γn=0.8, пролёт 24, длина 24, высота конька 10.5,
 * длина стены 24, высота стены 9.3, шаг рам 6, СП 20.13330, профлист,
 * С18-1150-0,5, B22=B27=0 (свои шаги не заданы → B24=B29=1500 из таблицы
 * профнастила), B32=0 (авто-коэффициент), B33=B34=145 (профиль зажат
 * ровно на 145 мм высоты), B35=B36="любая".
 *
 * Угловая зона: 'Расчет Угловая'!C3 = 1.001601216 (= 'Ветер по СП'!F7 ×
 * γn), BGQ7=233.41455363000006, BGS7=1370, BGT7="[]ПП 145x45x1,5",
 * BGU7="МП390".
 *
 * Рядовая зона: 'Расчет Рядовая'!C3 = 0.637382592, BGQ7=188.57523862,
 * BGS7=1380, BGT7="[]ПП 145x45x1,2", BGU7="МП350".
 */
describe("selectWallPurlinProfile — Excel-сверенный перебор AWX:BGN", () => {
  const common = {
    minStep_mm: 0,
    maxStep_mm: 1500,
    coveringType: "профлист",
    zoneHeight_m: 9.3,
    framePitch_m: 6,
    minHeight_mm: 145,
    maxHeight_mm: 145,
    minThicknessClass: 0,
    maxThicknessClass: 100,
  };

  it("угловая зона: шаг 1370, []ПП 145x45x1,5 / МП390", () => {
    const result = selectWallPurlinProfile({
      ...common,
      windPressureFactor: 1.001601216,
    });
    expect(result).not.toBeNull();
    expect(result!.step_mm).toBe(1370);
    expect(result!.profile.profile).toBe("[]ПП 145x45x1,5");
    expect(result!.profile.material).toBe("МП390");
    expect(result!.score).toBeCloseTo(233.41455363000006, 6);
  });

  it("рядовая зона: шаг 1380, []ПП 145x45x1,2 / МП350", () => {
    const result = selectWallPurlinProfile({
      ...common,
      windPressureFactor: 0.637382592,
    });
    expect(result).not.toBeNull();
    expect(result!.step_mm).toBe(1380);
    expect(result!.profile.profile).toBe("[]ПП 145x45x1,2");
    expect(result!.profile.material).toBe("МП350");
    expect(result!.score).toBeCloseTo(188.57523862, 6);
  });

  it("возвращает null, когда ни один шаг зоны не проходит по ограничению шага", () => {
    const result = selectWallPurlinProfile({
      ...common,
      minStep_mm: 4000,
      maxStep_mm: 5000,
      windPressureFactor: 1.001601216,
    });
    expect(result).toBeNull();
  });
});

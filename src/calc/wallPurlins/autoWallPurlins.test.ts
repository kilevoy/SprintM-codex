import { describe, expect, it } from "vitest";
import {
  computeWallPurlinsAuto,
  cornerZoneLength_m,
  deckingDesignLoad_kPa,
  maxDeckingSpan_mm,
  profilesPerLine,
  wallPurlinBuildingTakeoff,
} from "./autoWallPurlins";
import { findWallPurlinProfiles } from "./wallPurlins";

/**
 * Эталон — «Калькулятор ограждайки v1.5.xlsx», пересчитанный Excel COM на
 * копии книги (оригинал не изменён). Полный протокол по десяти сценариям —
 * scripts/oracle/run_wall_purlin_calculator.ps1 +
 * scripts/oracle/compare_wall_purlin_calculator.mjs; здесь закреплён
 * базовый сценарий книги, чтобы регрессия ловилась без Excel.
 *
 * Лист1: γn=0.8, a=24, b=24, h(конёк)=10.5, стена 24×9.3, шаг рам 6,
 * тип местности «В», w0=0.3 кПа, профлист С18-1150-0,5, свои шаги не
 * заданы, B32=0, B33=B34=145.
 */
const baseInput = {
  crosswindWidth_m: 24,
  ridgeHeight_m: 10.5,
  wallLength_m: 24,
  wallHeight_m: 9.3,
  framePitch_m: 6,
  terrain: "B" as const,
  w0_kPa: 0.3,
  gammaN: 0.8,
  coveringType: "профлист",
  deckingMark: "С18-1150-0,5",
  minProfileHeight_mm: 145,
  maxProfileHeight_mm: 145,
};

describe("автоподбор стеновых прогонов", () => {
  it("угловая зона повторяет Лист1!B49:I49", () => {
    const result = computeWallPurlinsAuto(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { corner } = result;
    expect(corner.zoneLength_m).toBe(12);
    expect(corner.maxStep_mm).toBe(1500);
    expect(corner.step_mm).toBe(1370);
    expect(corner.profile.profile).toBe("[]ПП 145x45x1,5");
    expect(corner.profile.material).toBe("МП390");
    expect(corner.rows).toBe(7);
    expect(corner.bracketCount).toBe(14);
    expect(corner.bracketMass_kg).toBe(21);
    expect(corner.profileMass_kg).toBeCloseTo(448.8288, 9);
  });

  it("рядовая зона повторяет Лист1!B50:I50", () => {
    const result = computeWallPurlinsAuto(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { regular } = result;
    expect(regular.zoneLength_m).toBe(12);
    expect(regular.maxStep_mm).toBe(1500);
    expect(regular.step_mm).toBe(1380);
    expect(regular.profile.profile).toBe("[]ПП 145x45x1,2");
    expect(regular.profile.material).toBe("МП350");
    expect(regular.rows).toBe(7);
    expect(regular.bracketCount).toBe(14);
    expect(regular.bracketMass_kg).toBe(21);
    expect(regular.profileMass_kg).toBeCloseTo(359.1504, 9);
  });

  it("нагрузка на обшивку повторяет D5 обеих зон", () => {
    const result = computeWallPurlinsAuto(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corner.deckingDesignLoad_kPa).toBeCloseTo(0.6009607296, 12);
    expect(result.regular.deckingDesignLoad_kPa).toBeCloseTo(0.3824295552, 12);
  });

  it("длина угловой зоны: e = MIN(b; 2h), ширина e/5, вверх до шага рам, с двух сторон", () => {
    // e = MIN(24; 21) = 21 → 4.2 м → 0.7 шага → 1 шаг → 6 м → 12 м на стену.
    expect(cornerZoneLength_m(24, 10.5, 6)).toBe(12);
    // Высота ниже 5 м поднимается до 5 ('Ветер по СП'!C8 = MAX(5; h)):
    // e = MIN(30; 10) = 10 → 2 м → 0.333 шага < 0.5 → зоны нет.
    expect(cornerZoneLength_m(30, 4.5, 6)).toBe(0);
  });

  it("максимальный шаг берётся из таблицы пролётов обшивки", () => {
    // С18-1150-0,5 держит 1.42 кПа и на 1450, и на 1500 мм, а на 1550 — 0.
    expect(maxDeckingSpan_mm("С18-1150-0,5", 0.6009607296)).toBe(1500);
    expect(maxDeckingSpan_mm("С18-1150-0,5", 1.42)).toBe(1500);
    // 1.43 кПа не держат уже ни 1500, ни 1450 — ближайший проходящий 1400 (1.624).
    expect(maxDeckingSpan_mm("С18-1150-0,5", 1.43)).toBe(1400);
    // Нагрузку больше самой большой в таблице не держит ни один пролёт.
    expect(maxDeckingSpan_mm("С18-1150-0,5", 100)).toBeNull();
  });

  it("γn входит в нагрузку на обшивку дважды — как в книге", () => {
    // D5 = C3 * 0.75 * γn, а γn уже сидит в C3.
    expect(deckingDesignLoad_kPa(1.001601216, 0.8)).toBeCloseTo(0.6009607296, 12);
  });

  it("стена 30×4,2 при шаге рам 6: ровное деление высоты на шаг считается как в Excel", () => {
    // Сценарий min-height-clamped-5m живого оракула: на шаге 1400 мм
    // 4,2/1,4 для Excel ровно 3 ряда, поэтому побеждает []ПП 145x45x1,2
    // с МП350, а не более сильный МП390 на шаге 1500.
    const result = computeWallPurlinsAuto({
      crosswindWidth_m: 30,
      ridgeHeight_m: 4.5,
      wallLength_m: 30,
      wallHeight_m: 4.2,
      framePitch_m: 6,
      terrain: "B",
      w0_kPa: 0.23,
      gammaN: 0.8,
      coveringType: "профлист",
      deckingMark: "С18-1150-0,5",
      minProfileHeight_mm: 0,
      maxProfileHeight_mm: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corner.step_mm).toBe(1400);
    expect(result.corner.profile.profile).toBe("[]ПП 145x45x1,2");
    expect(result.corner.profile.material).toBe("МП350");
    // Высота по коньку 4,5 м ниже пяти: угловой зоны не возникает вовсе.
    expect(result.corner.zoneLength_m).toBe(0);
    expect(result.regular.zoneLength_m).toBe(30);
  });

  it("сдвоенное сечение идёт в ведомость удвоенным метражом: 21604", () => {
    // Ведомость 21604 (Кропоткин 18×48), где выбраны сечения «[-]»:
    //   ПС 145х45х1,5 = 8*2*12*2                                  = 384
    //   ПС 145х45х1,2 = 7*2*6*2 + 7*2*10,7*2 + 5*2*37,3*2         = 1213,6
    // Множитель ровно 2, хотя масса сечения к массе профиля тут
    // относится как 2,48 и 2,60 — разница уходит в полосу, которая
    // сидит в массе, но в метраж не попадает.
    const shared = {
      crosswindWidth_m: 48,
      ridgeHeight_m: 9.75,
      terrain: "B" as const,
      w0_kPa: 0.48,
      gammaN: 1,
      coveringType: "профлист",
      deckingMark: "С18-1150-0,5",
      minProfileHeight_mm: 145,
      maxProfileHeight_mm: 145,
    };
    const endWalls = computeWallPurlinsAuto({
      ...shared,
      wallLength_m: 18,
      wallHeight_m: 9.75,
      framePitch_m: 6,
    });
    const longWalls = computeWallPurlinsAuto({
      ...shared,
      wallLength_m: 48,
      wallHeight_m: 7.5,
      framePitch_m: 5.35,
    });
    expect(endWalls.ok).toBe(true);
    expect(longWalls.ok).toBe(true);
    if (!endWalls.ok || !longWalls.ok) return;

    const takeoff = wallPurlinBuildingTakeoff([
      { wallCount: 2, corner: endWalls.corner, regular: endWalls.regular },
      { wallCount: 2, corner: longWalls.corner, regular: longWalls.regular },
    ]);

    const thick = takeoff.lines.find((line) => line.profile.profile === "[-]ПС145х45х1,5");
    const thin = takeoff.lines.find((line) => line.profile.profile === "[-]ПС145х45х1,2");
    expect(thick?.profileLength_m).toBeCloseTo(384, 6);
    expect(thin?.profileLength_m).toBeCloseTo(1213.6, 6);
    // Масса считается по массе СЕЧЕНИЯ, то есть полоса в неё входит:
    // 1213,6/2 × 6,1823 = 3751 кг, в ведомости округлено до 3 750.
    expect(thin?.mass_kg).toBeCloseTo(3751.4, 0);
  });

  it("у одиночного сечения множителя нет, у сдвоенных он ровно два", () => {
    const single = findWallPurlinProfiles({ height_mm: 110, thickness_mm: 1, insulation_mm: 0 }).find(
      (row) => row.sectionType === "]",
    );
    expect(single && profilesPerLine(single)).toBe(1);
    for (const sectionType of ["[]", "][", "[-]"]) {
      const row = findWallPurlinProfiles({ height_mm: 145, thickness_mm: 1.2, insulation_mm: 0 }).find(
        (candidate) => candidate.sectionType === sectionType,
      );
      expect(row && profilesPerLine(row)).toBe(2);
    }
  });

  it("утеплённое покрытие честно отклоняется, а не считается молча", () => {
    const result = computeWallPurlinsAuto({ ...baseInput, coveringType: "наше 150 мм" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported-covering");
  });
});

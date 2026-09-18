import { describe, expect, it } from "vitest";
import { computeProject, type ProjectInputs } from "./computeProject";

/**
 * Подключение автоподбора стеновых прогонов к расчёту объекта.
 *
 * Здесь проверяется ИМЕННО передача входов: что торцевая стена считается по
 * высоте до конька, продольная — по карнизу, что у торца свой шаг стоек и
 * что зажим высоты профиля доходит до подбора.
 *
 * Сам инженерный паритет с «Калькулятором ограждайки» проверяется не
 * здесь, а на расчётах, сохранённых расчётчиком по объектам:
 * `npm run check:wall-purlin-objects` (90 из 90 величин по 21604, 21876
 * и 22317). Разделение намеренное: там входы взяты из книги расчётчика, а
 * здесь computeProject выводит их сам из габаритов объекта, и эти два
 * набора не обязаны совпадать — см. «Что осталось» в
 * docs/parity/wall-purlin-engine-extraction.md.
 */
const coldProfnastilHangar: ProjectInputs = {
  city: "Каргалейка",
  // Каргалейки нет в климатическом справочнике, поэтому нагрузки заданы
  // вручную — штатный путь для площадок вне таблиц. Ветровой район II
  // даёт w0 = 0,3 кПа, как и в расчёте расчётчика по этому объекту.
  manualClimate: { snowLoad_kPa: 1.5, windDistrict: "II", label: "Каргалейка" },
  span: 12,
  length_m: 30,
  height_m: 4.8,
  gammaN: 0.8,
  bankK: 0.8,
  roofingType: "профлист",
  deckingMark: "С44-1000-0,7",
  maxStepOverride_mm: 0,
  minStep_mm: 0,
  framePitchOverride_m: 6,
  wallPanel_mm: 0,
  roofPanel_mm: 0,
  openings: { gates: [], doors: [], windows: [] },
  snowGuards: false,
  railingPurlin: false,
  tubeStrutCount: 0,
  strutTube: "80х3",
  extraTubeMass_t: 0,
  postSpacing_m: 2,
  terrainType: "B",
  wallCladdingMaterial: "профнастил",
  wallProfnastilThickness_mm: 0.5,
  wallPurlinsAuto: { profileHeight_mm: 145 },
};

describe("автоподбор стеновых прогонов в расчёте объекта", () => {
  it("считает обе стены: торец по коньку, продольную по карнизу", () => {
    const result = computeProject(coldProfnastilHangar);
    const auto = result.wallPurlinsAuto;
    expect(auto).not.toBeNull();
    if (!auto) return;

    expect(auto.status).toBe("provisional");
    expect(auto.longWalls.ok).toBe(true);
    expect(auto.endWalls.ok).toBe(true);
    if (!auto.longWalls.ok || !auto.endWalls.ok) return;

    // Продольная стена — по карнизу и на всю длину здания.
    expect(auto.longWalls.regular.zoneLength_m + auto.longWalls.corner.zoneLength_m).toBeCloseTo(30, 9);
    // Торец — на пролёт, и высота у него больше карнизной.
    expect(auto.endWalls.regular.zoneLength_m + auto.endWalls.corner.zoneLength_m).toBeCloseTo(12, 9);
    expect(auto.endWalls.regular.rows).toBeGreaterThan(auto.longWalls.regular.rows);
  });

  it("шаг стоек торца выводится из числа стоек фахверка", () => {
    const result = computeProject(coldProfnastilHangar);
    // Пролёт 12 м, 4 стойки на здание -> 2 на торец -> 3 пролёта по 4 м.
    expect(result.wallPurlinsAuto?.gablePostSpacing_m).toBeCloseTo(4, 9);
    expect(result.wallPurlinsAuto?.gablePostSpacingIsDerived).toBe(true);
  });

  it("заданный шаг стоек торца перебивает выведенный", () => {
    const result = computeProject({
      ...coldProfnastilHangar,
      wallPurlinsAuto: { profileHeight_mm: 145, gablePostSpacing_m: 6 },
    });
    expect(result.wallPurlinsAuto?.gablePostSpacing_m).toBe(6);
    expect(result.wallPurlinsAuto?.gablePostSpacingIsDerived).toBe(false);
  });

  it("зажим высоты профиля доходит до подбора", () => {
    const pinned = computeProject(coldProfnastilHangar);
    for (const wall of [pinned.wallPurlinsAuto?.longWalls, pinned.wallPurlinsAuto?.endWalls]) {
      if (!wall?.ok) continue;
      expect(wall.regular.profile.height_mm).toBe(145);
      expect(wall.corner.profile.height_mm).toBe(145);
    }

    const free = computeProject({
      ...coldProfnastilHangar,
      wallPurlinsAuto: {},
    });
    expect(free.wallPurlinsAuto?.profileHeightPin_mm).toBeNull();
  });

  it("ведомость прогонов считает погонные метры профиля, а не линий", () => {
    const result = computeProject(coldProfnastilHangar);
    const takeoff = result.wallPurlinsAuto?.takeoff;
    expect(takeoff).toBeDefined();
    if (!takeoff) return;
    expect(takeoff.lines.length).toBeGreaterThan(0);
    // Парное сечение «[]» идёт в ведомость удвоенной длиной.
    for (const line of takeoff.lines) {
      const perLine = Math.round(line.profile.massSection_kg_m / line.profile.massProfile_kg_m);
      expect(line.profileLength_m).toBeCloseTo(line.lineLength_m * perLine, 9);
    }
    expect(takeoff.brackets.count).toBeGreaterThan(0);
    expect(takeoff.profileMass_kg).toBeGreaterThan(0);
  });

  it("сквозной расчёт повторяет ведомость 21876", () => {
    // Ведомость «Каргалейка»: ПП 145х45х1,2 — 720 п.м. (формула в книге
    // записана как 5*2*12*2 + 4*2*30*2), масса 1540,8 кг при округлённых
    // расчётчиком 2,14 кг/м, кронштейны 90 кг.
    //
    // Шаг стоек торца здесь задан 6 м: именно при нём сходится масса
    // кронштейнов ведомости. Сохранённая расчётчиком копия калькулятора по
    // этому же объекту посчитана при 4 м и даёт 105 кг — то есть два его
    // собственных документа расходятся между собой на 15 кг, и это
    // расхождение в исходных данных, а не в расчёте.
    const result = computeProject({
      ...coldProfnastilHangar,
      wallPurlinsAuto: { profileHeight_mm: 145, gablePostSpacing_m: 6 },
    });
    const takeoff = result.wallPurlinsAuto?.takeoff;
    expect(takeoff).toBeDefined();
    if (!takeoff) return;

    expect(takeoff.lines).toHaveLength(1);
    expect(takeoff.lines[0].profile.profile).toBe("[]ПП 145x45x1,2");
    expect(takeoff.profileLength_m).toBe(720);
    expect(takeoff.profileMass_kg).toBeCloseTo(1539.2, 1);
    expect(takeoff.brackets.mass_kg).toBe(90);
  });

  it("проёмы уменьшают площадь обшивки, но не трогают прогоны", () => {
    // В «Калькуляторе ограждайки» полей проёмов нет вовсе, а в ведомости
    // 21876 количество прогонов записано формулой по целым стенам
    // (5*2*12*2 + 4*2*30*2). Прогоны идут поверх проёма, вырезается только
    // лист обшивки — поэтому вычет площади есть, а вычета прогонов нет.
    const blank = computeProject(coldProfnastilHangar);
    const withOpenings = computeProject({
      ...coldProfnastilHangar,
      openings: {
        gates: [{ count: 2, width_m: 4, height_m: 4.2 }],
        doors: [{ count: 2, width_m: 1, height_m: 2.1 }],
        windows: [{ count: 6, width_m: 3, height_m: 1.2 }],
      },
    });

    expect(withOpenings.envelope.wallArea).toBeLessThan(blank.envelope.wallArea);
    expect(withOpenings.wallPurlinsAuto?.takeoff.profileLength_m).toBe(
      blank.wallPurlinsAuto?.takeoff.profileLength_m,
    );
    expect(withOpenings.wallPurlinsAuto?.takeoff.brackets.count).toBe(
      blank.wallPurlinsAuto?.takeoff.brackets.count,
    );
  });

  it("без профнастила на стенах автоподбор не запускается", () => {
    const result = computeProject({
      ...coldProfnastilHangar,
      wallCladdingMaterial: "СП",
      wallPanel_mm: 100,
    });
    expect(result.wallPurlinsAuto).toBeNull();
  });
});

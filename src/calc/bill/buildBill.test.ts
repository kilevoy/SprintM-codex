import { describe, expect, it } from "vitest";
import { buildBill } from "./buildBill";
import { computeProject, type ProjectInputs } from "../project/computeProject";

const project22316: ProjectInputs = {
  city: "Берёзовский, Свердловская область",
  span: 18,
  length_m: 30,
  height_m: 5,
  gammaN: 1.0,
  bankK: "auto",
  roofingType: "С-П 150",
  deckingMark: "С44-1000-0,7",
  maxStepOverride_mm: 0,
  minStep_mm: 0,
  framePitchOverride_m: 0,
  wallPanel_mm: 100,
  roofPanel_mm: 150,
  openings: {
    gates: [{ count: 1, width_m: 4, height_m: 4.2 }],
    doors: [{ count: 1, width_m: 1, height_m: 2 }],
    windows: [{ count: 1, width_m: 30, height_m: 1 }],
  },
  snowGuards: true,
  railingPurlin: false,
  tubeStrutCount: 3,
  strutTube: "80х3",
  // Расчётчик вписывает это слагаемое в C96 округлённым до трёх знаков.
  // Само число приложение теперь выводит само (обрамление проёмов,
  // вывод!E68 = 0,43176) — здесь ставим его округление, чтобы итог сошёлся
  // с файлом до копейки; разница округления — 33 ₽ на разделе.
  extraTubeMass_t: 0.432,
  postSpacing_m: 2,
};

const project22318: ProjectInputs = {
  ...project22316,
  city: "Сургут",
  span: 15,
  length_m: 24,
  snowLoadOverride_kPa: 1.8,
  openings: {
    gates: [{ count: 2, width_m: 3, height_m: 3 }],
    doors: [{ count: 1, width_m: 1, height_m: 2 }],
    windows: [],
  },
  snowGuards: false,
  strutTube: "60х3",
  extraTubeMass_t: 0.795, // округление расчётчика от 0,79548
};

function totals(bill: ReturnType<typeof buildBill>) {
  return Object.fromEntries(
    [...bill.materials, ...bill.additional].map((s) => [s.sourceCell, s.totalCost]),
  );
}

describe("buildBill — «22316»", () => {
  const bill = buildBill(computeProject(project22316));

  it("reproduces every section total of the bill", () => {
    const t = totals(bill);
    expect(t["F32"]).toBeCloseTo(1499709.303380665, 2); // Итого каркас
    expect(t["F44"]).toBeCloseTo(62703.15789473685, 2); // Итого стены
    expect(t["F70"]).toBeCloseTo(92971.10571428572, 2); // ИТОГО водосток
    expect(t["F81"]).toBeCloseTo(151676.2614857143, 2); // Итого кровля
    // F100 на 3 996,60 ₽ выше файла — расчётчик подтвердила (вопрос 01),
    // что L156 в самом файле ошибочна: должно быть 31,5 м, а не 30.
    // Мы считаем по правилу и расходимся с файлом здесь намеренно.
    expect(t["F100"]).toBeCloseTo(1057872.8929239488, 2); // Итого каркас (доп.)
    expect(t["F114"]).toBeCloseTo(1502256.3264, 6); // Итого стена
    expect(t["F147"]).toBeCloseTo(2039506.3353061413, 2); // Итого кровля (доп.)
  });

  it("splits the fasteners the way the bill does", () => {
    // Фс11/Фс14 и Фс12 идут в первом «Каркасе» (строки 29–30), остальной
    // крепёж — во втором (85–95).
    const first = bill.materials[0].rows.map((r) => r.name);
    expect(first).toContain("Фс11, Фс14");
    expect(first).toContain("Фс12");
    const second = bill.additional[0].rows.map((r) => r.name);
    expect(second).not.toContain("Фс12");
    expect(second).toContain("Болт М16х50");
    expect(second).toContain("Конструкции из труб");
  });

  it("keeps the purlin line in metres of profile, as the bill writes it", () => {
    const purlin = bill.materials[0].rows.find((r) => r.name.startsWith("ПС 200х65"))!;
    expect(purlin.count).toBeCloseTo(780, 9);
    expect(purlin.cost).toBeCloseTo(448500, 6);
    expect(purlin.unitPrice).toBeCloseTo(575, 9);
  });

  it("carries 2% overhead in every section", () => {
    for (const s of [...bill.materials, ...bill.additional]) {
      if (s.subtotalCost === null) continue;
      expect(s.overheadCost).toBeCloseTo(s.subtotalCost * 0.02, 6);
      expect(s.totalCost).toBeCloseTo(s.subtotalCost * 1.02, 6);
    }
  });

  it("adds up to the bill's own bottom line, packaging included", () => {
    // Раньше здесь стоял зазор в 2 344 ₽: ворота 4 × 4,2 вычитались из
    // стены целиком, тогда как в файле — как 4 × 4. Расчётчик подтвердил,
    // что это правило («округляется в меньшую сторону», ширина тоже), и
    // после его применения расчёт сходится с файлом до копейки.
    // additionalTotal и всё, что от него зависит, — на 3 996,60 ₽ выше
    // файла: то же обрамление окна, см. комментарий выше про F100.
    expect(bill.materialsTotal).toBeCloseTo(1807059.8284754017, 6);
    expect(bill.additionalTotal).toBeCloseTo(4599635.5546300905, 6);
    expect(bill.recommendedPrice).toBeCloseTo(6406695.383105492, 6);
    expect(bill.totalWithPackaging).toBeCloseTo(6534829.290767602, 6);
  });

  it("reports the building mass in the same ballpark as the bill's 41 198 кг", () => {
    expect(bill.buildingMass_kg).toBeGreaterThan(38000);
    expect(bill.buildingMass_kg).toBeLessThan(44000);
  });
});

describe("buildBill — «22318»", () => {
  const bill = buildBill(computeProject(project22318));

  it("reproduces every section total of the bill", () => {
    const t = totals(bill);
    expect(t["F32"]).toBeCloseTo(1020158.6720137318, 2);
    expect(t["F44"]).toBeCloseTo(52395.78947368421, 2);
    expect(t["F70"]).toBeCloseTo(69922.74857142857, 2);
    expect(t["F81"]).toBeCloseTo(59489.14176, 2);
    expect(t["F100"]).toBeCloseTo(816638.3288764771, 2);
    expect(t["F114"]).toBeCloseTo(1283641.6134000001, 2);
    expect(t["F147"]).toBeCloseTo(1359670.890204094, 2);
  });

  it("matches «ИТОГО Цена + упаковка» (F151) exactly", () => {
    expect(bill.totalWithPackaging).toBeCloseTo(4755155.532531397, 2);
  });
});

describe("buildBill — состав поставки навеса", () => {
  it("оставляет каркас и кровельное ограждение без стен", () => {
    const bill = buildBill(computeProject(project22318), "frame-roof-cladding");
    const titles = [...bill.materials, ...bill.additional].map((section) => section.title);
    expect(titles).toContain("Каркас");
    expect(titles).toContain("Кровля");
    expect(titles).not.toContain("Стены");
    expect(titles).not.toContain("Стена");
    expect(titles).not.toContain("Водосток");
    expect(bill.totalWithPackaging).not.toBeNull();
  });
});

/**
 * Третий реальный проект — «22285» (Коркино, 18 × 48, h6, шаг 4).
 *
 * Он появился позже двух первых и потому проверяет, а не подтверждает:
 * ни одна формула по нему не снималась. Сошлись вся цепочка подбора
 * (с/в 4/3, блок IV × 0,8, шаг 4, шаг прогонов 1510, ПГС300/20х80х3 и
 * ПГС245/20х80х2,5, 2ПС 145х45х1,5, 292 болта, 258 кг фасонок, 3964,8 кг
 * прогонов) и пять разделов ведомости из семи.
 *
 * Он же принёс два исправления: коэффициент болтов М16 берётся по шагу
 * рам, а не по пролёту (на восемнадцати метрах здесь 30, а в «22316» 50),
 * и подтвердил на третьем проекте формулу обрамления проёмов — 0,85596 т.
 *
 * Два раздела расходятся, и оба — из-за ячеек, которые расчётчик
 * заполняет руками; см. вопросы расчётчику.
 */
const project22285: ProjectInputs = {
  city: "Коркино",
  span: 18,
  length_m: 48,
  height_m: 6,
  gammaN: 1.0,
  bankK: "auto",
  roofingType: "С-П 150",
  deckingMark: "С44-1000-0,7",
  maxStepOverride_mm: 0,
  minStep_mm: 0,
  framePitchOverride_m: 0,
  wallPanel_mm: 100,
  roofPanel_mm: 150,
  openings: {
    gates: [{ count: 2, width_m: 4, height_m: 4.5 }],
    doors: [{ count: 2, width_m: 1, height_m: 2 }],
    windows: [{ count: 1, width_m: 46, height_m: 1 }],
  },
  snowGuards: false,
  railingPurlin: false,
  tubeStrutCount: 3,
  postSpacing_m: 2,
};

describe("buildBill — «22285», третий реальный проект", () => {
  const project = computeProject(project22285);
  const bill = buildBill(project);
  const t = totals(bill);

  it("reproduces the selection chain without a single manual input", () => {
    if (!project.climate.ok || !project.frame?.ok || !project.frame.value) {
      throw new Error("подбор не состоялся");
    }
    const f = project.frame.value;
    expect(project.climate.value.standard).toBe("4/3");
    expect(project.bankBlock?.snowDistrict).toBe("IV");
    expect(project.bankBlock?.bankK).toBe(0.8);
    expect(project.geometry.framePitch_m).toBe(4);
    expect(project.maxPurlinStep).toBe(2150);
    expect(project.purlin?.step_mm).toBe(1510);
    expect(f.beam.profile).toBe("ПГС300/20х80х3");
    expect(f.column.profile).toBe("ПГС245/20х80х2,5");
    expect(project.purlin?.profile.name).toBe("2ПС 145х45х1,5");
    expect(f.bolts.totalInFrame).toBe(292);
    expect(f.massGussetPlates_kg).toBe(258);
    expect(project.purlinLayout?.totalMass_kg).toBeCloseTo(3964.8, 6);
    expect(project.purlinLayout?.lineCount).toBe(14);
    expect(project.effectiveStrutTube).toBe("60х3");
  });

  it("derives the openings framing the estimator wrote as 0,856 т", () => {
    // вывод!E68 = 0,85596: ворота 350×2×1,05 + двери (4+4)×2×7,2×1,05
    expect(project.effectiveExtraTubeMass_t).toBeCloseTo(0.85596, 9);
  });

  it("counts the М16 bolts by the span — 4466 against the file's 4246", () => {
    // В файле коэффициент 30 при пролёте 18 м; расчётчик подтвердила,
    // что это ошибка и должно быть 50. Расходимся намеренно.
    const bolts = bill.additional[0].rows.find((r) => r.name === "Болт М16х50")!;
    expect(bolts.count).toBeCloseTo(4466, 6);
  });

  it("reproduces five of the seven section totals exactly", () => {
    expect(t["F32"]).toBeCloseTo(2326851.691713581, 6); // Итого каркас
    expect(t["F44"]).toBeCloseTo(87612.63157894737, 6); // Итого стены
    expect(t["F70"]).toBeCloseTo(158523.73714285716, 6); // ИТОГО водосток
    expect(t["F81"]).toBeCloseTo(108525.32352, 6); // Итого кровля
    expect(t["F147"]).toBeCloseTo(3283632.3316898257, 6); // Итого кровля (доп.)
  });

  it("differs on the wall by the gable allowance the file forgot to double", () => {
    // В «22316» и «22318» надбавка на фронтоны записана как пролёт×2×2,
    // здесь — как пролёт×2, то есть 36 м² вместо 72. Расчётчик: «в 22285
    // тоже надо умножить на 2 для запаса, для пролётов от 12 м умножаем».
    expect(project.envelope.wallArea).toBeCloseTo(782, 6); // в файле 746
    const gap = t["F114"]! - 2243832.0162;
    expect(gap).toBeCloseTo((36 * 2740 + (36 / 4) * 6 * 1.1 * 51.9) * 1.02, 4);
  });

  it("differs on the frame extras by the bolts and two hand-typed cells", () => {
    // 220 болтов с гайками и шайбами (коэффициент 30 вместо 50 в файле)
    // и металл по другому снимку прайса: труба 137 430 против 136 050,
    // уголок 166 750 против 172 500.
    //
    // Обрамление окна (вопрос 01) сюда больше не примешивается: окно
    // 46 м при шаге 4 м даёт 48 м (12 шагов) — в этом файле расчётчик
    // уже вписала верное округлённое число, так что наше правило и факт
    // совпадают день в день, и по этой строке расхождения нет вовсе.
    // Остаток вырос против прежнего (9 797,43 ₽) именно потому, что
    // раньше мы округление не делали и брали окно как есть (46, а не
    // 48) — заниженная масса случайно ГАСИЛА часть разницы в ценах
    // трубы/уголка. Теперь эта случайная компенсация ушла, и остаток —
    // это честно только болты и разница снимков прайса.
    expect(t["F100"]! - 1572690.0028402077).toBeCloseTo(15126.24, 1);
  });
});

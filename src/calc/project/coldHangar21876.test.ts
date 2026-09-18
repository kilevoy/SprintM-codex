import { describe, expect, it } from "vitest";
import { computeProject, type ProjectInputs } from "./computeProject";
import { buildBill } from "../bill/buildBill";

/**
 * Полная сверка холодного ангара с ведомостью 21876 (Каргалейка).
 *
 * Книга: `Y:\Предварительные расчеты\Предрасчеты на проверку\Каргалейка\
 * 21876.xlsx`, АКТИВНЫЙ лист `12м` (в книге пять листов, остальные четыре —
 * остатки от предыдущего проекта и к объекту отношения не имеют).
 *
 * 12×30, высота до карниза 4,5, шаг рам 6, окрашенный профлист С-18 0,5
 * по стенам и С-44 0,7 по кровле, без утепления, проёмов и водостока.
 *
 * Три входа заданы по ячейкам книги, а не угаданы:
 *   hasDrainage = false   — раздел «Водосток» (строки 61-69) домножен на 0
 *   tubeStrutCount = 3    — 21876!K96 «Количество распорок из трубы»
 *   extraTubeMass_t 0,735 — ручная добавка в конце 21876!C97
 *
 * СВЕРЯЕМ КОЛИЧЕСТВА И МАССЫ, А НЕ РУБЛИ. Расчёты сделаны в разные даты,
 * и цены за это время менялись: уголок стоит 139 150 ₽/т в 21876 и
 * 172 500 в 22316 — разброс 24 % на одной и той же позиции. Сравнение
 * итогов в рублях показывало бы возраст прайса, а не качество расчёта.
 * Стоимость проверяется только там, где цена берётся из того же
 * источника, что у расчётчика.
 */
const kargaleyka: ProjectInputs = {
  city: "Каргалейка",
  manualClimate: { snowLoad_kPa: 1.5, windDistrict: "II", label: "Каргалейка" },
  span: 12,
  length_m: 30,
  height_m: 4.5,
  gammaN: 0.8,
  bankK: 0.8,
  svOverride: "3/2",
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
  tubeStrutCount: 3,
  strutTube: "80х3",
  extraTubeMass_t: 0.735,
  postSpacing_m: 2,
  terrainType: "B",
  wallCladdingMaterial: "профнастил",
  wallProfnastilThickness_mm: 0.5,
  roofProfnastilThickness_mm: 0.7,
  wallPurlinsAuto: { profileHeight_mm: 145, gablePostSpacing_m: 6 },
  hasDrainage: false,
};

const bill = buildBill(computeProject(kargaleyka));
const total = (group: "materials" | "additional", title: string) =>
  bill[group].find((s) => s.title === title)?.totalCost ?? 0;
const row = (group: "materials" | "additional", section: string, name: string) =>
  bill[group].find((s) => s.title === section)?.rows.find((r) => r.name === name);

describe("холодный ангар 21876 — сверка по разделам", () => {
  it("«Стены» сходится точно: 21876!F45", () => {
    // У расчётчика прогоны, кронштейны, уголки и профлист лежат в одном
    // блоке, SprintM режет его на три раздела — сверяем сумму.
    const walls =
      total("materials", "Стены") +
      total("additional", "Стена") +
      (bill.wallPurlins?.totalCost ?? 0);
    expect(walls).toBeCloseTo(643446.63, 1);
  });

  it("«Водосток» сходится точно: 21876!F71 = 0", () => {
    expect(total("materials", "Водосток")).toBe(0);
    // Вместе с разделом занулена и строка профиля под жёлоб, 21876!C26.
    expect(row("materials", "Каркас", "ПС 145х1,5")?.count).toBe(0);
  });

  it("«Кровля» сходится точно: 21876!F82", () => {
    expect(total("materials", "Кровля") + total("additional", "Кровля")).toBeCloseTo(473681.3, 1);
  });

  it("«Каркас»: все количества совпадают, кроме толщины балки", () => {
    // Столбец C активного листа, строки 21-30.
    const counts: [string, number][] = [
      ["ПГС245/20х80х2,5", 149.074], // C21 = I17*J16*2
      ["ПГС300/20х80х2", 106.32], //    C22 = I17*4*(C10-0,07)
      ["ПС 245х65х1,5", 480], //        C24 = 4*2*2*C9
      ["ПС 145х1,5", 0], //             C26 = 4*C9*0, водосток снят
      ["Лист пл. оц. 1мм (тяж)", 15.84], // C27
      ["ПШ 61х1", 0], //                C28 = ...*0
      ["Фс11, Фс14", 210], //           C29 = I17*(C8+2*C10)/0,6
      ["Фс12", 420], //                 C30 = 2*C29
    ];
    for (const [name, expected] of counts) {
      expect(row("materials", "Каркас", name)?.count, name).toBeCloseTo(expected, 3);
    }
  });

  it("балка: длина сходится, сечение — нет (2,5 против 2,0)", () => {
    // Подбор даёт ПГС 245х80х2,5, расчётчик поставил 2,0. В 21876!B21,
    // E21 и H21 название, цена и вес вписаны руками, формулы нет — то
    // есть сечение выбрано вне книги. Вопрос 4.
    //
    // Разницу меряем в массе, а не в рублях: ведомость оценивала балку
    // по прайсу своей даты, и рублёвая дельта смешала бы два эффекта.
    const beam = row("materials", "Каркас", "ПГС245/20х80х2,5");
    expect(beam?.count).toBeCloseTo(149.074, 3);
    // 21876!H21 = 7,04 кг/п.м. за 2,0 мм против 8,704 у 2,5 мм.
    expect(beam?.mass_kg).toBeCloseTo(149.074 * 8.704, 0);
    const excelMass = 149.074 * 7.04;
    expect((beam?.mass_kg ?? 0) - excelMass).toBeCloseTo(247.96, 0);
  });

  it("«Доп. каркас»: все тоннажи совпадают", () => {
    // Формулы связей верны: 21876!C97 =
    //   4*(C10+0,5)*J88 + L86*K96*C9 + (4*2)*L93*L86 + (2*2)*L94*L86 + 0,735
    // где L93 = √(6² + шаг²)·1,1 — катет 6 = пролёт/2 при пролёте ≤ 12.
    const tube = row("additional", "Каркас", "Конструкции из труб");
    const angle = row("additional", "Каркас", "Уголок");
    const plate = row("additional", "Каркас", "Лист (фасонки)");
    expect(tube?.count).toBeCloseTo(2.54623, 4);
    expect(angle?.count).toBeCloseTo(0.46176, 5);
    expect(plate?.count).toBeCloseTo(1.338, 3);

    // Цены за тонну не сверяем: 21876 считался в другую дату, уголок там
    // 139 150 ₽/т против 172 500 в 22316. Вопрос 11 расчётчику закрыт.

    // Саморезов на раму расчётчик ставит руками: 530 / 540 / 614 / 634 по
    // объектам, на 21876 это 540 (C86 = K91*540). Вопрос 12.
    expect(row("additional", "Каркас", "Саморез 5,5x25")?.count).toBe(3180);

    // Остальной крепёж совпадает: C87-C90, C94-C96.
    const fasteners: [string, number][] = [
      ["Дюбель-гвоздь 6х60", 169],
      ["Болт М12х40", 96],
      ["Болт М16х50", 1752],
      ["Гайка М16", 1752],
      ["Шайба 16 пруж", 1752],
    ];
    for (const [name, expected] of fasteners) {
      expect(row("additional", "Каркас", name)?.count, name).toBe(expected);
    }
  });

  it("строки «р» (ПГС 145х70х2) в SprintM нет — и в ведомости она не оценена", () => {
    // 21876!C23 = 3*C9 = 90 п.м., цена в E23 стоит, но F23 и G23 пустые
    // во всех восьми книгах: ни в стоимость, ни в массу не попадает.
    // На 21876 это 75 033 ₽ мимо кассы. Вопрос 14.
    expect(row("materials", "Каркас", "ПГС 145х70х2")).toBeUndefined();
  });
});

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
 * Итог: из пяти разделов три сходятся ТОЧНО, два расходятся по причинам,
 * не связанным с формулами (см. ниже).
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

  it("«Каркас» расходится ровно на балку: 21876!F32", () => {
    // Подбор даёт ПГС 245х80х2,5, расчётчик поставил 2,0 — причём в
    // 21876!B21/E21/H21 название, цена и вес вписаны руками, формулы нет.
    // Вопрос 4 в docs/ВОПРОСЫ_РАСЧЁТЧИКУ.md.
    const delta = total("materials", "Каркас") - 725589.96;
    const beam = row("materials", "Каркас", "ПГС245/20х80х2,5");
    expect(beam?.count).toBeCloseTo(149.074, 3);
    // 21876!F21 = 154 023,74 при 1033,2 ₽/п.м. за 2,0 мм.
    const beamDelta = (beam?.cost ?? 0) - 154023.74;
    expect(delta).toBeCloseTo(beamDelta * 1.02, 1);
    expect(delta).toBeCloseTo(38956.74, 1);
  });

  it("«Доп. каркас»: все тоннажи совпадают, расходятся только цены", () => {
    // Формулы связей верны: 21876!C97 =
    //   4*(C10+0,5)*J88 + L86*K96*C9 + (4*2)*L93*L86 + (2*2)*L94*L86 + 0,735
    // где L93 = √(6² + шаг²)·1,1 — катет 6 = пролёт/2 при пролёте ≤ 12.
    const tube = row("additional", "Каркас", "Конструкции из труб");
    const angle = row("additional", "Каркас", "Уголок");
    const plate = row("additional", "Каркас", "Лист (фасонки)");
    expect(tube?.count).toBeCloseTo(2.54623, 4);
    expect(angle?.count).toBeCloseTo(0.46176, 5);
    expect(plate?.count).toBeCloseTo(1.338, 3);

    // Цены за тонну в 21876 старее тех, что закэшированы в SprintM из
    // 22316/22318. Это возраст прайса, а не ошибка расчёта.
    const priceGap =
      (tube?.count ?? 0) * (136050 - 132830) +
      (angle?.count ?? 0) * (172500 - 139150) +
      (plate?.count ?? 0) * (137770 - 126500);
    expect(priceGap).toBeCloseTo(38678.2, 0);

    // Саморезов на раму расчётчик ставит руками: 540 на 21876, 530 здесь.
    const screws = row("additional", "Каркас", "Саморез 5,5x25");
    expect(screws?.count).toBe(3180);

    const delta = total("additional", "Каркас") - 669665.4;
    const screwGap = (3180 - 3240) * (screws?.unitPrice ?? 0);
    expect(delta).toBeCloseTo((priceGap + screwGap) * 1.02, 0);
  });
});

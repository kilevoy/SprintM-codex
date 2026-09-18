import { describe, expect, it } from "vitest";
import { computeProject, type ProjectInputs } from "./computeProject";
import { buildBill } from "../bill/buildBill";

/**
 * Разделы «Каркас» и «Стены» для холодного ангара с профнастилом.
 *
 * Эталон — ведомость 21876 (Каргалейка, 12×30, высота 4,5, шаг рам 6,
 * окрашенный профлист С-18 0,5, без утепления и проёмов).
 *
 * Сэндвич-вариант этих же разделов сверяется отдельно на «22316» и
 * «22318» в computeProject.test.ts и правками ниже не затрагивается.
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
  tubeStrutCount: 0,
  strutTube: "80х3",
  extraTubeMass_t: 0,
  postSpacing_m: 2,
  terrainType: "B",
  wallCladdingMaterial: "профнастил",
  wallProfnastilThickness_mm: 0.5,
  roofProfnastilThickness_mm: 0.7,
  wallPurlinsAuto: { profileHeight_mm: 145, gablePostSpacing_m: 6 },
  // На 21876 весь раздел «Водосток» занулён (строки 61-69 домножены на 0),
  // и вместе с ним занулена строка «ПС 145х1,5 водосток» (C26 = 4*C9*0).
  hasDrainage: false,
};

const row = (bill: ReturnType<typeof buildBill>, section: string, name: string) =>
  bill.materials.find((s) => s.title === section)?.rows.find((r) => r.name === name);

describe("разделы ведомости под профнастилом", () => {
  it("ПШ 61х1 не считается: под профлистом он обнулён на всех трёх объектах", () => {
    // 21876, 22258 и 22304 дописывают множитель 0: 2*(C8+2*C9)*1.1*0.
    // Под сэндвичем считается по другой формуле — 2*(C8+2*C10)*1.1.
    const bill = buildBill(computeProject(kargaleyka));
    expect(row(bill, "Каркас", "ПШ 61х1")?.count).toBe(0);
  });

  it("«ПС 145х1,5 водосток» следует за водостоком, а не за обшивкой", () => {
    // Это профиль под жёлоб, а не стеновой прогон: 22318 называет позицию
    // дословно «ПС 145х1,5 водосток». Зависимость строгая по семи книгам:
    // где занулён раздел водостока, там занулена и эта строка.
    const noGutter = buildBill(computeProject(kargaleyka));
    expect(row(noGutter, "Каркас", "ПС 145х1,5")?.count).toBe(0);
    expect(row(noGutter, "Каркас", "ПС 145х1,5")?.cost).toBe(0);

    // 22304 — тоже профнастил, но с водостоком: 4 × 40 = 160 п.м.
    // Раньше строка была привязана к обшивке и здесь терялось 72 072 ₽.
    const withGutter = buildBill(
      computeProject({ ...kargaleyka, length_m: 40, hasDrainage: true }),
    );
    expect(row(withGutter, "Каркас", "ПС 145х1,5")?.count).toBeCloseTo(160, 9);
  });

  it("лист 0,7 под профнастилом считается с коэффициентом 1,11", () => {
    // 21876!C73 = C9*0,5*1,11 = 16,65 м² против 16,5 при 1,10.
    // 21876, 22258 и 22304 дают 1,11; четыре сэндвич-книги — 1,10.
    const bill = buildBill(computeProject(kargaleyka));
    const sheet = row(bill, "Кровля", "Лист 0,7мм оц");
    expect(sheet?.count).toBeCloseTo(16.65, 9);
    expect(sheet?.cost).toBeCloseTo(10053.936, 3);
  });

  it("под сэндвич-панелью обе строки остаются на месте", () => {
    const bill = buildBill(
      computeProject({
        ...kargaleyka,
        wallCladdingMaterial: "СП",
        wallPanel_mm: 100,
        wallPurlinsAuto: undefined,
        // Водосток есть на всех четырёх сэндвич-объектах.
        hasDrainage: true,
      }),
    );
    // 4 × длина = 120 п.м., 2 × (пролёт + 2 × высота) × 1,1 = 46,2 п.м.
    expect(row(bill, "Каркас", "ПС 145х1,5")?.count).toBeCloseTo(120, 6);
    expect(row(bill, "Каркас", "ПШ 61х1")?.count).toBeCloseTo(46.2, 6);
  });

  it("доборные элементы: уголок 50х50 трёхметровый вместо У.115", () => {
    // Ведомость 21876: Уголок 50х50 нар = 4*C10/2.9 = 6,21 шт по 640 ₽.
    const bill = buildBill(computeProject(kargaleyka));
    const outer = row(bill, "Стены", "Уголок 50х50 нар");
    expect(outer?.count).toBeCloseTo((4 * 4.5) / 2.9, 9);
    expect(outer?.count).toBeCloseTo(6.207, 3);
    expect(outer?.unitPrice).toBe(640);
    expect(Math.round(outer?.cost ?? 0)).toBe(3972);
    expect(row(bill, "Стены", "У.115 наружный (2м)")).toBeUndefined();
  });

  it("внутренний уголок под профлистом не считается", () => {
    // Внутренней обшивки нет ни на одном из трёх объектов; формулу
    // дописывают множителем 0 на 21876 и 22258. На 21604 не дописали и
    // уголок посчитан — это расхождение вынесено в вопросы расчётчику.
    const bill = buildBill(computeProject(kargaleyka));
    expect(row(bill, "Стены", "Уголок 50х50 вн")?.count).toBe(0);
  });

  it("остальные строки каркаса совпадают с ведомостью 21876", () => {
    const bill = buildBill(computeProject(kargaleyka));
    // Колонна, кровельные прогоны, лист и обе позиции фасонок — в ноль.
    expect(Math.round(row(bill, "Каркас", "ПГС300/20х80х2")?.cost ?? 0)).toBe(123469);
    expect(Math.round(row(bill, "Каркас", "ПС 245х65х1,5")?.cost ?? 0)).toBe(312480);
    expect(Math.round(row(bill, "Каркас", "Лист пл. оц. 1мм (тяж)")?.cost ?? 0)).toBe(12400);
    expect(row(bill, "Каркас", "Фс11, Фс14")?.count).toBe(210);
    expect(Math.round(row(bill, "Каркас", "Фс11, Фс14")?.cost ?? 0)).toBe(61110);
    expect(row(bill, "Каркас", "Фс12")?.count).toBe(420);
    expect(Math.round(row(bill, "Каркас", "Фс12")?.cost ?? 0)).toBe(47880);

    // Единственная несошедшаяся строка — балка: у нас 245х80х2,5, в
    // ведомости 245х80х2. Разница 38 193 ₽; вопрос расчётчику, подбор
    // это или его ручная правка.
    expect(row(bill, "Каркас", "ПГС245/20х80х2,5")?.count).toBeCloseTo(149.07, 1);
  });
});

import { describe, expect, it } from "vitest";
import { computeProject, type ProjectInputs } from "../project/computeProject";
import { buildBill } from "./buildBill";

/**
 * Стеновые прогоны в ведомости и в составах поставки.
 *
 * Объект — «Каргалейка» (21876): холодный ангар 12×30 с профнастилом,
 * нагрузки заданы вручную (города нет в справочнике). Шаг стоек торца
 * взят 6 м — при нём сходится масса кронштейнов объектной ведомости.
 */
const hangar: ProjectInputs = {
  city: "Каргалейка",
  manualClimate: { snowLoad_kPa: 1.5, windDistrict: "II", label: "Каргалейка" },
  span: 12,
  length_m: 30,
  // Высота до карниза из шапки ведомости; добавку +0,5 правило высот
  // добавляет само (вдоль 5,0, торец 6,5).
  height_m: 4.5,
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
  wallPurlinsAuto: { profileHeight_mm: 145, gablePostSpacing_m: 6 },
};

describe("стеновые прогоны в ведомости", () => {
  it("идёт отдельным разделом с прогонами и кронштейнами", () => {
    const bill = buildBill(computeProject(hangar));
    const purlins = bill.wallPurlins;
    expect(purlins).not.toBeNull();
    if (!purlins) return;

    expect(purlins.title).toBe("Стеновые прогоны");
    const purlin = purlins.rows.find((row) => row.name.startsWith("ПП 145x45x1,2"));
    expect(purlin).toBeDefined();
    // Ведомость 21876: 720 п.м. по 314,0 ₽ (прайс даёт 313,95).
    expect(purlin?.count).toBe(720);
    expect(purlin?.unit).toBe("п.м.");
    expect(purlin?.unitPrice).toBeCloseTo(313.95, 2);
    expect(purlin?.cost).toBeCloseTo(720 * 313.95, 2);

    // Кронштейн заказывается погонным метром заготовки, а не штуками:
    // 21876!C38 = G38/0,75*0,2 = 90/0,75*0,2 = 24 п.м., 21876!E38 = 529,44.
    const brackets = purlins.rows.find((row) => row.name.startsWith("Кронштейны"));
    expect(brackets?.mass_kg).toBe(90);
    expect(brackets?.unit).toBe("п.м.");
    expect(brackets?.count).toBeCloseTo(24, 9);
    expect(brackets?.unitPrice).toBe(529.44);
    // Ведомость 21876!F38 = 12 706,56 ₽.
    expect(brackets?.cost).toBeCloseTo(12706.56, 2);
  });

  it("блок «Стены» вместе с прогонами даёт ровно 21876!F45", () => {
    // У расчётчика прогоны, кронштейны, уголки и профлист лежат в одном
    // блоке «Стены», и накладные 2% (F44) начисляются на всё сразу:
    //   (226 044 + 12 706,56 + 3 972,41 + 388 107,06) * 1,02 = 643 446,63
    // SprintM режет тот же блок на три раздела, поэтому сверяем сумму.
    const bill = buildBill(computeProject(hangar));
    const walls = bill.materials.find((s) => s.title === "Стены")?.totalCost ?? 0;
    const cladding = bill.additional.find((s) => s.title === "Стена")?.totalCost ?? 0;
    const purlins = bill.wallPurlins?.totalCost ?? 0;
    expect(walls + cladding + purlins).toBeCloseTo(643446.63, 1);
  });

  it("входит в стоимость проекта", () => {
    const bill = buildBill(computeProject(hangar));
    const withoutEnvelope = buildBill(computeProject({ ...hangar, wallPurlinsAuto: undefined }));
    expect(bill.wallPurlins).not.toBeNull();
    expect(withoutEnvelope.wallPurlins).toBeNull();
    // Раздел добавляет к итогу ровно свою стоимость с накладными.
    const delta = (bill.recommendedPrice ?? 0) - (withoutEnvelope.recommendedPrice ?? 0);
    expect(delta).toBeCloseTo(bill.wallPurlins?.totalCost ?? 0, 6);
    expect(delta).toBeCloseTo((720 * 313.95 + 12706.56) * 1.02, 2);
  });

  it("под сэндвич-панель каркас поставляется без прогонов", () => {
    const bill = buildBill(computeProject(hangar), "frame-roof");
    expect(bill.wallPurlins).toBeNull();
  });

  it("под профнастил каркас поставляется с прогонами", () => {
    const bill = buildBill(computeProject(hangar), "frame-roof-profnastil");
    expect(bill.wallPurlins).not.toBeNull();
    // Прогоны входят в вес поставки, в отличие от сэндвич-варианта.
    const sandwich = buildBill(computeProject(hangar), "frame-roof");
    expect(bill.buildingMass_kg).toBeGreaterThan(sandwich.buildingMass_kg);
    expect(bill.buildingMass_kg - sandwich.buildingMass_kg).toBeCloseTo(
      (bill.wallPurlins?.totalMass_kg ?? 0),
      6,
    );
  });
});

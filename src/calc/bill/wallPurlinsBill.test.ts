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

    const brackets = purlins.rows.find((row) => row.name.startsWith("Кронштейны"));
    expect(brackets?.mass_kg).toBe(90);
    expect(brackets?.cost).toBeNull();
    expect(brackets?.note).toBeTruthy();
  });

  it("не входит в стоимость проекта, пока цена кронштейнов не перенесена", () => {
    const bill = buildBill(computeProject(hangar));
    const withoutEnvelope = buildBill(computeProject({ ...hangar, wallPurlinsAuto: undefined }));
    expect(bill.wallPurlins).not.toBeNull();
    expect(withoutEnvelope.wallPurlins).toBeNull();
    // Итоги проекта от появления раздела не меняются.
    expect(bill.recommendedPrice).toBe(withoutEnvelope.recommendedPrice);
    expect(bill.totalWithPackaging).toBe(withoutEnvelope.totalWithPackaging);
  });

  it("под сэндвич-панель каркас поставляется без прогонов", () => {
    const bill = buildBill(computeProject(hangar), "frame-roof");
    expect(bill.wallPurlins).toBeNull();
  });

  it("под профнастил каркас поставляется с прогонами", () => {
    const bill = buildBill(computeProject(hangar), "frame-roof-profnastil");
    expect(bill.wallPurlins).not.toBeNull();
    // Обвязка входит в вес поставки, в отличие от сэндвич-варианта.
    const sandwich = buildBill(computeProject(hangar), "frame-roof");
    expect(bill.buildingMass_kg).toBeGreaterThan(sandwich.buildingMass_kg);
    expect(bill.buildingMass_kg - sandwich.buildingMass_kg).toBeCloseTo(
      (bill.wallPurlins?.totalMass_kg ?? 0),
      6,
    );
  });
});

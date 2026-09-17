import type { ProjectResult } from "../project/computeProject";

export interface BillRow {
  name: string;
  count: number | null;
  unit: string;
  unitPrice: number | null;
  cost: number | null;
  mass_kg: number | null;
  /** Пометка: почему строки нет в итоге или почему число приблизительное. */
  note?: string;
}

export interface BillSection {
  title: string;
  rows: BillRow[];
  /** Сумма позиций до накладных, ₽. */
  subtotalCost: number | null;
  /** Накладные расходы 2%, ₽. */
  overheadCost: number | null;
  /** Итог раздела — то, что в исходнике стоит в строке «Итого …». */
  totalCost: number | null;
  totalMass_kg: number;
  /** Ячейка исходной ведомости, с которой этот итог сверяется. */
  sourceCell: string;
}

export interface Bill {
  /** Раздел «МАТЕРИАЛЫ ЗАО ИНСИ» — строки 20–81 исходника. */
  materials: BillSection[];
  /** Раздел «Дополнительные материалы» — строки 84–147. */
  additional: BillSection[];
  materialsTotal: number | null;
  additionalTotal: number | null;
  /** «Рекомендуемая цена реализации» (F149) — сумма обоих разделов. */
  recommendedPrice: number | null;
  /** Упаковка 2% (F150). */
  packaging: number | null;
  /** «ИТОГО Цена + упаковка» (F151). */
  totalWithPackaging: number | null;
  /** «Вес здания» (F154). */
  buildingMass_kg: number;
}

/** Накладные расходы — 0,02 во всех разделах обеих ведомостей. */
const OVERHEAD_RATE = 0.02;
/** Упаковка — те же 2% (E150). */
const PACKAGING_RATE = 0.02;

function section(
  title: string,
  sourceCell: string,
  rows: BillRow[],
  options: { overhead?: boolean } = {},
): BillSection {
  const withOverhead = options.overhead !== false;
  const anyUnknown = rows.some((r) => r.cost === null);
  const subtotalCost = anyUnknown ? null : rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const overheadCost = subtotalCost === null || !withOverhead ? null : subtotalCost * OVERHEAD_RATE;
  return {
    title,
    rows,
    subtotalCost,
    overheadCost,
    totalCost: subtotalCost === null ? null : subtotalCost + (overheadCost ?? 0),
    totalMass_kg: rows.reduce((s, r) => s + (r.mass_kg ?? 0), 0),
    sourceCell,
  };
}

function sumOrNull(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

/**
 * Ведомость материалов в том виде и порядке, в каком её ведёт расчётчик.
 *
 * Приложение считает те же числа россыпью карточек; здесь они собраны в
 * документ по структуре листа «12м»: два блока разделов, у каждого свои
 * 2% накладных и строка «Итого», затем коммерческая часть.
 *
 * Итоги разделов сверяются с ячейками исходника — F32, F44, F70, F81,
 * F100, F114, F147 — и это проверяется тестом на обоих реальных проектах.
 */
export function buildBill(project: ProjectResult, supplyScope: "full" | "frame-roof" = "full"): Bill {
  const {
    frameTakeoff,
    purlinLayout,
    frameExtras,
    frameFasteners,
    bracing,
    wallTrim,
    drainage,
    roofTrim,
    wallCladding,
    roofCladding,
  } = project;

  const fasteners = frameFasteners?.items ?? [];
  // Фс11/Фс14 и Фс12 стоят в первом разделе «Каркас» (строки 29–30),
  // остальной крепёж — во втором (строки 85–95).
  const isPlate = (name: string) => name.startsWith("Фс");

  const profileRow = (member: {
    profileName: string;
    totalLength_m: number;
    totalMass_kg: number | null;
    totalCost: number | null;
  }): BillRow => ({
    name: member.profileName,
    count: member.totalLength_m,
    unit: "п.м.",
    unitPrice:
      member.totalCost !== null && member.totalLength_m > 0
        ? member.totalCost / member.totalLength_m
        : null,
    cost: member.totalCost,
    mass_kg: member.totalMass_kg,
  });

  // ---- МАТЕРИАЛЫ ЗАО «ИНСИ» -----------------------------------------
  const frameRows: BillRow[] = [];
  if (frameTakeoff) {
    // Порядок как в ведомости: сначала балка, потом колонна.
    frameRows.push(profileRow(frameTakeoff.beam));
    frameRows.push(profileRow(frameTakeoff.column));
  }
  if (purlinLayout && project.purlin) {
    frameRows.push({
      name: project.purlin.profile.name.replace(/^2/, ""),
      count: purlinLayout.totalProfileLength_m,
      unit: "п.м.",
      unitPrice:
        purlinLayout.totalCost !== null && purlinLayout.totalProfileLength_m > 0
          ? purlinLayout.totalCost / purlinLayout.totalProfileLength_m
          : null,
      cost: purlinLayout.totalCost,
      mass_kg: purlinLayout.totalMass_kg,
    });
  }
  for (const i of frameExtras?.items ?? []) {
    frameRows.push({
      name: i.name,
      count: i.count,
      unit: i.unit,
      unitPrice: i.unitPrice,
      cost: i.cost,
      mass_kg: i.mass_kg,
    });
  }
  for (const i of fasteners.filter((f) => isPlate(f.name))) {
    frameRows.push({
      name: i.name,
      count: i.count,
      unit: "шт.",
      unitPrice: i.unitPrice,
      cost: i.cost,
      mass_kg: i.mass_kg,
      note: i.isEstimated ? "ставка не подтверждена для этого пролёта" : undefined,
    });
  }

  const materials: BillSection[] = [
    section("Каркас", "F32", frameRows),
    section(
      "Стены",
      "F44",
      wallTrim.items.map((i) => ({
        name: i.name,
        count: i.count,
        unit: i.unit,
        unitPrice: i.unitPrice,
        cost: i.cost,
        mass_kg: i.mass_kg,
      })),
    ),
    section(
      "Водосток",
      "F70",
      drainage.items.map((i) => ({
        name: i.name,
        count: i.count,
        unit: i.unit,
        unitPrice: i.unitPrice,
        cost: i.cost,
        mass_kg: i.mass_kg,
      })),
    ),
    section(
      "Кровля",
      "F81",
      roofTrim.items.map((i) => ({
        name: i.name,
        count: i.count,
        unit: i.unit,
        unitPrice: i.unitPrice,
        cost: i.cost,
        mass_kg: i.mass_kg,
      })),
    ),
  ];

  // ---- Дополнительные материалы --------------------------------------
  const additionalFrameRows: BillRow[] = fasteners
    .filter((f) => !isPlate(f.name))
    .map((i) => ({
      name: i.name,
      count: i.count,
      unit: "шт.",
      unitPrice: i.unitPrice,
      cost: i.cost,
      mass_kg: i.mass_kg,
      note: i.isEstimated ? "ставка не подтверждена для этого пролёта" : undefined,
    }));
  for (const i of bracing?.items ?? []) {
    additionalFrameRows.push({
      name: i.name,
      count: i.mass_t,
      unit: "т",
      unitPrice: i.unitPrice_per_t,
      cost: i.cost,
      mass_kg: i.mass_t === null ? null : i.mass_t * 1000,
      note: i.cost === null ? bracing?.missing : undefined,
    });
  }

  const claddingRows = (items: typeof wallCladding.items): BillRow[] =>
    items.map((i) => ({
      name: i.name,
      count: i.count,
      unit: i.unit,
      unitPrice: i.unitPrice,
      cost: i.cost,
      mass_kg: i.mass_kg,
    }));

  const additional: BillSection[] = [
    section("Каркас", "F100", additionalFrameRows),
    section("Стена", "F114", claddingRows(wallCladding.items)),
  ];
  if (roofCladding) additional.push(section("Кровля", "F147", claddingRows(roofCladding.items)));

  const materialsTotal = sumOrNull(materials.map((s) => s.totalCost));
  const additionalTotal = sumOrNull(additional.map((s) => s.totalCost));
  const recommendedPrice = sumOrNull([materialsTotal, additionalTotal]);
  const packaging = recommendedPrice === null ? null : recommendedPrice * PACKAGING_RATE;

  const fullBill: Bill = {
    materials,
    additional,
    materialsTotal,
    additionalTotal,
    recommendedPrice,
    packaging,
    totalWithPackaging: recommendedPrice === null ? null : recommendedPrice + (packaging ?? 0),
    buildingMass_kg: [...materials, ...additional].reduce((s, x) => s + x.totalMass_kg, 0),
  };

  if (supplyScope !== "frame-roof") return fullBill;

  // Режим поставки «только каркас»: оставляем рамы, кровельные прогоны,
  // связи и крепёж каркаса. ПС 145х1,5 — стеновой прогон и исключается.
  const recalcSection = (source: BillSection, rows: BillRow[]): BillSection => {
    const subtotalCost = rows.some((row) => row.cost === null)
      ? null
      : rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
    const overheadCost = subtotalCost === null ? null : subtotalCost * OVERHEAD_RATE;
    return {
      ...source,
      rows,
      subtotalCost,
      overheadCost,
      totalCost: subtotalCost === null ? null : subtotalCost + (overheadCost ?? 0),
      totalMass_kg: rows.reduce((sum, row) => sum + (row.mass_kg ?? 0), 0),
    };
  };
  const supplyMaterials = fullBill.materials
    .filter((section) => section.title === "Каркас")
    .map((section) => recalcSection(section, section.rows.filter((row) => !row.name.startsWith("ПС 145"))));
  const supplyAdditional = fullBill.additional
    .filter((section) => section.title === "Каркас")
    .map((section) => recalcSection(section, section.rows));
  const supplyMaterialsTotal = sumOrNull(supplyMaterials.map((section) => section.totalCost));
  const supplyAdditionalTotal = sumOrNull(supplyAdditional.map((section) => section.totalCost));
  const supplyRecommendedPrice = sumOrNull([supplyMaterialsTotal, supplyAdditionalTotal]);
  const supplyPackaging = supplyRecommendedPrice === null ? null : supplyRecommendedPrice * PACKAGING_RATE;
  return {
    materials: supplyMaterials,
    additional: supplyAdditional,
    materialsTotal: supplyMaterialsTotal,
    additionalTotal: supplyAdditionalTotal,
    recommendedPrice: supplyRecommendedPrice,
    packaging: supplyPackaging,
    totalWithPackaging: supplyRecommendedPrice === null ? null : supplyRecommendedPrice + (supplyPackaging ?? 0),
    buildingMass_kg: [...supplyMaterials, ...supplyAdditional].reduce((sum, section) => sum + section.totalMass_kg, 0),
  };
}

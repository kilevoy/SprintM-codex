/**
 * Сверка автоподбора стеновой обвязки с расчётами, которые расчётчик
 * реально сохранил по объектам.
 *
 * Каждый случай в scripts/oracle/inputs/wall-envelope-object-runs.json —
 * это копия «Калькулятора ограждайки v1.5», сохранённая при работе над
 * конкретным объектом: в ней и введённые расчётчиком входы `Лист1`, и
 * подобранные книгой профили. Книги открывались только на чтение, SHA-256
 * до и после совпал.
 *
 * Это сильнее синтетических сценариев: здесь нечего реконструировать —
 * входы не восстановлены по ведомости, а взяты из файла расчётчика.
 *
 *   npx vite-node scripts/oracle/compare_wall_envelope_objects.mjs
 */
import { readFileSync } from "node:fs";

const CORPUS = "scripts/oracle/inputs/wall-envelope-object-runs.json";
const TERRAIN = { А: "A", В: "B", С: "C" };
/** Массы зон в книге показаны целыми, поэтому сверяются с округлением. */
const MASS_TOLERANCE = 0.51;

function terrainOf(value) {
  return TERRAIN[value] ?? "B";
}

function thicknessBound(value, fallback) {
  return typeof value === "number" ? value : fallback;
}

export function caseToInput(kase) {
  const i = kase.inputs;
  return {
    crosswindWidth_m: i.buildingLength_m,
    ridgeHeight_m: i.buildingHeight_m,
    wallLength_m: i.wallLength_m,
    wallHeight_m: i.wallHeight_m,
    framePitch_m: i.framePitch_m,
    terrain: terrainOf(i.terrain),
    w0_kPa: i.w0_kPa,
    gammaN: i.gammaN,
    coveringType: i.coveringType,
    deckingMark: i.deckingMark,
    minProfileHeight_mm: i.profileHeight_mm.min,
    maxProfileHeight_mm: i.profileHeight_mm.max,
    minThicknessClass: thicknessBound(i.thicknessClass.min, 0),
    maxThicknessClass: thicknessBound(i.thicknessClass.max, 100),
    minStep_mm: i.minStep_mm,
    maxStepOverride_mm: i.maxStepOverride_mm,
    momentFactorOverride: i.momentFactorOverride,
  };
}

function rowsFor(kase, auto) {
  const rows = [];
  const add = (name, actual, expected, tolerance = 0) => {
    const ok =
      typeof actual === "number" && typeof expected === "number"
        ? Math.abs(actual - expected) <= tolerance
        : actual === expected;
    rows.push({ name, actual, expected, ok });
  };
  const e = kase.excel;

  add("макс. шаг угловой", auto.corner.maxStep_mm, e.maxStep_mm.corner);
  add("макс. шаг рядовой", auto.regular.maxStep_mm, e.maxStep_mm.regular);
  add("протяжённость угловой", Number(auto.corner.zoneLength_m.toFixed(2)), e.zoneLength_m.corner, 0.005);
  add("протяжённость рядовой", Number(auto.regular.zoneLength_m.toFixed(2)), e.zoneLength_m.regular, 0.005);

  for (const [zone, label] of [
    [auto.corner, "угловая"],
    [auto.regular, "рядовая"],
  ]) {
    const expected = label === "угловая" ? e.corner : e.regular;
    add(`${label}: профиль`, zone.profile.profile, expected.profile);
    add(`${label}: кронштейн`, zone.profile.material, expected.bracket);
    add(`${label}: шаг`, zone.step_mm, expected.step_mm);
    add(`${label}: рядов`, zone.rows, expected.rows);
    add(`${label}: масса зоны`, zone.zoneMass_kg, expected.zoneMass_kg, MASS_TOLERANCE);
  }

  add(
    "итого на стену",
    auto.corner.zoneMass_kg + auto.regular.zoneMass_kg,
    kase.excel.totalMass_kg,
    MASS_TOLERANCE * 2,
  );
  return rows;
}

async function main() {
  const { computeWallEnvelopeAuto } = await import("../../src/calc/wallEnvelope/autoWallEnvelope.ts");
  const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));

  let failed = 0;
  let checked = 0;
  for (const kase of corpus.cases) {
    if (!kase.source.hashUnchanged) {
      failed += 1;
      console.log(`✗ ${kase.id}: исходная книга изменилась, результат недействителен`);
      continue;
    }
    const auto = computeWallEnvelopeAuto(caseToInput(kase));
    if (!auto.ok) {
      failed += 1;
      console.log(`✗ ${kase.id}: SprintM не подобрал (${auto.reason})`);
      continue;
    }
    const rows = rowsFor(kase, auto);
    const bad = rows.filter((row) => !row.ok);
    checked += rows.length;
    if (bad.length === 0) {
      console.log(`✓ ${kase.id.padEnd(20)} ${kase.site.padEnd(13)} ${rows.length} величин совпали`);
      continue;
    }
    failed += 1;
    console.log(`✗ ${kase.id}: расхождений ${bad.length} из ${rows.length}`);
    for (const row of bad) {
      console.log(`    ${row.name}: SprintM ${row.actual} ≠ книга ${row.expected}`);
    }
  }

  const objects = [...new Set(corpus.cases.map((c) => c.object))];
  console.log(
    failed === 0
      ? `\nВсе ${corpus.cases.length} расчётов по объектам ${objects.join(", ")} совпали (${checked} величин).`
      : `\nРасчётов с расхождениями: ${failed} из ${corpus.cases.length}.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();

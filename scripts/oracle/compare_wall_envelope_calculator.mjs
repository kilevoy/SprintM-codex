/**
 * Сверка автоподбора стеновой обвязки с «Калькулятором ограждайки».
 *
 * Вход — отчёт run_wall_envelope_calculator.ps1 (живой Excel, пересчёт
 * CalculateFullRebuild на копии книги; оригинал не меняется). Для каждого
 * сценария те же входы Лист1 подаются в computeWallEnvelopeAuto, и все
 * выходные величины сравниваются построчно.
 *
 * Эталон здесь — сами формулы Excel, а не текущий результат SprintM.
 *
 * Запускать через vite-node, потому что расчётный модуль — TypeScript:
 *
 *   npx vite-node scripts/oracle/compare_wall_envelope_calculator.mjs -- <отчёт.json>
 */
import { readFileSync } from "node:fs";

const TERRAIN = { "А": "A", "В": "B", "С": "C" };
const TOLERANCE = 1e-9;

/** Отчёт PowerShell пишет в UTF-8 с BOM, а JSON.parse на нём спотыкается. */
function loadReport(path) {
  const text = readFileSync(path, "utf-8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function cell(sheet, address) {
  const entry = sheet[address];
  return entry === undefined ? null : entry.value;
}

function thicknessBound(value, fallback) {
  return typeof value === "number" ? value : fallback;
}

export function scenarioToInput(sheet1) {
  return {
    crosswindWidth_m: cell(sheet1, "B7"),
    ridgeHeight_m: cell(sheet1, "B8"),
    wallLength_m: cell(sheet1, "B11"),
    wallHeight_m: cell(sheet1, "B12"),
    framePitch_m: cell(sheet1, "B13"),
    terrain: TERRAIN[cell(sheet1, "B16")] ?? "B",
    w0_kPa: cell(sheet1, "B17"),
    gammaN: cell(sheet1, "B3"),
    coveringType: cell(sheet1, "B18"),
    deckingMark: cell(sheet1, "B19"),
    minProfileHeight_mm: cell(sheet1, "B34"),
    maxProfileHeight_mm: cell(sheet1, "B33"),
    minThicknessClass: thicknessBound(cell(sheet1, "B36"), 0),
    maxThicknessClass: thicknessBound(cell(sheet1, "B35"), 100),
    minStep_mm: { corner: cell(sheet1, "B23") ?? 0, regular: cell(sheet1, "B28") ?? 0 },
    maxStepOverride_mm: { corner: cell(sheet1, "B22") ?? 0, regular: cell(sheet1, "B27") ?? 0 },
    momentFactorOverride: cell(sheet1, "B32") ?? 0,
  };
}

function near(actual, expected) {
  if (typeof actual !== "number" || typeof expected !== "number") return actual === expected;
  if (actual === expected) return true;
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) <= TOLERANCE * scale;
}

export function compareCase(kase, auto) {
  const sheet1 = kase.sheet1;
  const rows = [];
  const add = (name, actual, expected) => rows.push({ name, actual, expected, ok: near(actual, expected) });

  if (!auto.ok) {
    return { id: kase.id, fatal: `SprintM не подобрал: ${auto.reason}`, rows };
  }

  add("макс. шаг угловой (B24)", auto.corner.maxStep_mm, cell(sheet1, "B24"));
  add("макс. шаг рядовой (B29)", auto.regular.maxStep_mm, cell(sheet1, "B29"));
  add("длина угловой зоны (E24)", auto.corner.zoneLength_m, cell(sheet1, "E24"));
  add("длина рядовой зоны (E29)", auto.regular.zoneLength_m, cell(sheet1, "E29"));

  add("профиль угловой (B49)", auto.corner.profile.profile, cell(sheet1, "B49"));
  add("кронштейн угловой (C49)", auto.corner.profile.material, cell(sheet1, "C49"));
  add("шаг угловой (D49)", auto.corner.step_mm, cell(sheet1, "D49"));
  add("рядов угловой (F49)", auto.corner.rows, cell(sheet1, "F49"));
  add("кронштейнов угловой (G49)", auto.corner.bracketCount, cell(sheet1, "G49"));
  add("масса сборок угловой (H49)", auto.corner.bracketMass_kg, cell(sheet1, "H49"));
  add("масса профиля угловой (I49)", auto.corner.profileMass_kg, cell(sheet1, "I49"));

  add("профиль рядовой (B50)", auto.regular.profile.profile, cell(sheet1, "B50"));
  add("кронштейн рядовой (C50)", auto.regular.profile.material, cell(sheet1, "C50"));
  add("шаг рядовой (D50)", auto.regular.step_mm, cell(sheet1, "D50"));
  add("рядов рядовой (F50)", auto.regular.rows, cell(sheet1, "F50"));
  add("кронштейнов рядовой (G50)", auto.regular.bracketCount, cell(sheet1, "G50"));
  add("масса сборок рядовой (H50)", auto.regular.bracketMass_kg, cell(sheet1, "H50"));
  add("масса профиля рядовой (I50)", auto.regular.profileMass_kg, cell(sheet1, "I50"));

  const zones = kase.zones;
  add("C3 угловой", auto.corner.windPressureFactor, zones["Расчет Угловая"].C3.value);
  add("C3 рядовой", auto.regular.windPressureFactor, zones["Расчет Рядовая"].C3.value);
  add("D5 угловой", auto.corner.deckingDesignLoad_kPa, zones["Расчет Угловая"].D5.value);
  add("D5 рядовой", auto.regular.deckingDesignLoad_kPa, zones["Расчет Рядовая"].D5.value);

  return { id: kase.id, fatal: null, rows };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("укажите путь к отчёту run_wall_envelope_calculator.ps1");
    process.exit(2);
  }
  const { computeWallEnvelopeAuto } = await import("../../src/calc/wallEnvelope/autoWallEnvelope.ts");
  const report = loadReport(reportPath);

  let failed = 0;
  for (const kase of report.cases) {
    const input = scenarioToInput(kase.sheet1);
    const result = compareCase(kase, computeWallEnvelopeAuto(input));
    const bad = result.rows.filter((row) => !row.ok);
    if (result.fatal) {
      failed += 1;
      console.log(`✗ ${result.id}: ${result.fatal}`);
      continue;
    }
    if (bad.length === 0) {
      console.log(`✓ ${result.id}: ${result.rows.length} величин совпали`);
      continue;
    }
    failed += 1;
    console.log(`✗ ${result.id}: расхождений ${bad.length} из ${result.rows.length}`);
    for (const row of bad) {
      console.log(`    ${row.name}: SprintM ${row.actual} ≠ Excel ${row.expected}`);
    }
  }

  console.log(
    failed === 0
      ? `\nВсе ${report.cases.length} сценариев совпали с Excel.`
      : `\nСценариев с расхождениями: ${failed} из ${report.cases.length}.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();

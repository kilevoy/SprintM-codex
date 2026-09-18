import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const scenario = JSON.parse(readFileSync(resolve(root, "scripts/oracle/inputs/21604-wall-purlins.json"), "utf8"));
const corpus = JSON.parse(readFileSync(resolve(root, "scripts/oracle/inputs/wall-purlin-candidates.json"), "utf8"));
const profnastil = JSON.parse(readFileSync(resolve(root, "scripts/oracle/inputs/profnastil-candidates.json"), "utf8"));
const mixedCorpus = JSON.parse(readFileSync(resolve(root, "scripts/oracle/inputs/ten-object-parity.json"), "utf8"));
const mixedCorpusRound2 = JSON.parse(readFileSync(resolve(root, "scripts/oracle/inputs/ten-object-parity-round2.json"), "utf8"));
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const isSha256 = (value) => typeof value === "string" && /^[0-9A-F]{64}$/i.test(value);
const provenance = new Set(["direct", "reconstructed", "author-restored", "manual"]);
const confidence = new Set(["high", "medium", "low", "blocked"]);

check(scenario.schemaVersion === 1, "21604: unsupported schemaVersion");
check(/^provisional-/.test(scenario.status), "21604: reconstructed data must remain provisional");
check(scenario.scope === "engineering-quantities-and-masses-only", "21604: wrong scope");
check(isSha256(scenario.source?.sha256), "21604: invalid source SHA-256");
check(isSha256(scenario.calculator?.sha256), "21604: invalid calculator SHA-256");
check(scenario.restoredSources?.length === 2, "21604: two author-restored sources are required");
for (const source of scenario.restoredSources ?? []) {
  check(isSha256(source.sha256), `21604 ${source.role}: invalid restored-source SHA-256`);
  check(source.openedReadOnly === true, `21604 ${source.role}: read-only evidence is required`);
  check(source.hashUnchanged === true, `21604 ${source.role}: source hash changed`);
}
check(scenario.excluded?.openingCosts === true, "21604: opening costs must be excluded");
check(scenario.excluded?.pricesFromEngineeringBaseline === true, "21604: prices must be excluded");
check(scenario.excluded?.snowPocket?.status === "blocked-broken-source-formulas", "21604: snow pocket must remain blocked");

for (const [name, input] of Object.entries(scenario.buildingInputs ?? {})) {
  check(provenance.has(input.provenance), `21604 buildingInputs.${name}: invalid provenance`);
  check(confidence.has(input.confidence), `21604 buildingInputs.${name}: invalid confidence`);
}
const runIds = new Set();
for (const run of scenario.calculatorRuns ?? []) {
  check(!runIds.has(run.id), `21604: duplicate run ${run.id}`);
  runIds.add(run.id);
  check(run.wallCount === 2, `21604 ${run.id}: wallCount must be 2`);
  for (const [name, input] of Object.entries(run.inputs ?? {})) {
    check(typeof input.cell === "string", `21604 ${run.id}.${name}: missing cell`);
    check(provenance.has(input.provenance), `21604 ${run.id}.${name}: invalid provenance`);
    check(confidence.has(input.confidence), `21604 ${run.id}.${name}: invalid confidence`);
  }
  for (const zoneName of ["corner", "regular"]) {
    const zone = run.zones?.[zoneName];
    check(zone, `21604 ${run.id}: missing ${zoneName}`);
    for (const [field, evidence] of Object.entries(zone ?? {})) {
      check(typeof evidence.cell === "string", `21604 ${run.id}.${zoneName}.${field}: missing cell`);
      check(evidence.value !== undefined, `21604 ${run.id}.${zoneName}.${field}: missing value`);
    }
  }
}
check(runIds.has("end-walls") && runIds.has("longitudinal-walls"), "21604: both orientations required");

check(corpus.schemaVersion === 1, "candidate corpus: unsupported schemaVersion");
check(corpus.candidates?.length >= 3, "candidate corpus: at least 3 cases required");
const independent = corpus.candidates?.filter((item) => item.evidenceClass === "independent-saved-workbook") ?? [];
check(independent.length >= 2, "candidate corpus: at least 2 independent workbooks required");
const hashes = new Set();
for (const item of corpus.candidates ?? []) {
  check(isSha256(item.sha256), `${item.id}: invalid SHA-256`);
  check(!hashes.has(item.sha256), `${item.id}: duplicate SHA-256`);
  hashes.add(item.sha256);
  check(item.path && item.inputs && item.outputs, `${item.id}: source, inputs and outputs required`);
  check(item.coverage?.length, `${item.id}: coverage required`);
}

check(profnastil.schemaVersion === 1, "profnastil corpus: unsupported schemaVersion");
check(/^provisional-/.test(profnastil.status), "profnastil corpus must remain provisional");
check(profnastil.cases?.length >= 3, "profnastil corpus: at least 3 cases required");
for (const item of profnastil.cases ?? []) {
  check(isSha256(item.source?.sha256), `${item.id}: invalid profnastil source SHA-256`);
  check(item.source?.openedReadOnly === true, `${item.id}: read-only evidence is required`);
  check(item.source?.hashUnchanged === true, `${item.id}: source hash changed`);
  check(item.excel?.grossWallSheetArea_m2 > 0, `${item.id}: Excel wall area is required`);
  check(item.excel?.roofSheetArea_m2 > 0, `${item.id}: Excel roof area is required`);
  check(item.app?.requiresCheck === true, `${item.id}: unverified profnastil case must require check`);
}

check(mixedCorpus.schemaVersion === 1, "mixed corpus: unsupported schemaVersion");
check(/^provisional-/.test(mixedCorpus.status), "mixed corpus must remain provisional");
check(mixedCorpus.cases?.length === 10, "mixed corpus: exactly 10 object workbooks required");
const mixedIds = new Set();
const mixedHashes = new Set();
for (const item of mixedCorpus.cases ?? []) {
  check(!mixedIds.has(item.id), `${item.id}: duplicate mixed-corpus id`);
  mixedIds.add(item.id);
  check(isSha256(item.source?.sha256), `${item.id}: invalid mixed-corpus SHA-256`);
  check(!mixedHashes.has(item.source?.sha256), `${item.id}: duplicate mixed-corpus SHA-256`);
  mixedHashes.add(item.source?.sha256);
  check(item.source?.openedReadOnly === true, `${item.id}: mixed source must be read-only`);
  check(item.source?.hashUnchanged === true, `${item.id}: mixed source hash changed`);
  check(item.source?.sheet === "12м", `${item.id}: unexpected comparison sheet`);
  check(item.inputs?.span_m > 0 && item.inputs?.length_m > 0 && item.inputs?.height_m > 0, `${item.id}: geometry is required`);
  check(/^provisional-|^verified-/.test(item.comparison?.status ?? ""), `${item.id}: comparison status is required`);
  for (const bucket of ["matched", "numericMismatch", "missingInApp", "missingInExcel", "unmapped"]) {
    check(Array.isArray(item.comparison?.[bucket]), `${item.id}: ${bucket} classification is required`);
  }
}
check(new Set((mixedCorpus.cases ?? []).map((item) => item.cladding.startsWith("sandwich") ? "sandwich" : "profnastil")).size === 2, "mixed corpus: both cladding families are required");

check(mixedCorpusRound2.schemaVersion === 1, "mixed corpus round2: unsupported schemaVersion");
check(/^provisional-/.test(mixedCorpusRound2.status), "mixed corpus round2 must remain provisional");
check(mixedCorpusRound2.cases?.length === 10, "mixed corpus round2: exactly 10 object workbooks required");
const round2Ids = new Set();
const round2Hashes = new Set();
for (const item of mixedCorpusRound2.cases ?? []) {
  check(!round2Ids.has(item.id), `${item.id}: duplicate round2 id`);
  round2Ids.add(item.id);
  check(isSha256(item.source?.sha256), `${item.id}: invalid round2 SHA-256`);
  check(!round2Hashes.has(item.source?.sha256), `${item.id}: duplicate round2 SHA-256`);
  round2Hashes.add(item.source?.sha256);
  check(item.source?.openedReadOnly === true && item.source?.hashUnchanged === true, `${item.id}: round2 read-only evidence is required`);
  for (const bucket of ["matched", "numericMismatch", "missingInApp", "missingInExcel", "unmapped"]) {
    check(Array.isArray(item.classification?.[bucket]), `${item.id}: round2 ${bucket} classification is required`);
  }
}
check(new Set((mixedCorpusRound2.cases ?? []).map((item) => item.cladding.startsWith("sandwich") ? "sandwich" : "profnastil")).size === 2, "mixed corpus round2: both cladding families are required");

const serialized = JSON.stringify({ scenario, corpus, profnastil, mixedCorpus, mixedCorpusRound2 });
check(!/"(?:customer|phone|email|contact|personName)"\s*:/i.test(serialized), "PII-like fields are forbidden");

if (errors.length) {
  console.error(`Wall-envelope scenario validation failed: ${errors.length} error(s).`);
  errors.forEach((error) => console.error(`  ${error}`));
  process.exit(1);
}
console.log(`Wall-purlin scenarios valid: 1 provisional scenario, ${corpus.candidates.length} calculator candidates, ${profnastil.cases.length} profnastil objects, ${mixedCorpus.cases.length} first-round objects, ${mixedCorpusRound2.cases.length} second-round objects, ${independent.length} independent calculator workbooks.`);

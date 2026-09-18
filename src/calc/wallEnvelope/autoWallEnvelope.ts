import deckingRaw from "../../data/wallDeckingSpans.generated.json";
import { excelCeiling, excelRound } from "./excelNumerics";
import {
  requiredInsulationForCovering_mm,
  selectWallEnvelopeProfile,
} from "./selectWallEnvelopeProfile";
import type { WallEnvelopeProfile } from "./types";
import { zoneWindPressureFactor, type TerrainType, type WallZone } from "./zoneWindPressure";

interface DeckingSpanTable {
  sourceSha256: string;
  marks: string[];
  spans: { span_mm: number; allowableLoad_kPa: Record<string, number> }[];
}

const deckingTable = deckingRaw as DeckingSpanTable;

/**
 * Аэродинамический коэффициент для проверки самого листа обшивки —
 * 'Ветер по СП'!AB6, то есть значение таблицы на грузовой площади 10 м².
 * В формуле D5 расчётного листа он зафиксирован именно этой ячейкой.
 */
const DECKING_CHECK_COEFFICIENT = 0.75;

/** Типы сечения, которым крайний ряд не добавляется (Лист1!F49/F50). */
const SECTIONS_WITHOUT_EDGE_ROW = new Set(["[]", "][", "[-]"]);

export const wallDeckingMarks: readonly string[] = deckingTable.marks;

/**
 * Расчётная нагрузка на обшивку для выбора допустимого пролёта
 * ('Расчет Угловая'!D5 / 'Расчет Рядовая'!D5):
 *
 *   D5 = C3 * 'Ветер по СП'!AB6 * Лист1!B3
 *
 * Обратите внимание: γn входит сюда ВТОРОЙ раз — он уже сидит в C3.
 * Это воспроизводится как есть: формула книги является эталоном, и
 * «исправление» её здесь сломало бы паритет.
 */
export function deckingDesignLoad_kPa(zoneWindFactor: number, gammaN: number): number {
  return zoneWindFactor * DECKING_CHECK_COEFFICIENT * gammaN;
}

/**
 * Максимальный шаг прогонов по несущей способности обшивки
 * (Лист1!B24/B29 = INDEX(B109:B158, MATCH(нагрузка, N109:N158, -1))).
 *
 * Таблица допустимых нагрузок невозрастающая по пролёту, поэтому
 * приближённый поиск по убыванию — это последний пролёт, который ещё
 * держит расчётную нагрузку. Если её не держит даже минимальный пролёт,
 * в книге получается #Н/Д; здесь возвращается null.
 */
export function maxDeckingSpan_mm(mark: string, designLoad_kPa: number): number | null {
  let last: number | null = null;
  for (const row of deckingTable.spans) {
    const allowable = row.allowableLoad_kPa[mark];
    if (allowable === undefined) return null;
    if (allowable >= designLoad_kPa) last = row.span_mm;
  }
  return last;
}

/**
 * Длина угловой зоны стены ('Расчет Угловая'!C8), м:
 *   e = MIN(b, 2h)                    -- 'Ветер по СП'!J30
 *   ширина зоны = e/5                 -- 'Ветер по СП'!J31
 *   C8 = 2 * ЕСЛИ(ширина/шаг < 0,5; 0; ОКРВВЕРХ(ширина/шаг;1)*шаг)
 * то есть ширина зоны округляется вверх до целого числа шагов рам и
 * берётся с двух сторон стены; зона короче половины шага не считается.
 *
 * Высота здесь — уже ограниченная снизу пятью метрами ('Ветер по СП'!C8 =
 * MAX(5; Лист1!B8)), потому что J30 ссылается именно на C8, а не на Лист1!B8.
 */
export function cornerZoneLength_m(
  crosswindWidth_m: number,
  ridgeHeight_m: number,
  framePitch_m: number,
): number {
  const e = Math.min(crosswindWidth_m, 2 * Math.max(5, ridgeHeight_m));
  const zoneWidth = e / 5;
  const bays = zoneWidth / framePitch_m;
  return 2 * (bays < 0.5 ? 0 : excelCeiling(bays) * framePitch_m);
}

export interface WallEnvelopeAutoInput {
  /** Лист1!B7 (b) — размер здания поперёк ветра, участвует только в e = MIN(b; 2h). */
  crosswindWidth_m: number;
  /** Лист1!B8 (h) — высота по коньку. */
  ridgeHeight_m: number;
  /** Лист1!B11 — длина рассчитываемой стены. */
  wallLength_m: number;
  /** Лист1!B12 — высота стены: карниз для продольной, конёк для торцевой. */
  wallHeight_m: number;
  /** Лист1!B13 — шаг рам. */
  framePitch_m: number;
  /** Лист1!B16 — тип местности. */
  terrain: TerrainType;
  /** Лист1!B17 — w0 ветрового района, кПа. */
  w0_kPa: number;
  /** Лист1!B3 — γn. */
  gammaN: number;
  /** Лист1!B18 — тип покрытия стены. */
  coveringType: string;
  /** Лист1!B19 — марка профлиста/панели. */
  deckingMark: string;
  /** Лист1!B34 и B33 — границы высоты профиля, мм. */
  minProfileHeight_mm: number;
  maxProfileHeight_mm: number;
  /** Лист1!B36 и B35 — границы класса толщины («любая» → 0 и 100). */
  minThicknessClass?: number;
  maxThicknessClass?: number;
  /** Минимальный шаг зоны: Лист1!B23 (угловая) и B28 (рядовая); 0 — не задан. */
  minStep_mm?: Partial<Record<WallZone, number>>;
  /**
   * Принудительный максимальный шаг зоны: Лист1!B22 (угловая) и B27
   * (рядовая); 0 — считать по несущей способности обшивки.
   */
  maxStepOverride_mm?: Partial<Record<WallZone, number>>;
  /** Лист1!B32 — принудительный коэффициент использования сечения, 0 = из каталога. */
  momentFactorOverride?: number;
}

export interface WallEnvelopeZoneResult {
  zone: WallZone;
  /** Длина зоны на этой стене, м (Лист1!E24 для угловой, E29 для рядовой). */
  zoneLength_m: number;
  windPressureFactor: number;
  deckingDesignLoad_kPa: number;
  maxStep_mm: number;
  step_mm: number;
  profile: WallEnvelopeProfile;
  /** Лист1!F49/F50 — число рядов прогонов по высоте стены. */
  rows: number;
  /** Лист1!G49/G50 — число кронштейнов. */
  bracketCount: number;
  /** Лист1!H49/H50 — масса узловых сборок, кг. */
  bracketMass_kg: number;
  /** Лист1!I49/I50 — масса профиля, кг. */
  profileMass_kg: number;
  /**
   * Лист1!E49/E50 «Масса на зону, кг» — то, что подборщик показывает
   * расчётчику: ранг TQ, умноженный на число шагов рам в зоне
   * (BGR7 = BGQ7 * ADI1). Это НЕ то же, что `profileMass_kg`: сюда входят
   * и узловые сборки, и удвоенный погонный член формулы ранга.
   */
  zoneMass_kg: number;
  utilization: number;
}

export type WallEnvelopeAutoFailure =
  | { ok: false; zone: WallZone; reason: "decking-span"; designLoad_kPa: number }
  | { ok: false; zone: WallZone; reason: "no-profile"; maxStep_mm: number }
  | { ok: false; reason: "unsupported-covering"; coveringType: string };

export type WallEnvelopeAutoResult =
  | { ok: true; corner: WallEnvelopeZoneResult; regular: WallEnvelopeZoneResult }
  | WallEnvelopeAutoFailure;

/** Одинаковых стен на здании (продольных — две, торцевых — две). */
export interface WallEnvelopeWallTakeoff {
  wallCount: number;
  corner: WallEnvelopeZoneResult;
  regular: WallEnvelopeZoneResult;
}

export interface WallEnvelopeProfileLine {
  profile: WallEnvelopeProfile;
  /** Длина ЛИНИЙ обвязки, м. */
  lineLength_m: number;
  /** Длина ПРОФИЛЯ, м: парное сечение идёт в ведомость в два раза длиннее. */
  profileLength_m: number;
  mass_kg: number;
}

export interface WallEnvelopeBuildingTakeoff {
  /** Строки ведомости, сгруппированные по профилю. */
  lines: WallEnvelopeProfileLine[];
  brackets: { count: number; mass_kg: number };
  profileLength_m: number;
  profileMass_kg: number;
}

/**
 * Сколько профилей в одном сечении: у «[]», «][» и «[-]» их два, у «]» —
 * один. Берётся из самого каталога отношением массы сечения к массе
 * профиля, а не по списку обозначений.
 */
export function profilesPerLine(profile: WallEnvelopeProfile): number {
  return Math.round(profile.massSection_kg_m / profile.massProfile_kg_m);
}

/**
 * Свод по зданию: ведомость считает ПОГОННЫЕ МЕТРЫ ПРОФИЛЯ, поэтому
 * парное сечение идёт в неё удвоенной длиной. Проверено на объектных
 * ведомостях: 21876 — 720 п.м. = (4×30 + 5×12) × 2 стены × 2 профиля.
 */
export function wallEnvelopeBuildingTakeoff(
  walls: readonly WallEnvelopeWallTakeoff[],
): WallEnvelopeBuildingTakeoff {
  const byProfile = new Map<string, WallEnvelopeProfileLine>();
  let bracketCount = 0;
  let bracketMass_kg = 0;

  for (const wall of walls) {
    for (const zone of [wall.corner, wall.regular]) {
      if (zone.zoneLength_m <= 0) continue;
      bracketCount += zone.bracketCount * wall.wallCount;
      bracketMass_kg += zone.bracketMass_kg * wall.wallCount;

      const lineLength_m = zone.rows * zone.zoneLength_m * wall.wallCount;
      const line = byProfile.get(zone.profile.profile) ?? {
        profile: zone.profile,
        lineLength_m: 0,
        profileLength_m: 0,
        mass_kg: 0,
      };
      line.lineLength_m += lineLength_m;
      line.profileLength_m += lineLength_m * profilesPerLine(zone.profile);
      line.mass_kg += lineLength_m * zone.profile.massSection_kg_m;
      byProfile.set(zone.profile.profile, line);
    }
  }

  const lines = [...byProfile.values()].sort((a, b) => b.mass_kg - a.mass_kg);
  return {
    lines,
    brackets: { count: bracketCount, mass_kg: bracketMass_kg },
    profileLength_m: lines.reduce((sum, line) => sum + line.profileLength_m, 0),
    profileMass_kg: lines.reduce((sum, line) => sum + line.mass_kg, 0),
  };
}

function computeZone(
  input: WallEnvelopeAutoInput,
  zone: WallZone,
  zoneLength_m: number,
): WallEnvelopeZoneResult | WallEnvelopeAutoFailure {
  const windPressureFactor = zoneWindPressureFactor({
    w0_kPa: input.w0_kPa,
    ridgeHeight_m: input.ridgeHeight_m,
    terrain: input.terrain,
    gammaN: input.gammaN,
    zone,
  });
  const designLoad_kPa = deckingDesignLoad_kPa(windPressureFactor, input.gammaN);

  const override = input.maxStepOverride_mm?.[zone] ?? 0;
  const fromDecking = override > 0 ? override : maxDeckingSpan_mm(input.deckingMark, designLoad_kPa);
  if (fromDecking === null) {
    return { ok: false, zone, reason: "decking-span", designLoad_kPa };
  }

  const selection = selectWallEnvelopeProfile({
    minStep_mm: input.minStep_mm?.[zone] ?? 0,
    maxStep_mm: fromDecking,
    coveringType: input.coveringType,
    zoneHeight_m: input.wallHeight_m,
    framePitch_m: input.framePitch_m,
    minHeight_mm: input.minProfileHeight_mm,
    maxHeight_mm: input.maxProfileHeight_mm,
    minThicknessClass: input.minThicknessClass ?? 0,
    maxThicknessClass: input.maxThicknessClass ?? 100,
    windPressureFactor,
    momentFactorOverride: input.momentFactorOverride,
  });
  if (!selection) {
    return { ok: false, zone, reason: "no-profile", maxStep_mm: fromDecking };
  }

  const edgeRow = SECTIONS_WITHOUT_EDGE_ROW.has(selection.profile.sectionType) ? 0 : 1;
  const rows = excelCeiling((input.wallHeight_m * 1000) / selection.step_mm) + edgeRow;

  // Кронштейны: угловая зона считается без округления (Лист1!G49), рядовая —
  // с округлением вверх от шага, округлённого до одного знака (G50).
  const bracketCount =
    zone === "corner"
      ? (rows * zoneLength_m) / input.framePitch_m
      : excelCeiling(rows * excelRound(zoneLength_m / input.framePitch_m, 1));

  // ADI1 исходника: угловая зона делит длину без округления, рядовая —
  // с округлением до одного знака.
  const bays =
    zone === "corner"
      ? zoneLength_m / input.framePitch_m
      : excelRound(zoneLength_m / input.framePitch_m, 1);

  return {
    zone,
    zoneLength_m,
    windPressureFactor,
    deckingDesignLoad_kPa: designLoad_kPa,
    maxStep_mm: fromDecking,
    step_mm: selection.step_mm,
    profile: selection.profile,
    rows,
    bracketCount,
    bracketMass_kg: selection.profile.jointMass_kg * bracketCount,
    profileMass_kg: rows * zoneLength_m * selection.profile.massSection_kg_m,
    zoneMass_kg: selection.score * bays,
    utilization: selection.utilization,
  };
}

/**
 * Автоподбор стеновой обвязки одной стены: угловая и рядовая зоны целиком,
 * как это делает «Калькулятор ограждайки v1.5.xlsx» для заданных Лист1-входов.
 *
 * Высоту стены задаёт вызывающая сторона: для торцевой стены — по коньку,
 * для продольной — по карнизу (в книге это тот же Лист1!B12).
 */
export function computeWallEnvelopeAuto(input: WallEnvelopeAutoInput): WallEnvelopeAutoResult {
  if (requiredInsulationForCovering_mm(input.coveringType) !== 0) {
    // Утеплённые варианты («наша послойка») ни на одном расчёте не
    // проверялись: там включается ограничение шага по Лист1!D10:F10,
    // которого нет в профлистовой ветке. Поэтому — явный отказ.
    return { ok: false, reason: "unsupported-covering", coveringType: input.coveringType };
  }

  const cornerLength = cornerZoneLength_m(
    input.crosswindWidth_m,
    input.ridgeHeight_m,
    input.framePitch_m,
  );
  const regularLength = input.wallLength_m - cornerLength;

  const corner = computeZone(input, "corner", cornerLength);
  if ("ok" in corner) return corner;
  const regular = computeZone(input, "regular", regularLength);
  if ("ok" in regular) return regular;

  return { ok: true, corner, regular };
}

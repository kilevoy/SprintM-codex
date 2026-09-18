import { Fragment, useMemo, useState } from "react";
import { findSettlement, getAllSettlementNames, getSupportedSvCodes } from "./calc/climate/svCode";
import { getSandwichPanelThicknesses } from "./calc/cladding/sandwichPanel";
import { getProfnastilThicknesses } from "./calc/cladding/profnastil";
import type { StrutTube } from "./calc/frame/bracing";
import { heightLimitsForSpan } from "./calc/frame/sectionBank";
import { getKnownPgsProfiles } from "./calc/profiles/pgsPriceCatalog";
import { WIND_DISTRICTS, windPressureForDistrict_kPa } from "./calc/climate/manualClimate";
import { fileNameFor, parseSavedProject, serializeProject } from "./calc/project/saveLoad";
import { parseTz } from "./calc/tz/parseTz";
import { tzToInputs } from "./calc/tz/tzToInputs";
import { readPdfText } from "./calc/tz/readPdfText";
import { DEFAULT_OPENINGS, type OpeningGroup, type OpeningsInput } from "./calc/geometry/openings";
import { buildBill } from "./calc/bill/buildBill";
import { computeProject, type ProjectInputs } from "./calc/project/computeProject";
import { DECKING_MARKS, DEFAULT_DECKING_MARK } from "./calc/purlin/deckingSpan";
import roofingTypesRaw from "./data/roofingSelfWeight.json";
import { SPANS, type ResponsibilityLevel, type Span } from "./types/common";

// Одноимённые города (два Берёзовских, два Гурьевска и т.п.) приходят
// уже в уточнённой форме "Город, Регион", поэтому список уникален и
// позволяет выбрать нужный осознанно.
const settlementNames = getAllSettlementNames();

/** Состав поставки — см. ProjectInputs.supplyScope. */
type SupplyScope = NonNullable<ProjectInputs["supplyScope"]>;

const roofingTypes = roofingTypesRaw as { type: string; selfWeight_kg_m2: number }[];

/**
 * Типы покрытия «наше N мм» (послойная сборка — ГВЛ + утеплитель + Изоспан,
 * без сэндвич-панели) — решение по объёму: этот релиз их не считает (см.
 * артефакт вопросов расчётчику). В расчёте (roofingSelfWeight.json) они
 * остаются — вдруг понадобятся, — но в выпадающем списке не нужны.
 */
const roofingTypesForUi = roofingTypes.filter((r) => !r.type.startsWith("наше "));

/** «С-П 150» → 150. Не «С-П» (профлист, малоуклонная) — нет толщины панели. */
function sandwichPanelThicknessOf(roofingType: string): number | null {
  const m = /^С-П (\d+)$/.exec(roofingType);
  return m ? Number(m[1]) : null;
}

/**
 * Один селектор «Покрытие кровли» — вместо общей строки «профлист»
 * (10,5 кг/м² по нагрузкам, из таблицы «снегветер» — гейдж не важен, это
 * категория) показываем две конкретные толщины С-44. Сама нагрузка не
 * зависит от толщины листа, поэтому обе ведут к одному roofingType —
 * "профлист", просто с разной толщиной для цены/массы обшивки.
 */
function roofOptions(
  types: { type: string; selfWeight_kg_m2: number }[],
  profnastilThicknesses: readonly number[],
): { value: string; label: string }[] {
  return types.flatMap((r) =>
    r.type === "профлист"
      ? profnastilThicknesses.map((t) => ({
          value: `профлист:${t}`,
          label: `профнастил С-44, ${t} мм`,
        }))
      : [{ value: r.type, label: `${r.type} (${r.selfWeight_kg_m2} кг/м²)` }],
  );
}

/** Значение селектора «Покрытие стен» — сэндвич-панель или профнастил, одним полем. */
function wallOptions(
  spThicknesses: readonly number[],
  profnastilThicknesses: readonly number[],
): { value: string; label: string }[] {
  return [
    ...spThicknesses.map((t) => ({ value: `sp:${t}`, label: `С-П ${t}` })),
    ...profnastilThicknesses.map((t) => ({
      value: `профнастил:${t}`,
      label: `профнастил С-18, ${t} мм`,
    })),
  ];
}

/** Коды «с/в», для которых в банке сечений ИНСИ есть просчитанные строки. */
const SV_CODES = getSupportedSvCodes();

/** Профили ПГС, для которых в прайсе есть и масса, и цена — список для ручного переопределения. */
const KNOWN_PGS_PROFILES = getKnownPgsProfiles();

/**
 * Наименьшая высота, которую вообще пускаем в поле. Банк снизу не
 * ограничен — всё, что ниже первой корзины, считается по ней, — но
 * ангар ниже трёх метров смысла не имеет.
 */
const MIN_HEIGHT_M = 3;

/** 6 → «6», 6.2 → «6,2»: в поле высоты дробная часть бывает, а нули не нужны. */
const fmt = (v: number) => String(v).replace(".", ",");

/**
 * Один тип проёма (ворота/двери/окна) — список размеров вместо одного
 * поля. Расчётчик подтвердила (вопрос 02): «когда размеров больше, чем
 * слотов, я вручную добавляю слот» — здесь то же самое, кнопкой.
 */
function OpeningGroupsEditor({
  label,
  groups,
  defaultGroup,
  onChange,
  showWallSide = false,
}: {
  label: string;
  groups: OpeningGroup[];
  defaultGroup: OpeningGroup;
  onChange: (next: OpeningGroup[]) => void;
  /** Только для ворот — раздвижка рамы актуальна лишь для них. */
  showWallSide?: boolean;
}) {
  const update = (index: number, patch: Partial<OpeningGroup>) =>
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  const remove = (index: number) => onChange(groups.filter((_, i) => i !== index));
  const add = () => onChange([...groups, { ...defaultGroup }]);

  return (
    <div className="opening-type">
      <div className="opening-type-head">
        <span>{label}</span>
        <button type="button" className="linklike" onClick={add}>
          + добавить размер
        </button>
      </div>
      {groups.length === 0 && <p className="hint">Нет ни одного проёма этого типа.</p>}
      {groups.map((g, i) => (
        <div className="inline-fields opening-row" key={i}>
          <input
            type="number"
            min="0"
            aria-label="количество"
            value={g.count}
            onChange={(e) => update(i, { count: Number(e.target.value) })}
          />
          <input
            type="number"
            min="0"
            step="0.1"
            aria-label="ширина, м"
            value={g.width_m}
            onChange={(e) => update(i, { width_m: Number(e.target.value) })}
          />
          <input
            type="number"
            min="0"
            step="0.1"
            aria-label="высота, м"
            value={g.height_m}
            onChange={(e) => update(i, { height_m: Number(e.target.value) })}
          />
          {showWallSide && (
            <select
              aria-label="стена"
              value={g.onLongWall ? "long" : "gable"}
              onChange={(e) => update(i, { onLongWall: e.target.value === "long" })}
            >
              <option value="gable">торец</option>
              <option value="long">длинная сторона</option>
            </select>
          )}
          {label === "Окна" && (
            <label className="opening-scheme">
              тип окна
              <select
                aria-label="тип окна"
                value={g.windowType ?? 1}
                onChange={(e) => update(i, { windowType: Number(e.target.value) as OpeningGroup["windowType"] })}
              >
                {[1, 2, 3, 4, 5].map((type) => <option key={type} value={type}>тип {type}</option>)}
              </select>
            </label>
          )}
          <button
            type="button"
            className="opening-remove"
            onClick={() => remove(i)}
            aria-label={`убрать размер ${label.toLowerCase()}`}
            title="Убрать этот размер"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [city, setCity] = useState("Челябинск");
  const [supplyScope, setSupplyScope] = useState<SupplyScope>("full");
  // Тип местности по СП — вход будущего подбора оконных ригелей.
  const [terrainType, setTerrainType] = useState<"A" | "B" | "C">("B");
  // Ручной ввод нагрузок — для площадок, которых нет в справочнике.
  const [manualMode, setManualMode] = useState(false);
  const [manualSnow, setManualSnow] = useState(1.5);
  const [manualWind, setManualWind] = useState("II");
  const [span, setSpan] = useState<Span>(18);
  const [length, setLength] = useState(30);
  const [height, setHeight] = useState(5);
  const [responsibility, setResponsibility] = useState<ResponsibilityLevel>(1.0);
  const [roofingType, setRoofingType] = useState(
    roofingTypes.find((r) => r.type === "С-П 150")!.type,
  );
  const [deckingMark, setDeckingMark] = useState(DEFAULT_DECKING_MARK);
  // 0 — считать максимальный шаг по несущей способности настила (вывод!D24 пусто).
  const [maxStepOverrideMm, setMaxStepOverrideMm] = useState(0);
  // В обоих реальных проектах стена 100мм, кровля 150мм.
  const [wallThickness, setWallThickness] = useState(100);
  const [roofThickness, setRoofThickness] = useState(150);
  // Профлист вместо сэндвич-панели — «холодный склад», без утепления.
  // Кровля переключается самим «Покрытие кровли» = «профлист» (то же поле,
  // что и раньше — просто раньше цена обшивки при этом молча считалась
  // как у сэндвич-панели, это баг; см. computeProject.ts).
  const [wallCladdingMaterial, setWallCladdingMaterial] = useState<"СП" | "профнастил">("СП");
  const [wallProfnastilThickness, setWallProfnastilThickness] = useState(0.5);
  // Стеновые прогоны: высоту профиля расчётчик зажимает руками (чтобы
  // обшивка легла в одну плоскость), шаг стоек торца пустой — «по числу
  // стоек фахверка». См. docs/parity/wall-purlin-engine-extraction.md.
  const [wallPurlinProfileHeight, setWallPurlinProfileHeight] = useState(145);
  const [gablePostSpacing, setGablePostSpacing] = useState("");
  const [roofProfnastilThickness, setRoofProfnastilThickness] = useState(0.7);
  const [openings, setOpenings] = useState<OpeningsInput>(DEFAULT_OPENINGS);
  const [postSpacing, setPostSpacing] = useState(2);
  const [snowGuards, setSnowGuards] = useState(true);
  // Количество распорок в исходнике вбито руками; сечение выводится
  // правилом подборщика, пустое значение — «по правилу».
  const [tubeStrutCount, setTubeStrutCount] = useState(3);
  const [strutTube, setStrutTube] = useState<StrutTube | "">("");
  // 0 — выводим сами из проёмов (вывод!E68), см. openingsFraming.
  const [extraTubeMass_t, setExtraTubeMass] = useState(0);
  // Шаг рам вручную (вывод!D9): расчётчик задаёт его при некратной длине.
  const [framePitchOverride, setFramePitchOverride] = useState(0);
  // 0 — по правилу подборщика (6° при пролёте свыше 21 м, иначе 15°).
  // Уклон влияет и на высоту торцевой стены, см. wallHeights.ts.
  const [roofSlopeOverride, setRoofSlopeOverride] = useState(0);
  // Прогон под ограждение (вывод!D27) и мин. шаг прогонов (вывод!D25).
  const [railingPurlin, setRailingPurlin] = useState(false);
  // ТЗ, п.14 — бывает заказан без организованного водостока вовсе.
  const [hasDrainage, setHasDrainage] = useState(true);
  const [minStepMm, setMinStepMm] = useState(0);
  // Код "с/в" вручную — только для сверки с файлом расчётчика.
  const [svOverride, setSvOverride] = useState("");
  // Сечение колонны вручную — общей формулы для «увеличения» при высоте
  // вне банка нет (расчётчик подтвердила: разовое инженерное решение,
  // не правило), так что вместо угадывания — ручной выбор профиля.
  const [columnOverride, setColumnOverride] = useState("");
  // Блок банка сечений (подбор!W9) — в исходнике это ОТДЕЛЬНАЯ величина от
  // γn (вывод!D7): в "22316" γn = 1, а сечения взяты из блока k = 0,8.
  const [bankK, setBankK] = useState<"auto" | ResponsibilityLevel>("auto");
  // Снеговая нагрузка вручную — подборщик для части городов берёт
  // уточнённое значение ГМЦ, которого в нашей базе нет (Сургут: 1,8 против 2,0).
  const [snowOverrideKpa, setSnowOverrideKpa] = useState(0);
  // «Спринт с СГ по Р» — вариант со шпренгельной затяжкой, только 24 м.
  const [trussedVariant, setTrussedVariant] = useState(false);
  // Раздел «Перекрытие» — в ведомости он есть, но его итог обнулён.
  const [mezzanine, setMezzanine] = useState(false);
  // Степень огнестойкости (ТЗ, п.5) — на подбор сечений не влияет, только
  // для отображения в КП; пусто — расчёт как есть, ничего не предполагаем.
  const [fireResistanceRating, setFireResistanceRating] = useState<number | "">("");
  // Панель «Расчёт»: имя объекта, сообщение о последнем действии и
  // список правок, которые понадобились при загрузке ТЗ.
  const [projectTitle, setProjectTitle] = useState("");
  const [fileMessage, setFileMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const [tzAdjustments, setTzAdjustments] = useState<string[]>([]);
  const [tzNotes, setTzNotes] = useState<string[]>([]);

  const project = useMemo(
    () =>
      computeProject({
        city,
        supplyScope,
        terrainType,
        manualClimate: manualMode
          ? { snowLoad_kPa: manualSnow, windDistrict: manualWind, label: city }
          : undefined,
        span,
        length_m: length,
        height_m: height,
        gammaN: responsibility,
        bankK,
        svOverride,
        snowLoadOverride_kPa: snowOverrideKpa,
        roofingType,
        deckingMark,
        maxStepOverride_mm: maxStepOverrideMm,
        minStep_mm: minStepMm,
        framePitchOverride_m: framePitchOverride,
        roofSlopeOverrideDeg: roofSlopeOverride > 0 ? roofSlopeOverride : undefined,
        wallPanel_mm: wallThickness,
        roofPanel_mm: roofThickness,
        openings,
        snowGuards,
        railingPurlin,
        hasDrainage,
        tubeStrutCount,
        strutTube: strutTube || undefined,
        extraTubeMass_t: extraTubeMass_t || undefined,
        postSpacing_m: postSpacing,
        trussedVariant,
        mezzanine,
        fireResistanceRating: fireResistanceRating || undefined,
        columnOverride: columnOverride || undefined,
        wallCladdingMaterial,
        wallProfnastilThickness_mm: wallProfnastilThickness,
        roofProfnastilThickness_mm: roofProfnastilThickness,
        wallPurlinsAuto:
          wallCladdingMaterial === "профнастил"
            ? {
                profileHeight_mm: wallPurlinProfileHeight > 0 ? wallPurlinProfileHeight : undefined,
                gablePostSpacing_m: Number(gablePostSpacing) > 0 ? Number(gablePostSpacing) : undefined,
              }
            : undefined,
      }),
    [
      city,
      supplyScope,
      terrainType,
      manualMode,
      manualSnow,
      manualWind,
      span,
      length,
      height,
      responsibility,
      bankK,
      svOverride,
      snowOverrideKpa,
      roofingType,
      deckingMark,
      maxStepOverrideMm,
      minStepMm,
      framePitchOverride,
      roofSlopeOverride,
      wallThickness,
      roofThickness,
      openings,
      snowGuards,
      railingPurlin,
      hasDrainage,
      tubeStrutCount,
      strutTube,
      extraTubeMass_t,
      postSpacing,
      trussedVariant,
      mezzanine,
      fireResistanceRating,
      columnOverride,
      wallCladdingMaterial,
      wallProfnastilThickness,
      wallPurlinProfileHeight,
      gablePostSpacing,
      roofProfnastilThickness,
    ],
  );

  const {
    climate,
    approximations,
    requiresCheck,
    bankBlock,
    bankBlockMissing,
    frame,
    trussedVariantMissing,
    heightBucket,
    geometry,
    roofLoad,
    frameTakeoff,
    frameFasteners,
    frameExtras,
    bracing,
    horizTiesMass_kg,
    maxPurlinStep,
    purlin,
    purlinLayout,
    openingsArea,
    openingsCost,
    envelope,
    wallCladding,
    roofCladding,
    wallTrim,
    roofTrim,
    drainage,
    unpricedSections,
    secondaryMembers,
    effectiveStrutTube,
    openingsFraming,
    facadePost,
    facadePostLayout,
    commercial,
    summary,
  } = project;

  // Ограничение из подборщика (лист «вывод», E6): «пролет 21 до высоты
  // 6,2м; пролет 21,1-24 высота до 9 м». Берём его из банка сечений,
  // чтобы поле и подбор не разошлись.
  const heightLimits = heightLimitsForSpan(span);
  const heightTooHigh = height > heightLimits.max_m;

  const fullBill = useMemo(() => buildBill(project), [project]);
  const bill = useMemo(() => buildBill(project, supplyScope), [project, supplyScope]);

  // Сколько ручных переопределений включено — чтобы свёрнутый блок не прятал их молча.
  const overrideCount =
    (snowOverrideKpa > 0 ? 1 : 0) +
    (svOverride ? 1 : 0) +
    (bankK !== "auto" ? 1 : 0) +
    (columnOverride ? 1 : 0) +
    (deckingMark !== DEFAULT_DECKING_MARK ? 1 : 0);


  // ---- Панель «Расчёт»: сохранить, открыть, загрузить ТЗ ----------------
  const inputsSnapshot = () => project.inputs;

  function saveToFile() {
    const saved = serializeProject(inputsSnapshot(), projectTitle);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameFor(saved);
    // Ссылку нужно вставить в документ: у открепленной браузер может
    // проигнорировать имя файла и сохранить как «download».
    document.body.append(a);
    a.click();
    a.remove();
    // Отзываем ссылку не сразу: браузер ещё дочитывает blob, и на гонке
    // теряется имя файла.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setProjectTitle(saved.title);
    setFileMessage({ kind: "ok", text: `Сохранено: ${fileNameFor(saved)}` });
  }

  /** Разложить исходные данные обратно по полям формы. */
  function applyInputs(next: ProjectInputs) {
    setCity(next.city ?? "");
    setSupplyScope(next.supplyScope ?? "full");
    setTerrainType(next.terrainType ?? "B");
    setManualMode(Boolean(next.manualClimate));
    if (next.manualClimate) {
      setManualSnow(next.manualClimate.snowLoad_kPa);
      setManualWind(next.manualClimate.windDistrict);
    }
    setSpan(next.span);
    setLength(next.length_m);
    setHeight(next.height_m);
    setResponsibility(next.gammaN);
    setBankK(next.bankK);
    setSvOverride(next.svOverride ?? "");
    setSnowOverrideKpa(next.snowLoadOverride_kPa ?? 0);
    setRoofingType(next.roofingType);
    setDeckingMark(next.deckingMark);
    setMaxStepOverrideMm(next.maxStepOverride_mm);
    setMinStepMm(next.minStep_mm);
    setFramePitchOverride(next.framePitchOverride_m);
    setWallThickness(next.wallPanel_mm);
    setRoofThickness(next.roofPanel_mm);
    setOpenings(next.openings);
    setSnowGuards(next.snowGuards);
    setRailingPurlin(next.railingPurlin);
    setHasDrainage(next.hasDrainage ?? true);
    setTubeStrutCount(next.tubeStrutCount);
    setStrutTube(next.strutTube ?? "");
    setExtraTubeMass(next.extraTubeMass_t ?? 0);
    setPostSpacing(next.postSpacing_m);
    setTrussedVariant(Boolean(next.trussedVariant));
    setMezzanine(Boolean(next.mezzanine));
    setFireResistanceRating(next.fireResistanceRating ?? "");
    setColumnOverride(next.columnOverride ?? "");
    setWallCladdingMaterial(next.wallCladdingMaterial ?? "СП");
    setWallProfnastilThickness(next.wallProfnastilThickness_mm ?? 0.5);
    setRoofSlopeOverride(next.roofSlopeOverrideDeg ?? 0);
    setRoofProfnastilThickness(next.roofProfnastilThickness_mm ?? 0.7);
    setWallPurlinProfileHeight(next.wallPurlinsAuto?.profileHeight_mm ?? 145);
    setGablePostSpacing(
      next.wallPurlinsAuto?.gablePostSpacing_m === undefined
        ? ""
        : String(next.wallPurlinsAuto.gablePostSpacing_m),
    );
  }

  async function openFile(file: File) {
    const parsed = parseSavedProject(await file.text());
    if (!parsed.ok) {
      setFileMessage({ kind: "error", text: parsed.error });
      return;
    }
    applyInputs(parsed.value.inputs);
    setProjectTitle(parsed.value.title);
    setTzAdjustments([]);
    setTzNotes([]);
    setFileMessage({ kind: "ok", text: `Открыт расчёт «${parsed.value.title}»` });
  }

  async function openTz(file: File) {
    try {
      const text = file.name.toLowerCase().endsWith(".pdf")
        ? await readPdfText(file)
        : await file.text();
      const tz = parseTz(text);
      const fill = tzToInputs(tz);

      if (fill.span === undefined) {
        setFileMessage({
          kind: "error",
          text: `Не удалось прочитать: ${tz.unread.join(", ") || "нет размеров здания"}`,
        });
        return;
      }
      // Города из ТЗ может не быть в справочнике — тогда сразу переводим
      // форму в ручной ввод нагрузок, чтобы менеджер не гадал, почему
      // расчёт пустой.
      const extraNotes: string[] = [];
      if (fill.city) {
        setCity(fill.city);
        const known = findSettlement(fill.city);
        setManualMode(!known);
        if (!known) {
          extraNotes.push(
            `«${fill.city}» нет в справочнике климата — задайте снеговую нагрузку ` +
              `и ветровой район вручную в карточке «Объект»`,
          );
        }
      }
      setSpan(fill.span as Span);
      if (fill.length_m !== undefined) setLength(fill.length_m);
      if (fill.height_m !== undefined) setHeight(fill.height_m);
      if (fill.gammaN !== undefined) setResponsibility(fill.gammaN as ResponsibilityLevel);
      if (fill.fireResistanceRating !== undefined) setFireResistanceRating(fill.fireResistanceRating);
      if (fill.wallPanel_mm !== undefined) setWallThickness(fill.wallPanel_mm);
      if (fill.roofPanel_mm !== undefined) setRoofThickness(fill.roofPanel_mm);
      if (fill.snowGuards !== undefined) setSnowGuards(fill.snowGuards);
      if (fill.hasDrainage !== undefined) setHasDrainage(fill.hasDrainage);
      if (fill.railingPurlin !== undefined) setRailingPurlin(fill.railingPurlin);
      setOpenings(fill.openings);
      setProjectTitle(tz.number ? `ТЗ ${tz.number}` : "");
      setTzAdjustments(fill.adjustments);
      setTzNotes([...extraNotes, ...tz.notes, ...tz.unread.map((u) => `Не прочитано: ${u}`)]);
      setFileMessage({
        kind: "ok",
        text: `Загружено ТЗ${tz.number ? ` № ${tz.number}` : ""}: поля заполнены`,
      });
    } catch (e) {
      setFileMessage({ kind: "error", text: `Не удалось прочитать файл: ${(e as Error).message}` });
    }
  }

  const supplyFrameLine = commercial.lines.find((line) => line.name === "Каркас");
  // ПС 145х1,5 — стеновой прогон в строках раздела «Каркас». Для режима
  // поставки только каркаса его стоимость исключаем вместе с 2% накладных.
  const wallPurlinCost = fullBill.materials[0]?.rows
    .filter((row) => row.name.startsWith("ПС 145"))
    .reduce((sum, row) => sum + (row.cost ?? 0), 0) ?? 0;
  const frameOnlyCost = supplyFrameLine?.cost === null || supplyFrameLine?.cost === undefined
    ? null
    : supplyFrameLine.cost - wallPurlinCost * 1.02;
  // Оба «каркасных» состава показывают одно и то же: отличаются они только
  // тем, входит ли в поставку стеновые прогоны (они в стоимость пока не идут).
  // Высоты обеих стен выносятся в подпись раздела: калькулятор тип стены не
  // знает и берёт что дадут, поэтому подмену высоты торца на карнизную видно
  // только так — глазами по ведомости.
  const wallPurlinHeightsCaption = (() => {
    const auto = project.wallPurlinsAuto;
    const base = "Стеновые прогоны — объёмы сверены, в стоимость проекта пока не входят";
    if (!auto || !auto.longWalls.ok || !auto.endWalls.ok) return base;
    const m = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    return (
      `${base}. Торец считается по коньку ${m(auto.endWalls.wallHeight_m)} м на пролёт ` +
      `${m(auto.endWalls.wallLength_m)} м, продольная стена — по карнизу ` +
      `${m(auto.longWalls.wallHeight_m)} м на длину ${m(auto.longWalls.wallLength_m)} м`
    );
  })();

  const frameOnlyScope = supplyScope !== "full";
  const supplyCost = frameOnlyScope
    ? frameOnlyCost
    : commercial.materialsWithPackaging;
  const visibleCommercialLines = frameOnlyScope
    ? commercial.lines.filter((line) => line.name === "Каркас")
    : commercial.lines.filter((line) => line.name !== "Окна, ворота, двери");

  return (
    <div className="page">
      <header>
        <h1>СпринтМ</h1>
        <p className="subtitle">Предварительный расчёт ангара ИНСИ — подбор сечений рамы</p>
      </header>

      {requiresCheck && (
        // Указание проектировщика по краям таблиц ИНСИ: считать по
        // ближайшей строке, но обязательно предупреждать. Баннер стоит
        // выше всех цифр — чтобы менеджер увидел его раньше, чем итог.
        <div className="check-notice" role="status">
          <strong>Требует проверки конструктором.</strong> Расчёт построен на допущениях —
          проверьте перед КП:
          <ul>
            {approximations.map((a) => (
              <li key={a.kind}>{a.message}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="dashboard-card" aria-label="Краткая сводка расчёта">
        <div className="dashboard-head">
          <div>
            <p className="eyebrow">ТЕКУЩИЙ СЦЕНАРИЙ</p>
            <h2>{projectTitle || "Новый расчёт"}</h2>
            <p className="dashboard-meta">
              {city || "Площадка не задана"} · {span} × {length} × {height} м · γn {responsibility.toFixed(1).replace(".", ",")}
            </p>
          </div>
          <span className={`status-pill ${requiresCheck ? "status-warn" : "status-ok"}`}>
            {requiresCheck ? "Требует проверки" : "Предварительный расчёт"}
          </span>
        </div>
        <nav className="step-nav" aria-label="Разделы расчёта">
          <a href="#object">1 Объект</a>
          <a href="#envelope">2 Ограждение</a>
          <a href="#openings">3 Проёмы</a>
          <a href="#engineering">4 Инженерные параметры</a>
          <a href="#results">5 Результаты</a>
        </nav>
        <div className="metric-grid">
          <div className="metric"><span>Площадь стен</span><strong>{envelope.wallArea.toFixed(1)} м²</strong><small>с вычетом проёмов</small></div>
          <div className="metric"><span>Площадь кровли</span><strong>{envelope.roofArea.toFixed(1)} м²</strong><small>с учётом уклона</small></div>
          <div className="metric"><span>Количество рам</span><strong>{frameTakeoff ? `${frameTakeoff.frameCount} шт.` : "—"}</strong><small>по выбранному шагу</small></div>
          <div className="metric"><span>Стоимость без проёмов</span><strong>{commercial.materialsWithPackaging !== null ? `${Math.round(commercial.materialsWithPackaging).toLocaleString("ru-RU")} ₽` : "—"}</strong><small>каркас и ограждение, с упаковкой</small></div>
        </div>
        <p className="dashboard-note">
          Инженерные количества и стоимость показываются раздельно. Excel-паритет для текущего сценария не подтверждает автоматически итог — перед КП нужна проверка конструктора.
        </p>
      </section>

      <section className="card toolbar-card" id="calculation">
        <h2>Расчёт</h2>
        <div className="form-grid">
          <label className="span-2">
            Название
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="Например, ТЗ 22326 — Увильды"
            />
          </label>
        </div>
        <div className="toolbar">
          <button type="button" onClick={saveToFile}>
            Сохранить расчёт
          </button>
          <label className="file-button">
            Открыть расчёт
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className="file-button">
            Загрузить ТЗ
            <input
              type="file"
              accept=".pdf,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openTz(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fileMessage && (
          <p className={fileMessage.kind === "error" ? "error" : "hint"}>{fileMessage.text}</p>
        )}
        {tzAdjustments.length > 0 && (
          <ul className="tz-notes">
            {tzAdjustments.map((a) => (
              <li key={a} className="incomplete">
                {a}
              </li>
            ))}
          </ul>
        )}
        {tzNotes.length > 0 && (
          <details className="tz-extra">
            <summary>Из задания, на что посмотреть глазами ({tzNotes.length})</summary>
            <ul className="tz-notes">
              {tzNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card" id="object">
        <h2>Объект</h2>
        <div className="form-grid">
          <label className="span-2">
            {manualMode ? "Площадка" : "Город"}
            <input
              list={manualMode ? undefined : "settlements"}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={manualMode ? "Название для расчёта" : "Начните вводить название"}
            />
            <datalist id="settlements">
              {settlementNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <span className="field-hint">
              {manualMode ? (
                <>
                  Нагрузки заданы вручную — из справочника ничего не берётся.{" "}
                  <button type="button" className="linklike" onClick={() => setManualMode(false)}>
                    вернуться к справочнику
                  </button>
                </>
              ) : (
                <>
                  Из него берутся снеговая и ветровая нагрузки — от них зависят сечения.{" "}
                  <button type="button" className="linklike" onClick={() => setManualMode(true)}>
                    нет в справочнике — ввести вручную
                  </button>
                </>
              )}
            </span>
          </label>

          <label>
            Состав поставки
            <select
              value={supplyScope}
              onChange={(e) => setSupplyScope(e.target.value as SupplyScope)}
            >
              <option value="full">полный комплект</option>
              <option value="frame-roof">только каркас под сэндвич-панель</option>
              <option value="frame-roof-profnastil">только каркас под профнастил</option>
            </select>
            <span className="field-hint">
              В режиме «только каркас» стены, панели и водосток не входят в поставочный итог.
              Под сэндвич-панель стеновые прогоны не нужны — панель работает по стойкам;
              под профнастил она входит в поставку, иначе листу не на что опираться.
            </span>
          </label>

          {manualMode && (
            <>
              <label>
                Снеговая нагрузка Sg, кН/м²
                <input
                  type="number"
                  min="0.1"
                  step="0.05"
                  value={manualSnow}
                  onChange={(e) => setManualSnow(Number(e.target.value))}
                />
                <span className="field-hint">
                  Снеговой район не спрашиваем: его выводит лестница нагрузок ИНСИ.
                </span>
              </label>

              <label>
                Ветровой район
                <select value={manualWind} onChange={(e) => setManualWind(e.target.value)}>
                  {WIND_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d} — w₀ {windPressureForDistrict_kPa(d)} кН/м²
                    </option>
                  ))}
                </select>
                <span className="field-hint">По СП 20.13330, карта 2.</span>
              </label>
            </>
          )}
          <label>
            Тип местности
            <select value={terrainType} onChange={(e) => setTerrainType(e.target.value as "A" | "B" | "C")}>
              <option value="A">A — открытая местность</option>
              <option value="B">B — городская/застроенная</option>
              <option value="C">C — плотная застройка/лес</option>
            </select>
            <span className="field-hint">
              Передаётся в исходные данные проекта для подбора оконных ригелей; текущие формулы каркаса пока не меняет.
            </span>
          </label>

          <label>
            Пролёт, м
            <select
              value={span}
              onChange={(e) => {
                const next = Number(e.target.value) as Span;
                setSpan(next);
                // Вариант «СГ по Р» есть только на 24 м — иначе он повис бы
                // включённым и давал вечное предупреждение.
                if (next !== 24) setTrussedVariant(false);
              }}
            >
              {SPANS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            Длина, м
            <input
              type="number"
              min="6"
              step="1"
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
            />
          </label>

          <label>
            Высота, м
            <input
              type="number"
              min={MIN_HEIGHT_M}
              step="0.1"
              value={height}
              aria-invalid={heightTooHigh || undefined}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
            <span className={`field-hint${heightTooHigh ? " invalid" : ""}`}>
              {heightTooHigh
                ? `Выше банка сечений (до ${fmt(heightLimits.max_m)} м для пролёта ${span} м) — ` +
                  `сечение рамы подобрано по максимально допустимой высоте, требует проверки конструктором`
                : heightBucket !== null && height < heightLimits.minBucket_m
                  ? `Ниже наименьшей корзины — считается по ${fmt(heightBucket)} м`
                  : heightBucket !== null
                    ? `Расчётная корзина банка: ${fmt(heightBucket)} м · для пролёта ${span} м до ${fmt(heightLimits.max_m)} м`
                    : `Для пролёта ${span} м банк держит до ${fmt(heightLimits.max_m)} м`}
            </span>
          </label>

          <label>
            Уровень ответственности γn
            <select
              value={responsibility}
              onChange={(e) => setResponsibility(Number(e.target.value) as ResponsibilityLevel)}
            >
              <option value={1.0}>II (γn = 1,0)</option>
              <option value={0.8}>III (γn = 0,8)</option>
            </select>
            <span className="field-hint">Идёт в нагрузки. Блок банка k подбирается сам.</span>
          </label>

          <label>
            Степень огнестойкости
            <select
              value={fireResistanceRating}
              onChange={(e) =>
                setFireResistanceRating(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Не задана</option>
              <option value={1}>I</option>
              <option value={2}>II</option>
              <option value={3}>III</option>
              <option value={4}>IV</option>
              <option value={5}>V</option>
            </select>
            <span className="field-hint">
              На подбор сечений не влияет (ТЗ, п.5) — только для отображения в КП.
            </span>
          </label>
        </div>
      </section>

      <section className="card" id="envelope">
        <h2>Ограждение</h2>
        <div className="form-grid">
          <label className="span-2">
            Покрытие кровли
            <select
              value={roofingType === "профлист" ? `профлист:${roofProfnastilThickness}` : roofingType}
              onChange={(e) => {
                const [type, thickness] = e.target.value.split(":");
                setRoofingType(type);
                if (thickness) {
                  setRoofProfnastilThickness(Number(thickness));
                } else {
                  // «С-П N» задаёт толщину панели сама — отдельного поля «мм» не нужно.
                  const spThickness = sandwichPanelThicknessOf(type);
                  if (spThickness !== null) setRoofThickness(spThickness);
                }
              }}
            >
              {roofOptions(roofingTypesForUi, getProfnastilThicknesses("С-44")).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Влияет и на вес прогонов, и на надбавку к снеговой нагрузке
              {sandwichPanelThicknessOf(roofingType) !== null
                ? " — толщина панели отсюда же."
                : roofingType === "профлист"
                  ? " — формула площади под профлист не сверена на реальном объекте, крепёж не посчитан."
                  : "."}
            </span>
          </label>

          <label className="span-2">
            Покрытие стен
            <select
              value={
                wallCladdingMaterial === "СП" ? `sp:${wallThickness}` : `профнастил:${wallProfnastilThickness}`
              }
              onChange={(e) => {
                const [type, thickness] = e.target.value.split(":");
                if (type === "sp") {
                  setWallCladdingMaterial("СП");
                  setWallThickness(Number(thickness));
                } else {
                  setWallCladdingMaterial("профнастил");
                  setWallProfnastilThickness(Number(thickness));
                }
              }}
            >
              {wallOptions(getSandwichPanelThicknesses(), getProfnastilThicknesses("С-18")).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {wallCladdingMaterial === "профнастил" && (
              <span className="field-hint">
                Без утепления. Формула площади не сверена на реальном объекте, крепёж не посчитан.
              </span>
            )}
          </label>

          {wallCladdingMaterial === "профнастил" && (
            <>
              <label>
                Высота стенового прогона, мм
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={wallPurlinProfileHeight}
                  onChange={(e) => setWallPurlinProfileHeight(Number(e.target.value))}
                />
                <span className="field-hint">
                  Все прогоны стены одной высоты, иначе обшивка не ляжет в плоскость.
                  0 — подбирать высоту свободно.
                </span>
              </label>

              <label>
                Шаг стоек торца, м
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  placeholder="по числу стоек"
                  value={gablePostSpacing}
                  onChange={(e) => setGablePostSpacing(e.target.value)}
                />
                <span className="field-hint">
                  Пусто — из числа стоек фахверка: пролёт / (стоек на торец + 1).
                </span>
              </label>
            </>
          )}

          <p className="hint span-2">
            Подбор сечений выполнен с учётом нагрузок текущего покрытия кровли
            {roofingType === "профлист"
              ? ` (профнастил С-44, ${roofProfnastilThickness} мм)`
              : ` (сэндвич-панель ${roofThickness} мм)`}
            {" "}и ограждения стен
            {wallCladdingMaterial === "СП"
              ? ` (сэндвич-панель ${wallThickness} мм)`
              : ` (профнастил С-18, ${wallProfnastilThickness} мм)`}
            .
            {roofLoad && (
              <>
                {" "}Расчётная нагрузка на кровлю: {roofLoad.total_kPa.toFixed(3)} кПа
                ({roofLoad.total_kg_m2.toFixed(1)} кг/м²).
              </>
            )}
          </p>

        </div>
      </section>

      <section className="card openings-card" id="openings">
        <div className="section-title-row">
          <h2>Проёмы</h2>
          <span className="separate-badge">отдельно от основного итога</span>
        </div>
        <p className="hint">
          Количество × ширина × высота, м. Несколько размеров одного типа — «+ добавить
          размер»: так же, как расчётчик заводит лишний слот вручную. Вычитаются из площади стен.
        </p>
        <div className="opening-types">
          <OpeningGroupsEditor
            label="Ворота"
            groups={openings.gates}
            defaultGroup={{ count: 1, width_m: 4, height_m: 4.5 }}
            onChange={(gates) => setOpenings({ ...openings, gates })}
            showWallSide
          />
          <OpeningGroupsEditor
            label="Двери"
            groups={openings.doors}
            defaultGroup={{ count: 1, width_m: 1, height_m: 2.1 }}
            onChange={(doors) => setOpenings({ ...openings, doors })}
          />
          <OpeningGroupsEditor
            label="Окна"
            groups={openings.windows}
            defaultGroup={{ count: 1, width_m: 3, height_m: 1 }}
            onChange={(windows) => setOpenings({ ...openings, windows })}
          />
        </div>
        <p className="field-hint">
          Всего проёмов: {openingsArea.toFixed(1)} м². Стена под обшивку:{" "}
          {envelope.wallArea.toFixed(1)} из {envelope.grossWallArea.toFixed(1)} м²
        </p>
        <div className="opening-cost">
          <span>Стоимость окон, ворот и дверей</span>
          <strong>{Math.round(openingsCost.totalCost).toLocaleString("ru-RU")} ₽</strong>
          <small>не включается в стоимость проекта и сравнение базовой стоимости</small>
        </div>
        {openingsFraming.windowSelections.length > 0 && (
          <div className="opening-cost window-rigel-results">
            <strong>Подобранные оконные ригели</strong>
            {openingsFraming.windowSelections.map((selection, index) => (
              <div className="window-rigel-row" key={`${selection.type}-${index}`}>
                <span>
                  Окна: тип {selection.type}, {selection.count} шт. — {selection.profile.name} ({selection.profile.steel})
                </span>
                <span>
                  нижний {selection.lowerLength_m.toFixed(2)} м · верхний {selection.upperLength_m.toFixed(2)} м · {selection.profile.massPerM_kg.toFixed(1)} кг/м
                </span>
              </div>
            ))}
            <span>Масса оконных ригелей</span>
            <strong>{openingsFraming.windows_kg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} кг</strong>
            <small>
              Стоимость трубы: {Math.round(openingsFraming.windows_cost).toLocaleString("ru-RU")} ₽ · обычная неоцинкованная труба
            </small>
          </div>
        )}
        <p className="field-hint">
          Ворота на длинной стене раздвигают свою раму (шаг ≥ ширина ворот + 0,8 м) — на
          торце раздвигать нечего, там рамы и так по краям здания.
        </p>
      </section>

      <section className="card" id="roofing">
        <h2>Кровля и прогоны</h2>
        <div className="form-grid">
          <label>
            Снегозадержатель
            <select
              value={snowGuards ? "есть" : "нет"}
              onChange={(e) => setSnowGuards(e.target.value === "есть")}
            >
              <option value="есть">есть</option>
              <option value="нет">нет</option>
            </select>
            <span className="field-hint">Добавляет прогон и строку доборных элементов.</span>
          </label>

          <label>
            Прогон под ограждение
            <select
              value={railingPurlin ? "есть" : "нет"}
              onChange={(e) => setRailingPurlin(e.target.value === "есть")}
            >
              <option value="нет">нет</option>
              <option value="есть">есть</option>
            </select>
          </label>

          <label>
            Водосток
            <select
              value={hasDrainage ? "есть" : "нет"}
              onChange={(e) => setHasDrainage(e.target.value === "есть")}
            >
              <option value="есть">есть</option>
              <option value="нет">нет</option>
            </select>
            <span className="field-hint">
              ТЗ, п.14. «Нет» убирает раздел «Водосток» из ведомости целиком.
            </span>
          </label>

          <label>
            Шаг рам, м
            <input
              type="number"
              min="0"
              step="0.5"
              value={framePitchOverride}
              onChange={(e) => setFramePitchOverride(Number(e.target.value))}
            />
            <span className="field-hint">
              0 — из банка сечений{framePitchOverride === 0 ? ` (${geometry.framePitch_m} м)` : ""}
            </span>
          </label>

          <label>
            Уклон кровли, град.
            <input
              type="number"
              min="0"
              step="1"
              value={roofSlopeOverride}
              onChange={(e) => setRoofSlopeOverride(Number(e.target.value))}
            />
            <span className="field-hint">
              {roofSlopeOverride > 0
                ? `Задан вручную: ${geometry.roofSlopeDeg}°.`
                : `0 — по пролёту (${geometry.roofSlopeDeg}°).`}{" "}
              Влияет и на высоту торцевой стены: подъём считается как половина
              пролёта × 0,25 при 15° и × 0,1 при 6°.
            </span>
          </label>

          <label>
            Макс. шаг прогонов, мм
            <input
              type="number"
              step="50"
              min="0"
              value={maxStepOverrideMm}
              onChange={(e) => setMaxStepOverrideMm(Number(e.target.value))}
            />
            <span className="field-hint">0 — по несущей способности настила</span>
          </label>

          <label>
            Мин. шаг прогонов, мм
            <input
              type="number"
              min="0"
              step="50"
              value={minStepMm}
              onChange={(e) => setMinStepMm(Number(e.target.value))}
            />
            <span className="field-hint">0 — без ограничения снизу</span>
          </label>
        </div>
      </section>

      <section className="card" id="engineering">
        <h2>Связи, фахверк, перекрытие</h2>
        <div className="form-grid">
          <label>
            Распорки из трубы (шт / профиль)
            <div className="inline-fields">
              <input
                type="number"
                min="0"
                value={tubeStrutCount}
                onChange={(e) => setTubeStrutCount(Number(e.target.value))}
              />
              <select
                value={strutTube}
                onChange={(e) => setStrutTube(e.target.value as StrutTube | "")}
              >
                <option value="">по правилу подборщика</option>
                <option value="60х3">60х3</option>
                <option value="80х3">80х3</option>
                <option value="120х3">120х3</option>
              </select>
            </div>
            <span className="field-hint">
              Количество в обоих реальных проектах — 3 шт.; сечение подборщик выводит по шагу рам
              (≤ 4 м — 60х3, иначе 80х3), сейчас {effectiveStrutTube}.
            </span>
          </label>

          <label>
            Обрамление проёмов, т
            <input
              type="number"
              min="0"
              step="0.001"
              value={extraTubeMass_t}
              onChange={(e) => setExtraTubeMass(Number(e.target.value))}
            />
            <span className={`field-hint${!openingsFraming.complete && extraTubeMass_t === 0 ? " invalid" : ""}`}>
              {extraTubeMass_t > 0
                ? `Задано вручную; по воротам и дверям вышло бы ${openingsFraming.total_t.toFixed(5)} т`
                : openingsFraming.complete
                  ? `0 — считаем сами: ${openingsFraming.total_t.toFixed(5)} т (ворота и двери)`
                  : "В проекте есть окна: их перемычки подбирает подборщик — впишите его «МЕ окон, ворот, дверей» (вывод!E68)"}
            </span>
          </label>

          <label>
            Шаг стоек фахверка, м
            <input
              type="number"
              min="0.5"
              step="0.1"
              value={postSpacing}
              onChange={(e) => setPostSpacing(Number(e.target.value))}
            />
            <span className="field-hint">Влияет только на подбор сечения стойки.</span>
          </label>

          <label>
            Перекрытие
            <select
              value={mezzanine ? "есть" : "нет"}
              onChange={(e) => setMezzanine(e.target.value === "есть")}
            >
              <option value="нет">нет</option>
              <option value="есть">есть</option>
            </select>
            <span className="field-hint">В ведомости раздел есть, но его итог обнулён.</span>
          </label>

          {span === 24 && (
            <label>
              Спринт с СГ по Р
              <select
                value={trussedVariant ? "да" : "нет"}
                onChange={(e) => setTrussedVariant(e.target.value === "да")}
              >
                <option value="нет">нет</option>
                <option value="да">да</option>
              </select>
              <span className="field-hint">Вариант со шпренгельной затяжкой, только 24 м.</span>
            </label>
          )}
        </div>
      </section>

      <section className="card metal-card" id="metal">
        <div className="section-title-row">
          <h2>Металлоёмкость</h2>
          <span className="calculated-badge">расчётный показатель</span>
        </div>
        <p className="hint">
          Масса металла берётся из текущей ведомости каркаса, прогонов, связей, крепежа,
          доборных профилей и стоек фахверка. Оконные, воротные и дверные изделия в этот показатель
          не входят.
        </p>
        <div className="metric-grid metal-metrics">
          <div className="metric"><span>Металл здания</span><strong>{summary.steelMass_kg.toFixed(0)} кг</strong><small>{summary.hasFullSteelMass ? "полная известная масса" : "частично, см. ограничения"}</small></div>
          <div className="metric"><span>Площадь застройки</span><strong>{(span * length).toFixed(1)} м²</strong><small>пролёт × длина</small></div>
          <div className="metric"><span>Металлоёмкость</span><strong>{(summary.steelMass_kg / (span * length)).toFixed(2).replace(".", ",")} кг/м²</strong><small>металл / площадь застройки</small></div>
        </div>
        <p className="field-hint">
          Это справочный удельный показатель для сравнения вариантов, а не замена проверке несущей способности.
        </p>
      </section>

      <details className="card overrides">
        <summary>
          Ручные переопределения
          {overrideCount > 0 && <span className="badge">{overrideCount}</span>}
        </summary>
        <p className="hint">
          Нужны, чтобы сверить расчёт с конкретным файлом расчётчика. В обычной работе не трогайте:
          снег берётся из нашей базы, а район и k выводит лестница нагрузок.
        </p>
        <div className="form-grid">
          <label>
            Снег, кН/м²
            <input
              type="number"
              min="0"
              step="0.1"
              value={snowOverrideKpa}
              onChange={(e) => setSnowOverrideKpa(Number(e.target.value))}
            />
            <span className="field-hint">0 — из нашей базы</span>
          </label>

          <label>
            Код «с/в»
            <select value={svOverride} onChange={(e) => setSvOverride(e.target.value)}>
              <option value="">по лестнице нагрузок</option>
              {SV_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            Блок банка сечений k
            <select
              value={String(bankK)}
              onChange={(e) =>
                setBankK(
                  e.target.value === "auto"
                    ? "auto"
                    : (Number(e.target.value) as ResponsibilityLevel),
                )
              }
            >
              <option value="auto">по лестнице нагрузок</option>
              <option value="1">k = 1,0</option>
              <option value="0.8">k = 0,8</option>
            </select>
          </label>

          <label>
            Марка настила
            <select value={deckingMark} onChange={(e) => setDeckingMark(e.target.value)}>
              {DECKING_MARKS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="field-hint">
              В обеих реальных ведомостях — всегда С44-1000-0,7. Менять есть смысл, только
              если приложение пишет «ни один профиль не проходит по несущей способности»
              {maxPurlinStep !== null && maxStepOverrideMm === 0 ? ` (сейчас держит ${maxPurlinStep} мм)` : ""}.
            </span>
          </label>

          <label>
            Сечение колонны вручную
            <select value={columnOverride} onChange={(e) => setColumnOverride(e.target.value)}>
              <option value="">по банку сечений</option>
              {KNOWN_PGS_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Для высоты вне банка — общей формулы «увеличения» нет, решение разовое.
              Остальная ведомость (масса, стоимость) пересчитается под этот профиль; болты и
              узловые пластины останутся по банку.
            </span>
          </label>
        </div>
      </details>

      <section className="card">
        <h2>Климат</h2>
        {climate.ok ? (
          <dl className="result-list">
            <dt>Населённый пункт</dt>
            <dd>
              {climate.value.city.settlement}, {climate.value.city.region}
            </dd>
            <dt>Снеговой район</dt>
            <dd>
              {climate.value.city.snow.region ?? (
                <span className="incomplete">задан нагрузкой</span>
              )}{" "}
              ({climate.value.city.snow.sgKpa} кПа)
              {project.snowOverridden && (
                <span className="incomplete">
                  {" "}— в расчёт ушло {project.snowLoad_kPa} кПа, задано вручную
                </span>
              )}
            </dd>
            <dt>Ветровой район</dt>
            <dd>
              {climate.value.city.wind.region} ({climate.value.city.wind.w0Kpa} кПа)
            </dd>
            <dt>Блок банка (лестница ИНСИ)</dt>
            <dd>
              {bankBlock ? (
                <>
                  район {bankBlock.snowDistrict}, k = {bankBlock.bankK} — держит{" "}
                  {bankBlock.designLoad_kPa} кПа при нагрузке{" "}
                  {bankBlock.lookupLoad_kPa.toFixed(2)} кПа (снег + {bankBlock.roofingSupplement_kPa}{" "}
                  за покрытие)
                </>
              ) : (
                <span className="incomplete">
                  {bankBlockMissing === "покрытие"
                    ? "для этого покрытия в лестнице нет надбавки — блок банка не определить"
                    : "нет снеговой нагрузки — блок банка не определить"}
                </span>
              )}
            </dd>
            <dt>Код "с/в"</dt>
            <dd>
              {climate.value.raw}
              {climate.value.raw !== climate.value.standard && (
                <>
                  {" "}&rarr;{" "}
                  {climate.overridden
                    ? "задан вручную"
                    : approximations.some((a) => a.kind === "сочетание")
                      ? "в банке нет, взят ближайший"
                      : "нормализован"}
                  : {climate.value.standard}
                </>
              )}
              {climate.overridden && (
                <span className="incomplete"> — не из нашей базы</span>
              )}
            </dd>
          </dl>
        ) : (
          <p className="error">{climate.error}</p>
        )}
        {approximations
          .filter((a) => a.kind !== "высота" && a.kind !== "обшивка")
          .map((a) => (
            <p className="hint check-hint" key={a.kind}>
              {a.message}
            </p>
          ))}
      </section>

      <section className="card">
        <h2>Сечения рамы</h2>
        {heightBucket !== null && (
          <p className="hint">Высота {height}м приведена к расчётной корзине {heightBucket}м.</p>
        )}
        {trussedVariantMissing && (
          <p className="hint incomplete">
            Варианта со связями по Р для этой комбинации в банке нет — считаю по стандартному.
          </p>
        )}
        {!climate.ok ? (
          <p className="error">Нет данных по климату — сечения не рассчитаны.</p>
        ) : frame?.ok === false ? (
          <p className="error">{frame.error}</p>
        ) : frame?.value ? (
          <>
            <div className="table-scroll">
              <table className="bill sections">
                <thead>
                  <tr>
                    <th>Элемент</th>
                    <th>Сечение</th>
                    <th>Сталь</th>
                    <th className="num">% использ.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Балки</td>
                    <td>{frame.value.beam.profile}</td>
                    <td>М.п.350</td>
                    <td className="num">{frame.value.beam.utilizationPercent}</td>
                  </tr>
                  <tr>
                    <td>Колонны</td>
                    <td>{frame.value.column.profile}</td>
                    <td>М.п.350</td>
                    <td className="num">{frame.value.column.utilizationPercent}</td>
                  </tr>
                  <tr>
                    <td>Прогоны</td>
                    <td>{purlin?.profile.name ?? "—"}</td>
                    <td>{purlin ? purlin.profile.series.replace("МП", "М.п.") : ""}</td>
                    <td className="num">—</td>
                  </tr>
                  {secondaryMembers?.derived.map((m) => (
                    <tr key={m.name}>
                      <td>{m.name}</td>
                      <td>
                        {m.section ?? <span className="incomplete">{m.missing}</span>}
                      </td>
                      <td>{m.steel}</td>
                      <td className="num">—</td>
                    </tr>
                  ))}
                  {secondaryMembers?.fixed.map((m) => (
                    <tr key={m.name}>
                      <td>{m.name}</td>
                      <td>{m.section}</td>
                      <td>{m.steel}</td>
                      <td className="num">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="result-list">
              <dt>Шаг рам</dt>
              <dd>{frame.value.framePitch_m} м</dd>
              <dt>Болты (по распоряжению №40)</dt>
              <dd>
                балки конёк {frame.value.bolts.beamRidge} · балки карниз{" "}
                {frame.value.bolts.beamEave} · колонны опора {frame.value.bolts.columnBase} ·
                колонны карниз {frame.value.bolts.columnEave} — всего{" "}
                <strong>{frame.value.bolts.totalInFrame}</strong>
              </dd>
              <dt>Затяжка к карнизной фасонке, М16</dt>
              <dd>4 шт. (200 кН)</dd>
              <dt>Вес фасонок</dt>
              <dd>
                {frame.value.massGussetPlates_kg !== null
                  ? `${frame.value.massGussetPlates_kg} кг на раму`
                  : "нет в банке"}
              </dd>
            </dl>
            <p className="hint">
              Затяжки, распорки, связи и стойки фахверка подборщик выводит правилами от пролёта,
              шага рам, длины и снегового района — здесь они посчитаны по ним же. Пластины узлов
              в подборщике вписаны константой.
            </p>
            {span > 21 && (
              <p className="hint incomplete">
                Стойку фахверка при пролёте больше 21 м подборщик считает отдельно на листе «24м» —
                этот расчёт мы ещё не разобрали. И там же он просит горизонтальные связи{" "}
                {secondaryMembers?.derived.find((m) => m.name === "Связи горизонтальные")?.section},
                тогда как в формуле массы ведомости жёстко стоит труба 80х3: массу пока считаем по
                ведомости. Оба места — вопрос расчётчику.
              </p>
            )}
          </>
        ) : (
          <p className="error">
            Комбинация пролёт={span}м, высота={heightBucket}м, k=
            {bankK === "auto" ? (bankBlock?.bankK ?? responsibility) : bankK}, с/в=
            {climate.value.standard} не найдена в банке сечений.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Ведомость материалов каркаса</h2>
        <p className="hint">
          Только колонны и балки (ригели); прогоны, связи, крепёж и обшивка — в разработке.
        </p>
        {frameTakeoff ? (
          <>
            <div className="takeoff-overview">
              <div><span>Рамы</span><strong>{frameTakeoff.frameCount} шт.</strong></div>
              <div><span>Металл каркаса</span><strong>{frameTakeoff.totalFrameMass_kg !== null ? `${frameTakeoff.totalFrameMass_kg.toFixed(0)} кг` : "—"}</strong></div>
              <div><span>Крепёж и профили</span><strong>{frameFasteners ? `${Math.round(frameFasteners.totalCost + (frameExtras?.totalCost ?? 0)).toLocaleString("ru-RU")} ₽` : "—"}</strong></div>
            </div>
            <div className="takeoff-table-wrap">
              <table className="takeoff-table">
                <thead>
                  <tr><th>Позиция</th><th>Количество</th><th>Масса</th><th>Стоимость</th></tr>
                </thead>
                <tbody>
                  <tr className="takeoff-group"><th colSpan={4}>Основной каркас</th></tr>
                  <tr><td>Колонны</td><td>{frameTakeoff.column.totalLength_m.toFixed(1)} м</td><td>{frameTakeoff.column.totalMass_kg !== null ? `${frameTakeoff.column.totalMass_kg.toFixed(0)} кг` : "—"}</td><td>—</td></tr>
                  <tr><td>Балки</td><td>{frameTakeoff.beam.totalLength_m.toFixed(1)} м</td><td>{frameTakeoff.beam.totalMass_kg !== null ? `${frameTakeoff.beam.totalMass_kg.toFixed(0)} кг` : "—"}</td><td>—</td></tr>
                  <tr className="takeoff-group"><th colSpan={4}>Профили и фасонки</th></tr>
              {frameExtras?.items.map((item) => (
                <tr key={item.name}><td>{item.name}</td><td>{item.count.toFixed(1)} {item.unit}</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{Math.round(item.cost).toLocaleString("ru-RU")} ₽</td></tr>
              ))}
                  <tr className="takeoff-group"><th colSpan={4}>Крепёж</th></tr>
              {frameFasteners?.items.map((item) => (
                <tr key={item.name}><td>{item.name}{item.isEstimated && <small className="takeoff-note">оценка</small>}</td><td>{Math.round(item.count)} шт.</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{Math.round(item.cost).toLocaleString("ru-RU")} ₽</td></tr>
              ))}
                  <tr className="takeoff-group"><th colSpan={4}>Связи и дополнительные позиции</th></tr>
              {bracing?.items.map((item) => (
                <tr key={item.name}><td>{item.name}</td><td>—</td><td>{item.mass_t === null ? "—" : `${(item.mass_t * 1000).toFixed(0)} кг`}</td><td>{item.cost === null ? "—" : `${Math.round(item.cost).toLocaleString("ru-RU")} ₽`}</td></tr>
              ))}
                  <tr><td>Гориз. связи по подборщику <small className="takeoff-note">справочно</small></td><td>—</td><td>{horizTiesMass_kg !== null ? `${horizTiesMass_kg.toFixed(0)} кг` : "—"}</td><td>—</td></tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="error">Нет данных для расчёта ведомости.</p>
        )}
      </section>

      <section className="card">
        <h2>Прогоны</h2>
        <p className="hint">
          Повторяет подбор расчётчика: перебор шага 500…3000 мм с шагом 5 мм, отсев профилей с
          коэффициентом использования больше 1 и выбор шага с наименьшей массой стали — отдельно
          по стали МП350 и МП390.
        </p>
        {roofLoad && (
          <p className="hint">
            Нагрузка на кровлю: {roofLoad.total_kg_m2.toFixed(1)} кг/м² ({roofLoad.total_kPa.toFixed(3)}{" "}
            кПа) = снег {roofLoad.snow_kg_m2.toFixed(1)} + ветер {roofLoad.wind_kg_m2.toFixed(1)} + вес
            кровли {roofLoad.dead_kg_m2.toFixed(1)}
          </p>
        )}
        {purlin ? (
          <dl className="result-list">
            <dt>Макс. шаг по настилу</dt>
            <dd>
              {maxPurlinStep} мм{maxStepOverrideMm > 0 ? " (задан вручную)" : ` (${deckingMark})`}
            </dd>
            <dt>Профиль</dt>
            <dd>
              {purlin.profile.name} ({purlin.profile.series})
            </dd>
            <dt>Подобранный шаг</dt>
            <dd>{purlin.step_mm} мм</dd>
            <dt>Расход стали</dt>
            <dd>{purlin.massPerBuildingArea_kg_m2.toFixed(2)} кг/м² здания</dd>
            {purlin.runnerUp && (
              <>
                <dt>Второй вариант</dt>
                <dd>
                  {purlin.runnerUp.profile.name} ({purlin.runnerUp.profile.series}), шаг{" "}
                  {purlin.runnerUp.step_mm} мм — {purlin.runnerUp.massPerBuilding_kg.toFixed(0)} кг
                </dd>
              </>
            )}
            {purlinLayout && (
              <>
                <dt>Линий прогонов</dt>
                <dd>
                  {purlinLayout.lineCount} шт.
                  {snowGuards ? " + прогон под снегозадержание" : ""}
                </dd>
                <dt>Суммарно на здание</dt>
                <dd>
                  {purlinLayout.totalProfileLength_m.toFixed(0)} п.м. —{" "}
                  {purlinLayout.totalMass_kg.toFixed(0)} кг
                  {purlinLayout.totalCost !== null
                    ? ` — ${purlinLayout.totalCost.toLocaleString("ru-RU")} ₽`
                    : " — цена неизвестна"}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="error">
            {maxPurlinStep === null
              ? "Не с чего считать максимальный шаг: нет снеговой нагрузки для этого " +
                "населённого пункта либо выбранной марки настила нет в таблице несущей способности."
              : "Ни один профиль не проходит по несущей способности в допустимом диапазоне шага."}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Не входит в итог расчётчика</h2>
        <p className="hint">
          У этих строк ведомости количество считается, а колонка стоимости оставлена пустой —
          в «Итого стена» и «Итого кровля» они не попадают. Показываю отдельно, чтобы было видно,
          о каких деньгах речь. Утеплитель стены и Изоспан в разделе «Стена» заглушены прямо в
          формуле (×0): стена — сэндвич-панель, утеплитель внутри неё.
        </p>
        {unpricedSections.map((s) => (
          <Fragment key={s.section}>
            <dl className="result-list">
              <dt className="group-heading">{s.section}</dt>
              <dd />
              {s.items.map((i) => (
                <Fragment key={i.name}>
                  <dt>{i.name}</dt>
                  <dd>
                    {i.count.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} {i.unit}{" "}
                    <span className="incomplete">
                      — было бы {Math.round(i.wouldCost).toLocaleString("ru-RU")} ₽
                    </span>
                  </dd>
                </Fragment>
              ))}
              <dt>Итого по разделу</dt>
              <dd className="incomplete">
                {Math.round(s.wouldAddCost).toLocaleString("ru-RU")} ₽ — не в итоге
              </dd>
            </dl>
          </Fragment>
        ))}
      </section>

      <section className="card">
        <h2>Стойки фахверка</h2>
        <p className="hint">
          Сечение — оценочно, проверка только на изгиб от ветра (без гибкости и продольной силы).
          Количество — по практическому правилу (не из формул исходного файла ИНСИ): 4 шт. на
          здание для пролёта до 18м, 6 шт. для 21–24м. Шаг стоек ниже влияет только на нагрузку при
          подборе сечения, на количество — нет.
        </p>
        {facadePost && facadePostLayout ? (
          <dl className="result-list">
            <dt>Профиль</dt>
            <dd>
              {facadePost.profile.section} ({facadePost.profile.steelGrade})
            </dd>
            <dt>Кол-во стоек</dt>
            <dd>{facadePostLayout.postCount} шт.</dd>
            <dt>Суммарно на здание</dt>
            <dd>
              {facadePostLayout.totalLength_m.toFixed(0)} м — {facadePostLayout.totalMass_kg.toFixed(0)}{" "}
              кг
            </dd>
          </dl>
        ) : (
          <p className="error">Нет данных для подбора (проверьте климат) или нагрузка слишком велика.</p>
        )}
      </section>

      <section className="card">
        <h2>Обшивка (сэндвич-панели)</h2>
        <p className="hint">
          Стены — за вычетом площади ворот/дверей ({openingsArea.toFixed(1)} м² из{" "}
          {envelope.grossWallArea.toFixed(1)} м²); окна считаются суммарной площадью, без раскладки
          по фасадам. Площадь кровли — пятно застройки с надбавкой 3% на уклон, как в исходной
          ведомости. Количество саморезов кровли зависит от числа прогонов (в исходнике оно
          вбивается вручную, у нас берётся из подбора).
        </p>
        <div className="takeoff-table-wrap">
          <table className="takeoff-table">
            <thead><tr><th>Раздел / позиция</th><th>Количество</th><th>Масса</th><th>Стоимость</th></tr></thead>
            <tbody>
          {[
            ["Стены", wallCladding] as const,
            ["Кровля", roofCladding] as const,
          ].map(([label, section]) =>
            section === null ? null : (
              <Fragment key={label}>
                <tr className="takeoff-group"><th colSpan={4}>{label}</th></tr>
                {section.items.map((item) => (
                  <tr key={`${label}-${item.name}`}><td>{item.name}</td><td>{item.count.toFixed(1)} {item.unit}</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{item.cost !== null ? `${Math.round(item.cost).toLocaleString("ru-RU")} ₽` : "нет цены"}</td></tr>
                ))}
                <tr className="takeoff-subtotal"><td>Накладные расходы (2%)</td><td>—</td><td>—</td><td>{section.overheadCost !== null ? `${Math.round(section.overheadCost).toLocaleString("ru-RU")} ₽` : "—"}</td></tr>
              </Fragment>
            ),
          )}
              <tr className="takeoff-total"><th>Итого обшивка</th><th>—</th><th>{summary.claddingMass_kg.toFixed(0)} кг</th><th>{summary.claddingCost !== null ? `${Math.round(summary.claddingCost).toLocaleString("ru-RU")} ₽` : "—"}</th></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Стены — угловые элементы</h2>
        <p className="hint">
          Раздел «Стены» исходной ведомости целиком: остальные его позиции (ПС 245х65, окрашенные
          профили, С-18, КФ) в обоих проектах обнулены. Делитель 1,9 в формулах — рабочая длина
          двухметрового элемента за вычетом нахлёста.
        </p>
        <div className="takeoff-table-wrap"><table className="takeoff-table"><thead><tr><th>Позиция</th><th>Количество</th><th>Масса</th><th>Стоимость</th></tr></thead><tbody>
          {wallTrim.items.map((item) => (
            <tr key={item.name}><td>{item.name}</td><td>{item.count.toFixed(1)} {item.unit}</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{Math.round(item.cost).toLocaleString("ru-RU")} ₽</td></tr>
          ))}
          <tr className="takeoff-subtotal"><td>Накладные расходы (2%)</td><td>—</td><td>—</td><td>{Math.round(wallTrim.overheadCost).toLocaleString("ru-RU")} ₽</td></tr>
          <tr className="takeoff-total"><th>Итого стены</th><th>—</th><th>{wallTrim.totalMass_kg.toFixed(1)} кг</th><th>{Math.round(wallTrim.totalCost).toLocaleString("ru-RU")} ₽</th></tr>
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Кровля — доборные элементы</h2>
        <p className="hint">
          Формулы и цены подтверждены дословным совпадением в обеих исходных ведомостях.
          Снегозадержатель включается вручную — в исходнике это множитель 0/1 у строки, ему
          соответствует поле «Прогон под снегозадержание» в подборе. Профлистовые варианты обшивки
          (С-18, С-44, вент. конька) в обоих проектах отключены, поэтому их здесь нет.
        </p>
        <div className="takeoff-table-wrap"><table className="takeoff-table"><thead><tr><th>Позиция</th><th>Количество</th><th>Масса</th><th>Стоимость</th></tr></thead><tbody>
          {roofTrim.items.map((item) => (
            <tr key={item.name}><td>{item.name}</td><td>{item.count.toFixed(item.count % 1 === 0 ? 0 : 1)} {item.unit}</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{Math.round(item.cost).toLocaleString("ru-RU")} ₽</td></tr>
          ))}
          <tr className="takeoff-subtotal"><td>Накладные расходы (2%)</td><td>—</td><td>—</td><td>{Math.round(roofTrim.overheadCost).toLocaleString("ru-RU")} ₽</td></tr>
          <tr className="takeoff-total"><th>Итого кровля</th><th>—</th><th>{roofTrim.totalMass_kg.toFixed(1)} кг</th><th>{Math.round(roofTrim.totalCost).toLocaleString("ru-RU")} ₽</th></tr>
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Водосток (ф150мм)</h2>
        <p className="hint">
          Формулы подтверждены дословным совпадением в обеих исходных ведомостях. Цены — из прайса
          ИНСИ на водосток, актуальны на дату исходных файлов. Дробные количества держателей и
          соединителей исходник не округляет — оставлено как есть.
        </p>
        <div className="takeoff-table-wrap"><table className="takeoff-table"><thead><tr><th>Позиция</th><th>Количество</th><th>Масса</th><th>Стоимость</th></tr></thead><tbody>
          {drainage.items.map((item) => (
            <tr key={item.name}><td>{item.name}</td><td>{item.count.toFixed(item.count % 1 === 0 ? 0 : 1)} {item.unit}</td><td>{item.mass_kg.toFixed(1)} кг</td><td>{Math.round(item.cost).toLocaleString("ru-RU")} ₽</td></tr>
          ))}
          <tr className="takeoff-subtotal"><td>Накладные расходы (2%)</td><td>—</td><td>—</td><td>{Math.round(drainage.overheadCost).toLocaleString("ru-RU")} ₽</td></tr>
          <tr className="takeoff-total"><th>Итого водосток</th><th>—</th><th>{drainage.totalMass_kg.toFixed(1)} кг</th><th>{Math.round(drainage.totalCost).toLocaleString("ru-RU")} ₽</th></tr>
        </tbody></table></div>
      </section>

      <section className="card bill-card">
        <div className="bill-head">
          <h2>Ведомость материалов</h2>
          <button type="button" className="print-button" onClick={() => window.print()}>
            Печать
          </button>
        </div>
        <p className="hint no-print">
          Те же числа, что и в карточках выше, но в порядке и структуре исходной ведомости.
          Итог каждого раздела подписан ячейкой, с которой он сверяется.
        </p>
        <div className="bill-meta">
          {climate.ok ? `${climate.value.city.settlement}, ${climate.value.city.region}` : "—"} ·{" "}
          {span} × {length} × {height} м · шаг рам {geometry.framePitch_m} м ·{" "}
          {frameTakeoff ? `${frameTakeoff.frameCount} рам` : "—"} · с/в{" "}
          {climate.ok ? climate.value.standard : "—"}
        </div>

        <table className="bill">
          <thead>
            <tr>
              <th>наименование</th>
              <th className="num">кол-во</th>
              <th>ед.</th>
              <th className="num">цена</th>
              <th className="num">стоимость</th>
              <th className="num">масса, кг</th>
            </tr>
          </thead>
          <tbody>
            {[
              { caption: "Материалы «ИНСИ»", sections: bill.materials },
              { caption: "Дополнительные материалы", sections: bill.additional },
              {
                caption: wallPurlinHeightsCaption,
                sections: bill.wallPurlins ? [bill.wallPurlins] : [],
              },
            ].map((block) => (
              <Fragment key={block.caption}>
                <tr className="bill-block">
                  <td colSpan={6}>{block.caption}</td>
                </tr>
                {block.sections.map((s) => (
                  <Fragment key={`${block.caption}-${s.sourceCell}`}>
                    <tr className="bill-section">
                      <td colSpan={6}>{s.title}</td>
                    </tr>
                    {s.rows.map((r, idx) => (
                      <tr key={`${s.sourceCell}-${r.name}-${idx}`}>
                        <td>
                          {r.name}
                          {r.note && <span className="incomplete"> — {r.note}</span>}
                        </td>
                        <td className="num">
                          {r.count === null
                            ? "—"
                            : r.count.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                        </td>
                        <td>{r.unit}</td>
                        <td className="num">
                          {r.unitPrice === null
                            ? "—"
                            : r.unitPrice.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="num">
                          {r.cost === null ? "—" : Math.round(r.cost).toLocaleString("ru-RU")}
                        </td>
                        <td className="num">
                          {r.mass_kg === null ? "—" : Math.round(r.mass_kg).toLocaleString("ru-RU")}
                        </td>
                      </tr>
                    ))}
                    {s.title !== "Стеновые прогоны" && (
                      <tr className="bill-sub">
                        <td colSpan={4}>Накладные расходы 2%</td>
                        <td className="num">
                          {s.overheadCost === null
                            ? "—"
                            : Math.round(s.overheadCost).toLocaleString("ru-RU")}
                        </td>
                        <td />
                      </tr>
                    )}
                    <tr className="bill-total">
                      <td colSpan={4}>
                        Итого {s.title.toLowerCase()} <span className="cell">{s.sourceCell}</span>
                      </td>
                      <td className="num">
                        {s.totalCost === null ? "—" : Math.round(s.totalCost).toLocaleString("ru-RU")}
                      </td>
                      <td className="num">{Math.round(s.totalMass_kg).toLocaleString("ru-RU")}</td>
                    </tr>
                  </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="bill-grand">
              <td colSpan={4}>Рекомендуемая цена реализации</td>
              <td className="num">
                {bill.recommendedPrice === null
                  ? "—"
                  : Math.round(bill.recommendedPrice).toLocaleString("ru-RU")}
              </td>
              <td className="num">{Math.round(bill.buildingMass_kg).toLocaleString("ru-RU")}</td>
            </tr>
            <tr className="bill-sub">
              <td colSpan={4}>Упаковка 2%</td>
              <td className="num">
                {bill.packaging === null ? "—" : Math.round(bill.packaging).toLocaleString("ru-RU")}
              </td>
              <td />
            </tr>
            <tr className="bill-grand">
              <td colSpan={4}>ИТОГО цена + упаковка</td>
              <td className="num">
                {bill.totalWithPackaging === null
                  ? "—"
                  : Math.round(bill.totalWithPackaging).toLocaleString("ru-RU")}
              </td>
              <td />
            </tr>
            <tr>
              <td colSpan={4}>Окна, ворота, двери</td>
              <td className="num">
                {Math.round(openingsCost.totalCost).toLocaleString("ru-RU")}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card summary-card" id="results">
        <h2>Итоговая сводка</h2>
        <p className="hint">
          {frameOnlyScope
            ? (supplyScope === "frame-roof-profnastil"
              ? "Состав поставки: каркас, кровельные прогоны и стеновые прогоны под профнастил. Обшивка, водосток и ограждение исключены из поставочного итога."
              : "Состав поставки: только каркас и кровельные прогоны под сэндвич-панель. Стеновые прогоны не нужны: панель работает по стойкам.")
            : "Структура — как в коммерческой части исходной ведомости: три статьи материалов с упаковкой 2%, проёмы отдельной строкой сверх неё."}
        </p>
        <dl className="result-list">
          {visibleCommercialLines.map((line) => (
            <Fragment key={line.name}>
              <dt>{line.name}</dt>
              <dd>
                {line.cost !== null
                  ? Math.round(line.cost).toLocaleString("ru-RU") + " ₽"
                  : "—"}
                {line.missing && (
                  <span className="incomplete"> без {line.missing}</span>
                )}
              </dd>
            </Fragment>
          ))}
          <dt>{frameOnlyScope ? "Итого поставка каркаса" : "Итого без окон, ворот и дверей"}</dt>
          <dd className="summary-total">
            {supplyCost !== null
              ? Math.round(supplyCost).toLocaleString("ru-RU") + " ₽"
              : "—"}
            {visibleCommercialLines.some((l) => l.missing) && (
              <span className="incomplete"> — занижено, см. выше</span>
            )}
          </dd>
          {supplyScope === "full" && (
            <>
              <dt>Окна, ворота, двери</dt>
              <dd>{Math.round(commercial.openingsCost).toLocaleString("ru-RU")} ₽ <span className="incomplete">— отдельно</span></dd>
            </>
          )}
          <dt className="group-heading">Справочно</dt>
          <dd />
          {fireResistanceRating !== "" && (
            <>
              <dt>Степень огнестойкости</dt>
              <dd>{["I", "II", "III", "IV", "V"][fireResistanceRating - 1]}</dd>
            </>
          )}
          <dt>Металл (каркас, прогоны, стойки)</dt>
          <dd>
            {summary.steelMass_kg.toFixed(0)} кг
            {!summary.hasFullSteelMass && " (частично — см. предупреждения выше)"}
          </dd>
          <dt>Обшивка</dt>
          <dd>{summary.claddingMass_kg.toFixed(0)} кг</dd>
          <dt>Материалы без упаковки</dt>
          <dd>
            {supplyCost !== null
              ? `${Math.round(supplyCost / 1.02).toLocaleString("ru-RU")} ₽`
              : "—"}
          </dd>
          <dt>Из чего складывается</dt>
          <dd>
            {(
              [
                ["обшивка", summary.shares.cladding],
                ["каркас", summary.shares.frame],
                ["прогоны", summary.shares.purlin],
                ["связи", summary.shares.bracing],
                ["крепёж", summary.shares.fasteners],
                ["профили", summary.shares.profiles],
                ["кровля", summary.shares.roofTrim],
                ["водосток", summary.shares.drainage],
              ] as [string, number | null][]
            )
              .filter(([, share]) => share !== null && share >= 0.5)
              .map(([name, share]) => `${name} ${share!.toFixed(0)}%`)
              .join(" · ")}
            {!summary.hasFullCost && (
              <span className="incomplete"> — доли от известной части</span>
            )}
          </dd>
        </dl>
        <p className="hint">
          Не учтено: затяжки, вертикальные связи фахверка, стойки фахверка (только масса),
          проектные работы и монтаж. Утеплитель, пароизоляция и ГВЛ показаны отдельной карточкой —
          в ведомости расчётчика у них нет цены, и в итог они не входят. Это предварительная
          оценка, не коммерческое предложение.
        </p>
      </section>

      <footer>
        <p>
          Данные подобраны по банку сечений, извлечённому из исходных Excel-калькуляторов ИНСИ.
          Прайс-лист актуален на даты, указанные в исходных файлах (разные разделы обновлялись в
          разное время).
        </p>
      </footer>
    </div>
  );
}

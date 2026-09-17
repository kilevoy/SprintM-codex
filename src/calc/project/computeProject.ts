import { findSettlement, svCodeFromDistrictsOrNearest } from "../climate/svCode";
import { manualSettlement, type ManualClimateInput } from "../climate/manualClimate";
import { resolveWindDistrict } from "../climate/windDistrict";
import type { ClimateApproximation } from "../climate/approximation";
import type { SettlementClimate, SvCodeResult } from "../climate/types";
import {
  pickBankBlock,
  roofingSupplement_kPa,
  type BankBlock,
  type LadderFallback,
} from "../climate/snowLadder";
import { computeBracing, type StrutTube } from "../frame/bracing";
import { selectSecondaryMembers } from "../frame/secondaryMembers";
import { findFrameSelection, heightLimitsForSpan, snapHeight } from "../frame/sectionBank";
import {
  computeProfnastilRoofSection,
  computeProfnastilWallSection,
  computeRoofCladdingSection,
  computeWallCladdingSection,
  type CladdingSectionTakeoff,
} from "../cladding/claddingSections";
import {
  computeMezzanineItems,
  computeRoofUnpricedItems,
  computeWallUnpricedItems,
  type UnpricedSection,
} from "../cladding/unpricedItems";
import { computeOpeningsFraming } from "../geometry/openingsFraming";
import { facadePostCount } from "../facadePost/postCount";
import { selectFacadePost } from "../facadePost/selectFacadePost";
import { computeDrainage, NO_DRAINAGE } from "../drainage/drainage";
import {
  computeProfnastilRoofArea_m2,
  computeProfnastilWallGrossArea_m2,
  computeRoofArea_m2,
  computeWallArea_m2,
} from "../geometry/buildingEnvelope";
import { computeFrameExtras } from "../geometry/frameExtras";
import { computeFrameFasteners } from "../geometry/frameFasteners";
import { computeFrameTakeoff } from "../geometry/frameTakeoff";
import { computeHorizTiesMass_kg } from "../geometry/horizTies";
import {
  computeOpeningsArea_m2,
  computeOpeningsDeduction_m2,
  computeOpeningsCost,
  groupsCount,
  widenedGateBays_m,
  windowFramingPerimeter_m,
  type OpeningsInput,
} from "../geometry/openings";
import { computeRoofLoad, defaultRoofSlopeDeg } from "../loads/roofLoad";
import { computeCommercialSummary } from "../summary/commercialSummary";
import { computeRoofTrim } from "../roofTrim/roofTrim";
import { computeWallTrim } from "../wallTrim/wallTrim";
import { computePurlinLayout } from "../purlin/purlinLayout";
import { maxPurlinStepByDecking } from "../purlin/deckingSpan";
import {
  insulationThicknessForRoofing,
  purlinFamilyForRoofing,
  roofLoadForDecking_kPa,
  selectPurlin,
} from "../purlin/selectPurlin";
import roofingTypesRaw from "../../data/roofingSelfWeight.json";
import type { ResponsibilityLevel, Span } from "../../types/common";

const roofingTypes = roofingTypesRaw as { type: string; selfWeight_kg_m2: number }[];

/**
 * Накладные расходы раздела «Каркас» — 2%, как и во всех остальных
 * разделах ведомости (ячейки C31 и C99). В модулях обшивки, водостока
 * и доборных элементов они уже учтены внутри.
 */
const SECTION_OVERHEAD = 1.02;

export interface ProjectInputs {
  city: string;
  /** Состав поставки: полный комплект или только каркас с кровельными прогонами. */
  supplyScope?: "full" | "frame-roof";
  /** Тип местности по СП (A/B/C). Нужен для подбора оконных ригелей; пока не меняет текущие формулы. */
  terrainType?: "A" | "B" | "C";
  span: Span;
  length_m: number;
  height_m: number;
  /** γn — коэффициент надёжности по ответственности (вывод!D7), идёт в нагрузки. */
  gammaN: ResponsibilityLevel;
  /**
   * Блок банка сечений (подбор!W9). В исходнике он НЕ равен γn: его вместе
   * со снеговым районом выдаёт лестница нагрузок (climate/snowLadder.ts).
   * "auto" — как в исходнике, по лестнице.
   */
  bankK: "auto" | ResponsibilityLevel;
  /** Код «с/в» вручную; пусто — из нашей климатической базы. */
  svOverride?: string;
  /**
   * Нагрузки вручную вместо поиска города — когда города нет в
   * справочнике или у него не проставлен ветровой район.
   * Задаётся снеговая нагрузка и ветровой район; снеговой район,
   * как и всегда, выводит лестница нагрузок.
   */
  manualClimate?: ManualClimateInput;
  /**
   * Расчётная снеговая нагрузка вручную, кН/м²; 0 или пусто — из нашей базы.
   *
   * Нужна для сверки: подборщик берёт снег из своего листа «Города п.К»,
   * где при заполненном столбце «По данным ГМЦ (прил. К)» используется он,
   * а не табличное значение по району. У Сургута это 1,8 против наших 2,0
   * по району IV — и от этого меняется весь подбор прогонов.
   */
  snowLoadOverride_kPa?: number;
  /** Тип покрытия (вывод!D20) — из roofingSelfWeight.json. */
  roofingType: string;
  /** Марка настила (вывод!D21) — ограничивает максимальный шаг прогонов. */
  deckingMark: string;
  /** Максимальный шаг прогонов вручную (вывод!D24); 0 — считать по настилу. */
  maxStepOverride_mm: number;
  /** Минимальный шаг прогонов (вывод!D25); 0 — без ограничения. */
  minStep_mm: number;
  /** Шаг рам вручную (вывод!D9); 0 — из банка сечений. */
  framePitchOverride_m: number;
  wallPanel_mm: number;
  roofPanel_mm: number;
  openings: OpeningsInput;
  /** Прогон под снегозадержание (вывод!D26) — он же множитель строки снегозадержателя. */
  snowGuards: boolean;
  /** Прогон под ограждение (вывод!D27). */
  railingPurlin: boolean;
  /**
   * Организованный водосток (ТЗ, п.14) — раздел «Водосток». Пусто/true —
   * как раньше, есть. false — раздела нет совсем, а не просто других
   * размеров: «21923» (Москва) заказан без него, F70 = 0 в ведомости.
   * Независим от snowGuards: у «21923» снегозадержатели в одном из двух
   * вариантов есть, а водостока нет ни в одном.
   */
  hasDrainage?: boolean;
  /** Количество распорок из трубы (K95) — вбито вручную. */
  tubeStrutCount: number;
  /**
   * Труба распорок вручную. Пусто — по правилу подборщика
   * (вывод!D38: шаг рам ≤ 4 м → 60х3, иначе 80х3).
   */
  strutTube?: StrutTube;
  /**
   * Слагаемое «Конструкций из труб» вручную, т. Пусто — считаем сами:
   * это металл обрамления проёмов (вывод!E68), см. openingsFraming.
   * Ручной ввод нужен, когда в проекте есть окна: их перемычки
   * подборщик подбирает у себя, и этот расчёт мы ещё не разобрали.
   */
  extraTubeMass_t?: number;
  /** Шаг стоек фахверка, м — влияет только на подбор сечения стойки. */
  postSpacing_m: number;
  /**
   * «Спринт с СГ по Р» — вариант каркаса со шпренгельной затяжкой
   * (вывод!C29: «для пролета 24м, если спринт с СГ по Р, пиши +»).
   * В банке такие строки есть только для пролёта 24 м и с/в 1/3.
   */
  trussedVariant?: boolean;
  /**
   * Считать раздел «Перекрытие». В обеих реальных ведомостях количества
   * там считаются всегда, но стоимость не заведена и итог равен нулю,
   * поэтому по умолчанию раздел выключен.
   */
  mezzanine?: boolean;
  /**
   * Требуемая степень огнестойкости здания (ТЗ, п.5) — 1…5. Подтверждено
   * расчётчиком: на расчёт не влияет и позиция «Штрипс (защита рам)» не
   * считается ни в каком случае (формула `IF(G9=4,...)` в файле подсчёта
   * материалов на практике не применяется) — поле чисто информационное,
   * нужно только для отображения в коммерческом предложении.
   */
  fireResistanceRating?: number;
  /**
   * Сечение колонны вручную — вместо того, что даёт банк сечений.
   *
   * Нужно для высоты вне банка: расчётчик подтвердила, что «увеличение
   * сечения» — разовое инженерное решение по расчёту, не формула («Это
   * совпадение», когда её спросили, не берёт ли она сечение балки).
   * Общего правила нет, поэтому вместо угадывания — поле ручного ввода:
   * остальная ведомость (масса, стоимость) пересчитывается под указанный
   * профиль, болты и узловые пластины остаются по банку (не найдено, как
   * они меняются при увеличении колонны).
   */
  columnOverride?: string;
  /**
   * Обшивка стен — сэндвич-панель (по умолчанию) или профлист С-18 (без
   * утепления, «холодный склад»). Кровля переключается на профлист С-44
   * автоматически, когда «Покрытие кровли» = "профлист" (то же поле уже
   * отвечает за собственный вес по нагрузкам — раньше цена обшивки при
   * этом всё равно молча считалась как у сэндвич-панели, это и есть тот
   * баг, из-за которого добавлена профлистовая ветка).
   *
   * Формулы площади под профлист (буквально есть в файле подборщика,
   * строки "С-18"/"С-44") взяты из ВЫКЛЮЧЕННЫХ (×0) строк — ни на одном
   * реальном профлистовом объекте не сверялись, только на СП-проектах,
   * где эта ветка не используется. Требует подтверждения на первом
   * реальном расчёте.
   */
  wallCladdingMaterial?: "СП" | "профнастил";
  /** Толщина профлиста стен, мм — 0,5 или 0,7. Без разницы, если стены не профлист. */
  wallProfnastilThickness_mm?: number;
  /** Толщина профлиста кровли, мм — 0,5 или 0,7. Без разницы, если кровля не профлист. */
  roofProfnastilThickness_mm?: number;
}

export type ProjectResult = ReturnType<typeof computeProject>;

/**
 * Весь расчёт объекта одной чистой функцией — ровно то, что раньше жило
 * россыпью useMemo в App.tsx.
 *
 * Вынесено, чтобы сверку с ведомостями расчётчика можно было
 * зафиксировать тестами, а не проверять глазами в браузере: см.
 * computeProject.test.ts, где оба реальных проекта прогоняются целиком.
 */
export function computeProject(inputs: ProjectInputs) {
  const {
    city,
    span,
    length_m,
    height_m,
    gammaN,
    bankK,
    svOverride,
    manualClimate,
    snowLoadOverride_kPa,
    roofingType,
    deckingMark,
    maxStepOverride_mm,
    minStep_mm,
    framePitchOverride_m,
    wallPanel_mm,
    roofPanel_mm,
    openings,
    snowGuards,
    railingPurlin,
    hasDrainage = true,
    tubeStrutCount,
    strutTube,
    extraTubeMass_t,
    postSpacing_m,
    trussedVariant,
    mezzanine,
    columnOverride,
    wallCladdingMaterial = "СП",
    wallProfnastilThickness_mm = 0.5,
    roofProfnastilThickness_mm = 0.7,
  } = inputs;

  const wallIsProfnastil = wallCladdingMaterial === "профнастил";
  const roofIsProfnastil = roofingType === "профлист";

  // ---- Климат -------------------------------------------------------
  //
  // Снеговой район и коэффициент k блока банка ИНСИ выводит не из
  // справочника, а из НАГРУЗКИ — через лестницу порогов (снегветер).
  // Нагрузку берём свою, правило перевода — их. Ветровой район у них
  // читается по СП напрямую, как и у нас.
  let climate:
    | { ok: true; value: SvCodeResult; overridden: boolean }
    | { ok: false; error: string };
  let bankBlock: BankBlock | null = null;
  /**
   * Допущения, из-за которых расчёт помечается «требует проверки».
   * По указанию проектировщика город на краю таблиц не отбрасывается:
   * берётся ближайшая просчитанная строка, а несовпадение выносится сюда.
   */
  const approximations: ClimateApproximation[] = [];

  // Высота выше предела банка сечений (подборщик!вывод!E6: «пролет 21 до
  // высоты 6,2м...») — расчётчик подтвердила методику: в подборщик вводится
  // максимально допустимая высота банка, сечение колонны увеличивается,
  // результат проверяется главным конструктором. Сверено на реальном
  // проекте «22330» (пролёт 15, высота по ТЗ 7 м): в файле расчётчика на
  // чертеже подписано «7,0(6,0) м» — фактически подобрано по корзине 6,0 м,
  // что и получается, если передать в банк капнутую высоту 6,2 м (последний
  // порог для пролётов 9…21 снэпается в корзину 6,0). Капается только
  // высота, что уходит в подбор сечения рамы (frame section bank) — все
  // остальные величины (площадь обшивки, масса, лестница нагрузок и т.д.)
  // считаются по РЕАЛЬНОЙ высоте ТЗ: во «втором файле» (подсчёт
  // материалов) расчётчик вводит именно её, не капнутую.
  const heightLimits = heightLimitsForSpan(span);
  const heightExceedsBank = height_m > heightLimits.max_m;
  const effectiveHeight_m = heightExceedsBank ? heightLimits.max_m : height_m;
  if (heightExceedsBank) {
    const ru = (v: number) => String(v).replace(".", ",");
    approximations.push({
      kind: "высота",
      message:
        `Высота ${ru(height_m)} м для пролёта ${span} м выше предела банка сечений ` +
        `(${ru(heightLimits.max_m)} м). Для подбора сечения рамы принята максимально ` +
        `допустимая высота банка — сечение колонны нужно увеличивать вручную. ` +
        `Обязательно согласуйте с главным конструктором перед КП.`,
    });
  }

  try {
    // Ручной ввод подменяет поиск города, дальше всё считается одинаково.
    const found = manualClimate ? manualSettlement(manualClimate) : findSettlement(city);
    if (!found) throw new Error(`Город "${city}" не найден в справочнике климата`);

    const snow_kPa =
      snowLoadOverride_kPa != null && snowLoadOverride_kPa > 0
        ? snowLoadOverride_kPa
        : found.snow.sgKpa;

    const pick = snow_kPa === null ? null : pickBankBlock(snow_kPa, roofingType, gammaN);
    bankBlock = pick?.block ?? null;
    if (pick?.fallback) approximations.push(ladderApproximation(pick.fallback, pick.block));

    // Ветровой район: из справочника, а у трёх пограничных городов —
    // самый тяжёлый из тех, между которыми они стоят.
    const wind = resolveWindDistrict(found);
    if (wind?.border) {
      approximations.push({
        kind: "ветер",
        message:
          `Ветровой район не проставлен: город на границе ` +
          `${wind.border.between.join(", ")} — считаю по ${wind.district}, самому тяжёлому.`,
      });
    }
    const cityData: SettlementClimate = wind
      ? { ...found, wind: { ...found.wind, region: wind.district, w0Kpa: wind.w0Kpa } }
      : found;

    let raw = "";
    let standard = "";
    if (bankBlock && wind) {
      const code = svCodeFromDistrictsOrNearest(bankBlock.snowDistrict, wind.district);
      raw = code.raw;
      standard = code.standard;
      if (code.nearest) {
        approximations.push({
          kind: "сочетание",
          message:
            `Сочетание «с/в» ${code.nearest.raw} в банке сечений не просчитано — ` +
            `считаю по ближайшему ${code.nearest.used}.`,
        });
      }
    } else if (!svOverride) {
      throw new Error(
        bankBlock
          ? "Не задан ветровой район"
          : "Не из чего вывести блок банка: нет снеговой нагрузки или надбавки за покрытие",
      );
    }

    const value: SvCodeResult = { city: cityData, raw, standard };
    climate = {
      ok: true,
      value: svOverride ? { ...value, standard: svOverride } : value,
      overridden: Boolean(svOverride),
    };
  } catch (e) {
    climate = { ok: false, error: (e as Error).message };
  }

  // ---- Сечения рамы -------------------------------------------------
  let frame:
    | { ok: true; value: ReturnType<typeof findFrameSelection> }
    | { ok: false; error: string }
    | null = null;
  // Вариант «СГ по Р» есть в банке не для всякой комбинации; если его нет,
  // считаем по стандартному и говорим об этом.
  let trussedVariantMissing = false;
  if (climate.ok) {
    try {
      const query = {
        span,
        height_m: effectiveHeight_m,
        responsibility: bankK === "auto" ? (bankBlock?.bankK ?? gammaN) : bankK,
        svCode: climate.value.standard,
      };
      let value = findFrameSelection(
        trussedVariant ? { ...query, variant: "вариант_2" } : query,
      );
      if (trussedVariant && !value) {
        trussedVariantMissing = true;
        value = findFrameSelection(query);
      }
      frame = { ok: true, value };
    } catch (e) {
      frame = { ok: false, error: (e as Error).message };
    }
  }
  const bankSelection = frame?.ok ? frame.value : null;
  const selection =
    bankSelection && columnOverride
      ? { ...bankSelection, column: { ...bankSelection.column, profile: columnOverride } }
      : bankSelection;
  if (bankSelection && columnOverride && columnOverride !== bankSelection.column.profile) {
    approximations.push({
      kind: "высота",
      message:
        `Сечение колонны задано вручную: ${columnOverride} (по банку сечений — ` +
        `${bankSelection.column.profile}). Болты и узловые пластины остаются по банку — ` +
        `как они меняются при увеличении сечения, не выяснено. Требует проверки конструктором.`,
    });
    // Возвращаем наружу (в т.ч. для UI) уже с учётом override — иначе
    // карточка «Сечения рамы» показала бы старый профиль, а ведомость
    // считала бы по новому: расхождение прямо в интерфейсе.
    frame = { ok: true, value: selection ?? undefined };
  }

  let heightBucket: number | null;
  try {
    heightBucket = snapHeight(span, effectiveHeight_m);
  } catch {
    heightBucket = null;
  }

  const roofingSelfWeight_kg_m2 =
    roofingTypes.find((r) => r.type === roofingType)?.selfWeight_kg_m2 ?? 0;
  const sgFromBase = climate.ok ? climate.value.city.snow.sgKpa : null;
  const sgKpa =
    snowLoadOverride_kPa != null && snowLoadOverride_kPa > 0 ? snowLoadOverride_kPa : sgFromBase;
  const snowOverridden = sgKpa !== null && sgKpa !== sgFromBase;
  const roofSlopeDeg = defaultRoofSlopeDeg(span);

  const roofLoad =
    sgKpa === null
      ? null
      : computeRoofLoad({ sgKpa, roofSlopeDeg, selfWeight_kg_m2: roofingSelfWeight_kg_m2 });

  const geometry = {
    span_m: span,
    length_m,
    height_m,
    framePitch_m:
      framePitchOverride_m > 0 ? framePitchOverride_m : (selection?.framePitch_m ?? 6),
    roofSlopeDeg,
  };

  // ---- Каркас -------------------------------------------------------
  const widenedBays_m = widenedGateBays_m(openings.gates, geometry.framePitch_m);
  const frameTakeoff =
    selection && heightBucket !== null
      ? computeFrameTakeoff(geometry, selection, widenedBays_m)
      : null;

  // База формулы болтов М16 — «Болты в раме» выбранной строки банка.
  const frameFasteners =
    frameTakeoff && selection
      ? computeFrameFasteners(geometry, frameTakeoff.frameCount, selection.bolts.totalInFrame)
      : null;

  const frameExtras = frameTakeoff ? computeFrameExtras(geometry, frameTakeoff.frameCount) : null;

  // Второстепенные сечения — затяжки, распорки, связи, стойки фахверка:
  // подборщик выводит их формулами (вывод!D36:D41), см. secondaryMembers.
  const secondaryMembers = bankBlock
    ? selectSecondaryMembers({
        span_m: span,
        length_m,
        height_m,
        framePitch_m: geometry.framePitch_m,
        snowDistrict: bankBlock.snowDistrict,
        trussedVariant,
      })
    : null;
  const derivedStrutTube = secondaryMembers?.derived.find((m) => m.name === "Распорки")?.section;
  const effectiveStrutTube: StrutTube =
    strutTube ?? ((derivedStrutTube as StrutTube | undefined) ?? "80х3");

  // Слагаемое «Конструкций из труб», которое расчётчик вписывает руками:
  // это металл обрамления проёмов из подборщика (вывод!E68).
  const openingsFraming = computeOpeningsFraming({
    gates: openings.gates,
    doorsCount: groupsCount(openings.doors),
    framePitch_m: geometry.framePitch_m,
    hasWindows: openings.windows.some((w) => w.count > 0 && w.width_m > 0),
    windows: openings.windows,
    windowWindLoad_kPa: climate.ok ? (climate.value.city.wind.w0Kpa ?? undefined) : undefined,
    windowVerticalLoad_kPa: 0.42,
  });
  const effectiveExtraTubeMass_t = extraTubeMass_t ?? openingsFraming.total_t;

  const bracing =
    frameTakeoff && selection
      ? computeBracing({
          span_m: span,
          length_m,
          height_m,
          framePitch_m: geometry.framePitch_m,
          frameCount: frameTakeoff.frameCount,
          tubeStrutCount,
          strutTube: effectiveStrutTube,
          extraTubeMass_t: effectiveExtraTubeMass_t,
          windowFramingPerimeter_m: windowFramingPerimeter_m(openings, geometry.framePitch_m),
          gussetMassPerFrame_kg: selection.massGussetPlates_kg,
        })
      : null;

  const horizTiesMass_kg = climate.ok
    ? computeHorizTiesMass_kg(span, climate.value.standard, length_m)
    : null;

  // ---- Прогоны ------------------------------------------------------
  // «Макс шаг прогонов» (вывод!D23): по несущей способности настила при
  // нагрузке на покрытие × 1,15. Ручной ввод (вывод!D24) перекрывает его.
  const maxPurlinStep =
    sgKpa === null
      ? null
      : maxStepOverride_mm > 0
        ? maxStepOverride_mm
        : maxPurlinStepByDecking(deckingMark, roofLoadForDecking_kPa(sgKpa, roofSlopeDeg) * 1.15);

  const purlin =
    sgKpa === null || maxPurlinStep === null
      ? null
      : selectPurlin(
          {
            span_m: span,
            framePitch_m: geometry.framePitch_m,
            snowLoad_kPa: sgKpa,
            roofingSelfWeight_kg_m2,
            roofSlopeDeg,
            gammaN,
            maxStep_mm: maxPurlinStep,
            minStep_mm,
            snowGuardPurlin: snowGuards,
            railingPurlin,
            family: purlinFamilyForRoofing(roofingType),
            insulationThickness_mm: insulationThicknessForRoofing(roofingType),
          },
          length_m,
        );

  const purlinLayout = purlin
    ? computePurlinLayout(purlin, span, length_m, {
        snowGuardPurlin: snowGuards,
        railingPurlin,
      })
    : null;

  // ---- Ограждение ---------------------------------------------------
  const openingsArea = computeOpeningsArea_m2(openings);
  // Из стены вычитаются размеры, округлённые вниз до целых метров.
  const openingsDeduction = computeOpeningsDeduction_m2(openings);
  const openingsCost = computeOpeningsCost(openings);

  const grossWallArea = wallIsProfnastil
    ? computeProfnastilWallGrossArea_m2(geometry)
    : computeWallArea_m2(geometry);
  const envelope = {
    grossWallArea,
    wallArea: Math.max(0, grossWallArea - openingsDeduction),
    roofArea: roofIsProfnastil ? computeProfnastilRoofArea_m2(geometry) : computeRoofArea_m2(geometry),
  };

  const wallCladding: CladdingSectionTakeoff = wallIsProfnastil
    ? computeProfnastilWallSection(envelope.wallArea, wallProfnastilThickness_mm)
    : computeWallCladdingSection(geometry, envelope.wallArea, wallPanel_mm);
  const roofCladding = !purlinLayout
    ? null
    : roofIsProfnastil
      ? computeProfnastilRoofSection(envelope.roofArea, roofProfnastilThickness_mm)
      : computeRoofCladdingSection(geometry, envelope.roofArea, roofPanel_mm, purlinLayout.lineCount);

  if (wallIsProfnastil || roofIsProfnastil) {
    approximations.push({
      kind: "обшивка",
      message:
        `Обшивка профлистом (${[wallIsProfnastil && "стены", roofIsProfnastil && "кровля"].filter(Boolean).join(", ")}): ` +
        `формула площади взята из выключенной (×0) строки ведомости — ни на одном реальном ` +
        `профлистовом объекте не сверялась. Крепёж (саморезы) под профлист не посчитан вовсе — ` +
        `формулы для него нет. Требует проверки перед КП.`,
    });
  }

  const wallTrim = computeWallTrim(geometry);
  const roofTrim = computeRoofTrim(geometry, { snowGuards });
  // ТЗ, п.14 — водосток бывает не заказан вовсе («21923»: F70 = 0 в обоих
  // вариантах), а не просто с другими размерами; тогда раздела нет совсем.
  const drainage = hasDrainage ? computeDrainage(geometry) : NO_DRAINAGE;

  // Строки ведомости, у которых количество считается, а стоимость не заведена.
  const unpricedSections: UnpricedSection[] = [computeWallUnpricedItems(geometry)];
  if (purlinLayout) {
    unpricedSections.push(
      computeRoofUnpricedItems(geometry, roofPanel_mm, purlinLayout.totalProfileLength_m),
    );
  }
  if (mezzanine && frameTakeoff) {
    unpricedSections.push(computeMezzanineItems(geometry, frameTakeoff.frameCount));
  }

  // ---- Фахверк ------------------------------------------------------
  const w0Kpa = climate.ok ? climate.value.city.wind.w0Kpa : null;
  const facadePost =
    w0Kpa === null ? undefined : selectFacadePost({ w0_kPa: w0Kpa, postSpacing_m, height_m });
  const facadePostLayout = facadePost
    ? (() => {
        // Количество — по практическому правилу (не из формул исходного
        // файла ИНСИ, см. facadePost/postCount.ts), не по периметру/шагу.
        const postCount = facadePostCount(span);
        const totalLength_m = postCount * height_m;
        return {
          postCount,
          totalLength_m,
          totalMass_kg: totalLength_m * facadePost.profile.mass_kg_per_m,
        };
      })()
    : null;

  // ---- Коммерческая сводка ------------------------------------------
  // Раскладка по статьям исходной ведомости (строки 155–160).
  // «Каркас» = F32 + F100, «Стеновое» = F44 + F114,
  // «Кровельное» = F147 + F70 + F81.
  const frameMaterials =
    frameTakeoff?.totalFrameCost != null &&
    purlinLayout?.totalCost != null &&
    frameExtras != null &&
    frameFasteners != null &&
    bracing?.totalCost != null
      ? (frameTakeoff.totalFrameCost +
          purlinLayout.totalCost +
          frameExtras.totalCost +
          frameFasteners.totalCost +
          bracing.totalCost) *
        SECTION_OVERHEAD
      : null;

  const wallMaterials =
    wallCladding.totalCost != null ? wallCladding.totalCost + wallTrim.totalCost : null;
  const roofMaterials =
    roofCladding?.totalCost != null
      ? roofCladding.totalCost + drainage.totalCost + roofTrim.totalCost
      : null;

  const commercial = computeCommercialSummary({
    frameMaterials,
    wallMaterials,
    roofMaterials,
    openingsCost: openingsCost.totalCost,
    frameMissing: bracing?.missing,
  });

  // ---- Справочные итоги ---------------------------------------------
  const steelMass_kg =
    (frameTakeoff?.totalFrameMass_kg ?? 0) +
    (frameFasteners?.totalMass_kg ?? 0) +
    (bracing?.totalMass_kg ?? 0) +
    (frameExtras?.totalMass_kg ?? 0) +
    wallTrim.totalMass_kg +
    (purlinLayout?.totalMass_kg ?? 0) +
    (facadePostLayout?.totalMass_kg ?? 0);
  const claddingMass_kg = wallCladding.totalMass_kg + (roofCladding?.totalMass_kg ?? 0);
  const hasFullSteelMass =
    frameTakeoff?.totalFrameMass_kg != null &&
    frameFasteners !== null &&
    bracing?.totalMass_kg != null &&
    purlinLayout?.totalMass_kg != null &&
    facadePostLayout?.totalMass_kg != null;

  const claddingCost =
    wallCladding.totalCost != null && roofCladding?.totalCost != null
      ? wallCladding.totalCost + roofCladding.totalCost
      : null;

  const knownCost =
    (frameTakeoff?.totalFrameCost ?? 0) +
    (claddingCost ?? 0) +
    (purlinLayout?.totalCost ?? 0) +
    (frameFasteners?.totalCost ?? 0) +
    (frameExtras?.totalCost ?? 0) +
    (bracing?.totalCost ?? 0) +
    wallTrim.totalCost +
    drainage.totalCost +
    roofTrim.totalCost;
  const hasFullCost =
    frameTakeoff?.totalFrameCost != null &&
    claddingCost != null &&
    purlinLayout?.totalCost != null &&
    bracing?.totalCost != null;

  // Доля каждой статьи в известной стоимости — обшивка не зависит от
  // климата (только от геометрии) и обычно доминирует, из-за чего при
  // смене города меняется в основном «невидимая на глаз» часть.
  const shareOf = (cost: number | null | undefined) =>
    cost != null && knownCost > 0 ? (cost / knownCost) * 100 : null;

  return {
    /** Исходные данные как есть — чтобы расчёт можно было сохранить и открыть. */
    inputs,
    climate,
    /** Пара «снеговой район + k», выбранная лестницей нагрузок ИНСИ. */
    bankBlock,
    /**
     * Допущения расчёта: точной строки для этого города в таблицах ИНСИ
     * нет, взята ближайшая. Пустой список — расчёт точный.
     */
    approximations,
    /** Расчёт построен на допущениях и подлежит проверке конструктором. */
    requiresCheck: approximations.length > 0,
    /**
     * Почему лестница не дала пару — если не дала. Нагрузка вне лестницы
     * сюда больше не попадает: край считается по крайней ступени (см.
     * approximations). Остаются два случая — нет надбавки за покрытие и
     * нет самой снеговой нагрузки.
     */
    bankBlockMissing:
      bankBlock !== null
        ? null
        : roofingSupplement_kPa(roofingType) === null
          ? ("покрытие" as const)
          : ("нагрузка" as const),
    /** Снеговая нагрузка, фактически ушедшая в расчёт, кН/м². */
    snowLoad_kPa: sgKpa,
    snowOverridden,
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
    openingsDeduction,
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
    effectiveExtraTubeMass_t,
    facadePost,
    facadePostLayout,
    commercial,
    summary: {
      steelMass_kg,
      claddingMass_kg,
      hasFullSteelMass,
      claddingCost,
      knownCost,
      hasFullCost,
      shares: {
        frame: shareOf(frameTakeoff?.totalFrameCost),
        purlin: shareOf(purlinLayout?.totalCost),
        cladding: shareOf(claddingCost),
        drainage: shareOf(drainage.totalCost),
        fasteners: shareOf(frameFasteners?.totalCost),
        bracing: shareOf(bracing?.totalCost),
        roofTrim: shareOf(roofTrim.totalCost),
        profiles: shareOf((frameExtras?.totalCost ?? 0) + wallTrim.totalCost),
      },
    },
  };
}

/** Человеческая формулировка отката на крайнюю ступень лестницы. */
function ladderApproximation(fallback: LadderFallback, block: BankBlock): ClimateApproximation {
  const ru = (v: number) => v.toFixed(2).replace(".", ",");
  const load = ru(block.lookupLoad_kPa);
  const edge = ru(fallback.threshold_kPa);
  return {
    kind: "лестница",
    message:
      fallback.kind === "выше"
        ? `Нагрузка ${load} кПа выше последней ступени лестницы ИНСИ (${edge} кПа) — ` +
          `считаю по ней: район ${block.snowDistrict}, k = ${block.bankK}.`
        : `Нагрузка ${load} кПа ниже первой ступени лестницы ИНСИ (${edge} кПа) — ` +
          `считаю по ней: район ${block.snowDistrict}, k = ${block.bankK}.`,
  };
}

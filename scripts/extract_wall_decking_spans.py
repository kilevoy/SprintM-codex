"""Извлекает таблицу допустимых пролётов профлиста/сэндвич-панели из книги
«Калькулятор ограждайки».

Источник — Лист1 исходной книги:
  B109:B158  — пролёт (шаг опор), мм;
  C108:M108  — марки покрытия (11 столбцов);
  C109:M158  — допустимая нагрузка для этой марки на этом пролёте, кН/м².

Лист1!B24 (макс. шаг угловой зоны) и B29 (рядовой) выбираются из этой
таблицы как самый большой пролёт, чья допустимая нагрузка не меньше
расчётной нагрузки зоны:
  B24 = INDEX(B109:B158, MATCH(E22, N109:N158, -1), 1)
где N — столбец выбранной марки, а E22/E27 — расчётная нагрузка зоны.
"""

import json
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

SPAN_COLUMN = "B"
LOAD_COLUMNS = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]
NAME_ROW = 108
FIRST_ROW = 109
LAST_ROW = 158


def column_of(ref: str) -> str:
    return "".join(ch for ch in ref if ch.isalpha())


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workbook", type=Path)
parser.add_argument("--output", type=Path, default=Path("src/data/wallDeckingSpans.generated.json"))
args = parser.parse_args()
source = args.workbook.resolve()

with ZipFile(source) as archive:
    shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    shared = ["".join(node.itertext()) for node in shared_root.findall("m:si", NS)]
    sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

by_row: dict[int, dict[str, object]] = {}
for row in sheet.findall(".//m:sheetData/m:row", NS):
    index = int(row.attrib["r"])
    if index != NAME_ROW and not FIRST_ROW <= index <= LAST_ROW:
        continue
    values: dict[str, object] = {}
    for cell in row.findall("m:c", NS):
        raw = cell.findtext("m:v", default=None, namespaces=NS)
        inline = cell.find("m:is/m:t", NS)
        if inline is not None:
            raw = inline.text
        if raw is None:
            continue
        if cell.attrib.get("t") == "s":
            raw = shared[int(raw)]
        else:
            try:
                raw = float(raw)
            except ValueError:
                pass
        values[column_of(cell.attrib["r"])] = raw
    by_row[index] = values

names = by_row.get(NAME_ROW, {})
marks = []
for position, column in enumerate(LOAD_COLUMNS, start=1):
    mark = names.get(column)
    if isinstance(mark, str) and mark.strip():
        marks.append({"mark": mark.strip(), "column": position})

spans = []
for index in range(FIRST_ROW, LAST_ROW + 1):
    values = by_row.get(index)
    if not values:
        continue
    span = values.get(SPAN_COLUMN)
    if not isinstance(span, (int, float)):
        continue
    loads = {}
    for entry in marks:
        raw = values.get(LOAD_COLUMNS[entry["column"] - 1])
        if isinstance(raw, (int, float)):
            loads[entry["mark"]] = raw
    spans.append({"span_mm": int(span), "allowableLoad_kPa": loads})

args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(
    json.dumps(
        {
            "source": "Калькулятор ограждайки v1.5.xlsx",
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest().upper(),
            "sheet": "Лист1",
            "range": f"{SPAN_COLUMN}{FIRST_ROW}:{LOAD_COLUMNS[-1]}{LAST_ROW}",
            "marks": [entry["mark"] for entry in marks],
            "spans": spans,
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
print(f"wrote {len(spans)} spans x {len(marks)} marks from {source} to {args.output}")

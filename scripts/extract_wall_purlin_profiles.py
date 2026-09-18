import json
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def col(ref):
    return "".join(x for x in ref if x.isalpha())

parser = argparse.ArgumentParser(description="Extract the wall-purlin selector table from an Excel workbook.")
parser.add_argument("workbook", type=Path)
parser.add_argument("--output", type=Path, default=Path("src/data/wallPurlinProfiles.generated.json"))
args = parser.parse_args()
source = args.workbook.resolve()
output = args.output

with ZipFile(source) as z:
    strings = ET.fromstring(z.read("xl/sharedStrings.xml"))
    shared = ["".join(x.itertext()) for x in strings.findall("m:si", NS)]
    sheet = ET.fromstring(z.read("xl/worksheets/sheet2.xml"))

rows = []
for row in sheet.findall(".//m:sheetData/m:row", NS):
    r = int(row.attrib["r"])
    if not 7 <= r <= 870:
        continue
    values = {}
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
        values[col(cell.attrib["r"])] = raw
    if not isinstance(values.get("V"), str):
        continue
    rows.append({
        "profile": values.get("V"), "family": values.get("H"),
        "sectionType": values.get("J"), "bracing": values.get("L"),
        "thickness_mm": values.get("M"), "height_mm": values.get("N"),
        "usageFactor": values.get("O"), "material": values.get("P"),
        "insulation_mm": values.get("U"),
        "capacity_X": values.get("X"),
        "jointFactor_Q": values.get("Q"),
        "jointFactor_S": values.get("S"),
        "massProfile_kg_m": values.get("Y"),
        "massSection_kg_m": values.get("Z"), "jointMass_kg": values.get("AA"),
    })

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({
    "source": "Калькулятор ограждайки v1.5.xlsx",
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest().upper(),
    "sheet": "Расчет Угловая", "rows": rows,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(rows)} profiles from {source} to {output}")

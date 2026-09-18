<#
.SYNOPSIS
  Прогоняет сценарий через «Калькулятор ограждайки» и возвращает подбор
  стеновых прогонов по угловой и рядовой зоне.

.DESCRIPTION
  Исходная книга НИКОГДА не открывается на запись: она копируется во
  временный каталог, входы проставляются в КОПИИ, копия пересчитывается
  (CalculateFullRebuild), результаты читаются, копия закрывается без
  сохранения и удаляется. SHA-256 оригинала снимается до и после и
  попадает в отчёт — если он изменился, результат считать недействительным.

  Входы задаются JSON-файлом вида { "B3": 0.8, "B6": 24, ... }, где ключ —
  адрес ячейки на «Лист1». Ячейка B17 (w0) задаётся числом напрямую, чтобы
  не зависеть от внешней книги «Таблица нагрузок по городам.xlsx».

.EXAMPLE
  powershell -File scripts/oracle/run_wall_purlin_calculator.ps1 `
    -WorkbookPath 'Y:\...\Калькулятор ограждайки v1.5.xlsx' `
    -InputPath scenario.json -OutputPath result.json
#>
param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$originalPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
$hashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $originalPath).Hash
$parsed = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
# Принимается как один сценарий-объект, так и массив сценариев: все они
# считаются в одной сессии Excel по одной и той же копии книги.
$scenarios = @()
if ($parsed -is [System.Array]) { $scenarios = $parsed } else { $scenarios = @($parsed) }

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("wall-purlin-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null
$copyPath = Join-Path $workDir ([System.IO.Path]::GetFileName($originalPath))
Copy-Item -LiteralPath $originalPath -Destination $copyPath

# PowerShell кэширует привязку COM-свойства по первому типу аргумента: после
# записи числа в Value2 запись строки в ТО ЖЕ свойство падает с «Specified
# cast is not valid». Поэтому значение пишется через явный InvokeMember.
function Set-CellValue($sheet, $address, $value) {
  $range = $sheet.Range($address)
  [void]$range.GetType().InvokeMember(
    'Value2',
    [System.Reflection.BindingFlags]::SetProperty,
    $null,
    $range,
    @($value)
  )
}

function Get-CellInfo($sheet, $address) {
  $cell = $sheet.Range($address)
  $formula = $null
  if ($cell.HasFormula) { $formula = $cell.Formula }
  return [ordered]@{ value = $cell.Value2; formula = $formula }
}

$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($copyPath, 0, $false)

  $sheet1 = $workbook.Worksheets.Item('Лист1')

  $billAddresses = @(
    'B3','B6','B7','B8','B11','B12','B13','B16','B17','B18','B19',
    'B22','B23','B24','B27','B28','B29','B32','B33','B34','B35','B36',
    'D17','E24','E29',
    'B49','C49','D49','E49','F49','G49','H49','I49','K49',
    'B50','C50','D50','E50','F50','G50','H50','I50','K50','E51'
  )

  $cases = @()
  foreach ($case in $scenarios) {
    $applied = [ordered]@{}
    foreach ($property in $case.PSObject.Properties) {
      if ($property.Name -eq 'id') { continue }
      # ConvertFrom-Json отдаёт числа как Decimal/Int32, а COM принимает только
      # double («Specified cast is not valid»), поэтому числа приводятся явно.
      $value = $property.Value
      if ($value -is [decimal] -or $value -is [int64] -or $value -is [int32] -or $value -is [single]) {
        $value = [double]$value
      }
      Set-CellValue $sheet1 $property.Name $value
      $applied[$property.Name] = $value
    }

    $excel.CalculateFullRebuild()

    $bill = [ordered]@{}
    foreach ($address in $billAddresses) { $bill[$address] = Get-CellInfo $sheet1 $address }

    $zones = [ordered]@{}
    foreach ($sheetName in @('Расчет Угловая', 'Расчет Рядовая')) {
      $zoneSheet = $workbook.Worksheets.Item($sheetName)
      $zones[$sheetName] = [ordered]@{
        C3 = Get-CellInfo $zoneSheet 'C3'
        D5 = Get-CellInfo $zoneSheet 'D5'
        B7 = Get-CellInfo $zoneSheet 'B7'
        C8 = Get-CellInfo $zoneSheet 'C8'
        BGQ7 = Get-CellInfo $zoneSheet 'BGQ7'
        BGS7 = Get-CellInfo $zoneSheet 'BGS7'
        BGT7 = Get-CellInfo $zoneSheet 'BGT7'
        BGU7 = Get-CellInfo $zoneSheet 'BGU7'
      }
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($zoneSheet)
    }

    $windSheet = $workbook.Worksheets.Item('Ветер по СП')
    $wind = [ordered]@{}
    foreach ($address in @('C4','C8','C9','C10','C11','C12','C13','F6','G6','F7','G7','J30','J31')) {
      $wind[$address] = Get-CellInfo $windSheet $address
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windSheet)

    $caseId = 'case'
    if ($case.PSObject.Properties.Name -contains 'id') { $caseId = $case.id }
    $cases += [ordered]@{ id = $caseId; inputs = $applied; sheet1 = $bill; zones = $zones; wind = $wind }
  }

  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet1)

  $result = [ordered]@{
    workbook = $originalPath
    excelVersion = $excel.Version
    calculation = 'CalculateFullRebuild'
    ranOnCopy = $true
    savedCopy = $false
    cases = $cases
  }
}
finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($workbook) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  if ($excel) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

$hashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $originalPath).Hash
$result.sourceSha256Before = $hashBefore
$result.sourceSha256After = $hashAfter
$result.sourceUnchanged = $hashBefore -eq $hashAfter
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host "Wrote $OutputPath (source unchanged: $($result.sourceUnchanged))"

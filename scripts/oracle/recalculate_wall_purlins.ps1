param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedWorkbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
$hashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedWorkbook).Hash
$excel = $null
$workbook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($resolvedWorkbook, 0, $true)
  $excel.CalculateFullRebuild()

  $sheet = $workbook.Worksheets.Item(1)
  $addresses = @(
    'B2', 'B3', 'B6', 'B7', 'B8', 'B11', 'B12', 'B13', 'B16', 'B17',
    'D17', 'B18', 'B19', 'B22', 'B23', 'B24', 'E24', 'B27', 'B28',
    'B29', 'E29', 'B49', 'C49', 'D49', 'E49', 'F49', 'G49', 'H49',
    'I49', 'K49', 'B50', 'C50', 'D50', 'E50', 'F50', 'G50', 'H50',
    'I50', 'K50', 'E51'
  )
  $cells = [ordered]@{}
  foreach ($address in $addresses) {
    $cell = $sheet.Range($address)
    $cells[$address] = [ordered]@{
      value = $cell.Value2
      formula = if ($cell.HasFormula) { $cell.Formula } else { $null }
    }
  }

  $result = [ordered]@{
    workbook = $resolvedWorkbook
    openedReadOnly = $workbook.ReadOnly
    excelVersion = $excel.Version
    calculationVersion = $workbook.CalculationVersion
    calculation = 'CalculateFullRebuild'
    saved = $false
    sha256Before = $hashBefore
    cells = $cells
  }
}
finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($sheet) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
  if ($workbook) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  if ($excel) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

$hashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedWorkbook).Hash
$result.sha256After = $hashAfter
$result.hashUnchanged = $hashBefore -eq $hashAfter
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8

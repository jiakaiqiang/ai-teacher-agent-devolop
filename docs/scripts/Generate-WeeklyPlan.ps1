[CmdletBinding()]
param(
    [string]$SourceRoot,
    [string]$DestinationRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
if (-not $SourceRoot) {
    $SourceRoot = Join-Path $workspaceRoot 'output/90天逐日任务'
}
if (-not $DestinationRoot) {
    $DestinationRoot = Join-Path $workspaceRoot '90天按周学习计划'
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Content
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, ($Content.TrimEnd() + "`n"), $utf8NoBom)
}

function Get-WeekDirectoryName {
    param([Parameter(Mandatory)] [int]$Week)

    $startDay = (($Week - 1) * 7) + 1
    $endDay = [Math]::Min($Week * 7, 90)
    return ('Week{0:D2}-Day{1:D2}-{2:D2}' -f $Week, $startDay, $endDay)
}

function Get-FirstSectionLine {
    param(
        [Parameter(Mandatory)] [string]$Content,
        [Parameter(Mandatory)] [string[]]$Headings
    )

    $alternatives = ($Headings | ForEach-Object { [regex]::Escape($_) }) -join '|'
    $pattern = "(?ms)^## (?:\d+\.\s*)?(?:$alternatives)\s*\n\s*(?<body>.*?)(?=^## |\z)"
    $match = [regex]::Match($Content, $pattern)
    if (-not $match.Success) {
        return '-'
    }

    $line = $match.Groups['body'].Value -split "`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('>') } |
        Select-Object -First 1

    if ($line) { return $line }
    return '-'
}

function Escape-MarkdownCell {
    param([Parameter(Mandatory)] [string]$Value)
    return (($Value -replace '\|', '\|') -replace "`r?`n", ' ')
}

$stageResults = @{
    1  = '实时指标合同、Vue 状态与 WebSocket 可靠性'
    2  = '异常闭环、Tool Registry、Agent Loop 与 SSE'
    3  = 'Agent UX、安全、Trace、第一节点考试与 NestJS 桥接'
    4  = 'API、数据、鉴权、测试、流式 BFF、PostgreSQL 与 Redis'
    5  = '队列、编排、Durable HITL、恢复与可观测性'
    6  = '后端生产质量、Node 门禁与 Python/FastAPI 桥接'
    7  = '模型网关、结构化输出、Prompt、RAG 与引用'
    8  = 'RAG/LLM Eval、多租户、Docker 与 CI/CD'
    9  = 'Trace、事故、求职、AI 全栈考试与 Agent Runtime 桥接'
    10 = '本地 CLI 流、Context、Capability、Validator、Memory 与 DAG'
    11 = 'MCP、Human Runtime、审批 UX 与恢复'
    12 = '生产 RAG、动态委派、并行 Handoff 与对抗验证'
    13 = 'Agent Eval、Replay、SLO、Chaos、求职与最终答辩'
}

$dayRecords = @()
foreach ($day in 1..90) {
    $fileName = 'Day{0:D2}.md' -f $day
    $sourcePath = Join-Path $SourceRoot $fileName
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Missing source task: $sourcePath"
    }

    $content = [System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
    $titleMatch = [regex]::Match($content, '(?m)^#\s+(?<title>.+)$')
    if (-not $titleMatch.Success) {
        throw "Missing H1 title: $sourcePath"
    }

    $rawTitle = $titleMatch.Groups['title'].Value.Trim()
    $topic = ($rawTitle -replace '^.*?Day\s*0?\d+\s*[-：:]\s*', '').Trim()
    $dateMatch = [regex]::Match($content, '(?m)^日期与(?:学习时间|时长)：(?<date>.+)$')
    $dateText = if ($dateMatch.Success) { $dateMatch.Groups['date'].Value.Trim() } else { '未标注' }
    $hoursMatch = [regex]::Match($dateText, '(?<hours>[36])h')
    $hours = if ($hoursMatch.Success) { [int]$hoursMatch.Groups['hours'].Value } elseif ($day -eq 1) { 3 } else { throw "Missing hours: $sourcePath" }
    if ($day -eq 1) {
        $goal = '建立 AI 前端系统边界、Agent 事件合同、Run 状态机与 Tool/Approval UI。'
        $task = '创建 Vue 3 工程，实现 AgentEvent、状态归约、时间线 UI、测试和架构证据。'
    } else {
        $goal = Get-FirstSectionLine -Content $content -Headings @('今日目标')
        $task = Get-FirstSectionLine -Content $content -Headings @('真实项目任务', '项目编码任务')
    }
    $week = [Math]::Floor(($day - 1) / 7) + 1
    $weekDirectoryName = Get-WeekDirectoryName -Week $week
    $weekDirectory = Join-Path $DestinationRoot $weekDirectoryName

    $content = $content.Replace('](../AI教师五连问验收协议.md)', '](../../output/AI教师五连问验收协议.md)')
    $parts = $content -split "`n", 2
    $sourceLink = '../../output/90天逐日任务/{0}' -f $fileName
    $banner = "> 生成说明：本文件由 [权威源任务]($sourceLink) 自动生成。请修改源文件后运行 ``scripts/Generate-WeeklyPlan.ps1``，不要只修改本副本。"
    $generatedContent = if ($parts.Count -eq 2) {
        $parts[0] + "`n`n" + $banner + "`n`n" + $parts[1].TrimStart("`n")
    } else {
        $content + "`n`n" + $banner
    }

    $destinationPath = Join-Path $weekDirectory $fileName
    Write-Utf8NoBom -Path $destinationPath -Content $generatedContent

    $dayRecords += [pscustomobject]@{
        Day = $day
        Week = $week
        FileName = $fileName
        WeekDirectoryName = $weekDirectoryName
        Date = $dateText
        Hours = $hours
        Topic = $topic
        Goal = $goal
        Task = $task
    }
}

$rootRows = @()
foreach ($week in 1..13) {
    $weekRecords = @($dayRecords | Where-Object Week -eq $week | Sort-Object Day)
    $weekDirectoryName = Get-WeekDirectoryName -Week $week
    $weekDirectory = Join-Path $DestinationRoot $weekDirectoryName
    $startDay = $weekRecords[0].Day
    $endDay = $weekRecords[-1].Day
    $weekHours = ($weekRecords | Measure-Object Hours -Sum).Sum

    $weekLines = @(
        "# Week $week：Day $startDay-$endDay",
        '',
        '> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。',
        '',
        '## 本周结果',
        '',
        $stageResults[$week],
        '',
        "总学习时间：$weekHours 小时。",
        '',
        '## 每日任务',
        '',
        '| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |',
        '|---:|---|---|---|---|---|'
    )

    foreach ($record in $weekRecords) {
        $weekLines += '| {0} | {1} | {2} | {3} | {4} | [打开](./{5}) |' -f @(
            $record.Day,
            (Escape-MarkdownCell $record.Date),
            (Escape-MarkdownCell $record.Topic),
            (Escape-MarkdownCell $record.Goal),
            (Escape-MarkdownCell $record.Task),
            $record.FileName
        )
    }

    $navigation = @('[总索引](../README.md)')
    if ($week -gt 1) {
        $previousDirectory = Get-WeekDirectoryName -Week ($week - 1)
        $navigation = @("[上一周](../$previousDirectory/README.md)") + $navigation
    }
    if ($week -lt 13) {
        $nextDirectory = Get-WeekDirectoryName -Week ($week + 1)
        $navigation += "[下一周](../$nextDirectory/README.md)"
    }

    $weekLines += @(
        '',
        '## 执行门禁',
        '',
        '- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。',
        '- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。',
        '- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。',
        '- 功能完成但原理、测试或独立排障不通过，当天仍不合格。',
        '',
        ($navigation -join ' | ')
    )

    Write-Utf8NoBom -Path (Join-Path $weekDirectory 'README.md') -Content ($weekLines -join "`n")
    $rootRows += '| Week {0} | Day {1}-{2} | {3}h | {4} | [进入](./{5}/README.md) |' -f @(
        $week,
        $startDay,
        $endDay,
        $weekHours,
        $stageResults[$week],
        $weekDirectoryName
    )
}

$totalHours = ($dayRecords | Measure-Object Hours -Sum).Sum
$rootLines = @(
    '# 90 天按周学习计划',
    '',
    '本目录按 13 周组织 Day 1-90 的完整学习计划和项目任务。内容从 `output/90天逐日任务` 自动生成，源目录是唯一权威版本。',
    '',
    "总天数：90 天。总学习时间：$totalHours 小时。工作日每天 3 小时，周末每天 6 小时。",
    '',
    '重新生成：',
    '',
    '```powershell',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Generate-WeeklyPlan.ps1',
    '```',
    '',
    '## 周导航',
    '',
    '| 周 | Day | 时长 | 阶段结果 | 目录 |',
    '|---:|---:|---:|---|---|'
) + $rootRows + @(
    '',
    '## 使用规则',
    '',
    '- 每个周目录的 `README.md` 给出本周结果和每日总览。',
    '- 每个 `DayNN.md` 是完整任务，包含知识、项目、时间盒、验收、真实项目情境题和 PDF 面试题。',
    '- 生成副本只用于按周执行；调整课程时先修改 `output/90天逐日任务`，再运行生成脚本。',
    '- 本地 PDF 不进入公开 Git 仓库，文件名不代表企业官方题库。'
)

Write-Utf8NoBom -Path (Join-Path $DestinationRoot 'README.md') -Content ($rootLines -join "`n")

$generatedDayCount = (Get-ChildItem -LiteralPath $DestinationRoot -Recurse -File -Filter 'Day*.md').Count
$generatedWeekCount = (Get-ChildItem -LiteralPath $DestinationRoot -Directory -Filter 'Week*').Count
if ($generatedDayCount -ne 90 -or $generatedWeekCount -ne 13) {
    throw "Generation validation failed: days=$generatedDayCount weeks=$generatedWeekCount"
}

Write-Host "Generated $generatedDayCount daily tasks in $generatedWeekCount weekly directories ($totalHours hours)."

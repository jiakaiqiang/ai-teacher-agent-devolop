# D97（周六）：Python批处理集成

第 14 周 · 300 分钟。回忆 30、推导 45、集成 115、反证 50、口述与复盘 60。前置阅读见[上一讲](D96-取消超时与并发限制.md)。

## 今天要做出什么

用同一工单的三份材料跑批处理，一份解析失败。用 pytest 断言两份有效结果仍与原输入对应。

## 今天的目录结构

- `python/bridge/ops_bridge/__main__.py`
- `python/bridge/ops_bridge/batch.py`
- `python/bridge/tests/test_batch.py`

## 零、闭卷回忆

**D96**　重试之前如何确认旧任务已停止？

<details><summary>核对</summary>

等待取消传播与清理，记录峰值并发、取消数及剩余任务数。

</details>

**D94**　静态标注能阻止 HTTP 请求传错类型吗？

<details><summary>核对</summary>

在输入边界做运行时校验，内部函数使用明确类型，保留具体错误字段。

</details>

**D90**　演示时间不足时应保留哪组证据？

<details><summary>核对</summary>

保留工单号、引用版本、用户动作及变更事件，流式链路用一条实际故障解释。

</details>

## 一、知识点与推导

保持每份材料的编号，结果分别携带成功值或错误；检查输入交换后仍可定位。

示例按语法树从当天通过的测试提取。保留完整文件中的导入和辅助函数，使用所列命令运行，不要只复制函数体。

### 1.1 组合已经验证的边界

build_report先调用parse_request，再将快照交给run_bounded，超时固定2秒。结果按输入顺序配对，zip(strict=True)防止数量不匹配悄悄丢项。报告保留工单身份、文本与count，读者可逐项核对。

**可运行示例：test_report_preserves_identity_and_normalizes_tags**

来源：`python/bridge/tests/test_batch.py`。

```python
def test_report_preserves_identity_and_normalizes_tags() -> None:
    result = asyncio.run(build_report({"tickets": [
        {"ticket_no": " B ", "tags": [" 网络 ", "网络"]},
        {"ticket_no": "A", "tags": []}], "concurrency": 2}))
    assert result.mode == "local_mock"
    assert result.count == 2
    assert [(item.ticket_no, item.text) for item in result.items] == [
        ("B", "B：1个标签"), ("A", "A：0个标签")]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_batch.py::test_report_preserves_identity_and_normalizes_tags
```

**推导题：结果数量少一条还可以普通zip吗？**

<details><summary>答案</summary>

普通zip会截断；strict让结构不一致显式失败。

</details>

### 1.2 CLI错误是外部契约

标准输入最多读取65537字符，超过65536拒绝；JSON错误、无效结构与过深递归返回固定invalid_request和退出码2。错误正文不回显输入。成功只在stdout输出JSON；错误走stderr。字符上限不等于HTTP字节上限。

**可运行示例：test_cli_stdin_round_trip**

来源：`python/bridge/tests/test_batch.py`。

```python
def test_cli_stdin_round_trip() -> None:
    result = invoke(json.dumps({"tickets": [{"ticket_no": "甲", "tags": ["修复"]}],
                                "concurrency": 1}))
    assert result.returncode == 0
    assert json.loads(result.stdout)["items"] == [{"ticket_no": "甲", "text": "甲：1个标签"}]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_batch.py::test_cli_stdin_round_trip
```

**推导题：为什么既检查stderr又检查退出码？**

<details><summary>答案</summary>

自动化调用需要机器可判定的失败状态；日志通道混入成功JSON会影响解析。

</details>

### 1.3 端到端与真实性标签

--demo使用内置两条夹具，真实启动Python子进程并解析stdout，验证CLI入口、编码、数据组合。local_mock只说明本地模拟，不代表模型效果、工单业务成功或生产可用。官方依据：[asyncio任务](https://docs.python.org/3.12/library/asyncio-task.html)。

**可运行示例：test_cli_demo_is_explicit_mock**

来源：`python/bridge/tests/test_batch.py`。

```python
def test_cli_demo_is_explicit_mock() -> None:
    result = invoke("", "--demo")
    assert result.returncode == 0
    assert result.stderr == ""
    value = json.loads(result.stdout)
    assert value == {"mode": "local_mock", "count": 2, "items": [
        {"ticket_no": "T001", "text": "T001：1个标签"},
        {"ticket_no": "T002", "text": "T002：0个标签"}]}
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_batch.py::test_cli_demo_is_explicit_mock
```

**推导题：子进程测试通过能声称已完成Python模型服务吗？**

<details><summary>答案</summary>

不能，只验证本地批处理链路。FastAPI和pymilvus留W15。

</details>

## 二、动手开发

### 步骤1：生成报告

<details><summary>提示1：方向</summary>

使用既有解析器和有界执行器，保持身份配对。

</details>
<details><summary>提示2：API与文档位置</summary>

dataclass、zip(strict=True)、asdict。

</details>
<details><summary>提示3：伪代码</summary>

parse→bounded→逐项构造ReportItem→BatchReport。

</details>

### 步骤2：提供CLI

<details><summary>提示1：方向</summary>

支持标准输入与明确的demo模式。

</details>
<details><summary>提示2：API与文档位置</summary>

argparse、json.loads、asyncio.run、sys.stderr。

</details>
<details><summary>提示3：伪代码</summary>

读取有界文本→解析→调用→成功JSON；错误返回固定码。

</details>

### 步骤3：测试子进程

<details><summary>提示1：方向</summary>

测试真实入口，不仅直接调用内部函数。

</details>
<details><summary>提示2：API与文档位置</summary>

subprocess.run、capture_output、encoding=utf8、timeout。

</details>
<details><summary>提示3：伪代码</summary>

传合法输入→核对完整JSON；传错误输入→检查退出2、stdout空、固定stderr。

</details>

三级提示仍无法完成再看第四节，并记一次需要复测。

```powershell
pnpm build
pnpm test
# apps/server 目录
pnpm lint --max-warnings 0
pnpm test:e2e
pnpm test:e2e
pnpm test:e2e
```

也可根目录运行 `pnpm run ci` 顺序执行以上门禁。只重置已授权的隔离测试库和Redis 1号库。shared通过dist导入，改完先build。

在 `python/bridge` 运行 `python -m pytest tests/test_batch.py -q`。

<details><summary>提示一 · 先找观察点</summary>

用同一工单的三份材料跑批处理，一份解析失败。用 pytest 断言两份有效结果仍与原输入对应。

</details>

<details><summary>提示二 · 切换一个条件</summary>

若失败材料排在第一位会怎样？

</details>

<details><summary>提示三 · 对照判定</summary>

保持每份材料的编号，结果分别携带成功值或错误；检查输入交换后仍可定位。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**python/bridge/ops_bridge/__main__.py**

```python
"""从标准输入读取有界JSON；--demo使用明确的本地夹具。"""
import argparse
import asyncio
import json
import sys
from dataclasses import asdict

from ops_bridge.batch import build_report


def main() -> int:
    parser = argparse.ArgumentParser(description="本地模拟工单标签批处理")
    parser.add_argument("--demo", action="store_true", help="使用内置两条工单夹具")
    args = parser.parse_args()
    try:
        if args.demo:
            value: object = {"tickets": [{"ticket_no": "T001", "tags": ["网络"]},
                                         {"ticket_no": "T002", "tags": []}], "concurrency": 2}
        else:
            raw = sys.stdin.read(65_537)
            if len(raw) > 65_536:
                raise ValueError("输入超过字符预算")
            value = json.loads(raw)
        report = asyncio.run(build_report(value))
    except (ValueError, RecursionError):
        print(json.dumps({"error": "invalid_request"}), file=sys.stderr)
        return 2
    except TimeoutError:
        print(json.dumps({"error": "batch_timeout"}), file=sys.stderr)
        return 3
    except Exception:
        print(json.dumps({"error": "batch_failed"}), file=sys.stderr)
        return 1
    print(json.dumps(asdict(report), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**python/bridge/ops_bridge/batch.py**

```python
"""本地批处理练习：只生成标签摘要，不调用模型或执行工单操作。"""
import asyncio
from dataclasses import dataclass
from typing import Literal

from ops_bridge.bounded import run_bounded
from ops_bridge.contracts import parse_request
from ops_bridge.models import TicketSnapshot


@dataclass(frozen=True, slots=True)
class ReportItem:
    ticket_no: str
    text: str


@dataclass(frozen=True, slots=True)
class BatchReport:
    mode: Literal["local_mock"]
    count: int
    items: tuple[ReportItem, ...]


async def mock_worker(ticket: TicketSnapshot) -> str:
    await asyncio.sleep(0)  # 让出循环，展示异步接口；不是模型推理耗时。
    return f"{ticket.ticket_no}：{len(ticket.tags)}个标签"


async def build_report(value: object) -> BatchReport:
    request = parse_request(value)
    texts = await run_bounded(request.tickets, mock_worker,
                              concurrency=request.concurrency, timeout=2)
    items = tuple(ReportItem(ticket.ticket_no, text)
                  for ticket, text in zip(request.tickets, texts, strict=True))
    return BatchReport("local_mock", len(items), items)
```

**python/bridge/tests/test_batch.py**

```python
import asyncio
import json
import os
import subprocess
import sys

import pytest

from ops_bridge.batch import build_report


def test_report_preserves_identity_and_normalizes_tags() -> None:
    result = asyncio.run(build_report({"tickets": [
        {"ticket_no": " B ", "tags": [" 网络 ", "网络"]},
        {"ticket_no": "A", "tags": []}], "concurrency": 2}))
    assert result.mode == "local_mock"
    assert result.count == 2
    assert [(item.ticket_no, item.text) for item in result.items] == [
        ("B", "B：1个标签"), ("A", "A：0个标签")]


def test_report_rejects_invalid_before_execution() -> None:
    with pytest.raises(ValueError):
        asyncio.run(build_report({"tickets": [], "concurrency": True}))


def invoke(raw: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", "ops_bridge", *args], input=raw,
                          capture_output=True, encoding="utf8", timeout=5,
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def test_cli_demo_is_explicit_mock() -> None:
    result = invoke("", "--demo")
    assert result.returncode == 0
    assert result.stderr == ""
    value = json.loads(result.stdout)
    assert value == {"mode": "local_mock", "count": 2, "items": [
        {"ticket_no": "T001", "text": "T001：1个标签"},
        {"ticket_no": "T002", "text": "T002：0个标签"}]}


def test_cli_stdin_round_trip() -> None:
    result = invoke(json.dumps({"tickets": [{"ticket_no": "甲", "tags": ["修复"]}],
                                "concurrency": 1}))
    assert result.returncode == 0
    assert json.loads(result.stdout)["items"] == [{"ticket_no": "甲", "text": "甲：1个标签"}]


@pytest.mark.parametrize("raw", ['{"private-example":', '[]', 'x' * 65_537,
                                '[' * 2000 + ']' * 2000],
                         ids=["invalid-json", "invalid-shape", "oversize", "too-deep"])
def test_cli_invalid_input_has_safe_error(raw: str) -> None:
    result = invoke(raw)
    assert result.returncode == 2
    assert result.stdout == ""
    assert json.loads(result.stderr) == {"error": "invalid_request"}
```

## 五、核心面试题

若失败材料排在第一位会怎样？

保持每份材料的编号，结果分别携带成功值或错误；检查输入交换后仍可定位。 [本日配套面试题](D97-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。

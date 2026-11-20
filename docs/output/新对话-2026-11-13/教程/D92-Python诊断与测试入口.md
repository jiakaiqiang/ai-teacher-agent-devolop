# D92（周一）：Python诊断与测试入口

第 14 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D91-第十三周复盘.md)。

## 今天要做出什么

从空虚拟环境运行诊断入口，让它处理一条合成超时日志和一条缺字段输入。

## 今天的目录结构

- `python/bridge/.gitignore`
- `python/bridge/ops_bridge/__init__.py`
- `python/bridge/ops_bridge/diagnostics.py`
- `python/bridge/pyproject.toml`
- `python/bridge/requirements-dev.txt`
- `python/bridge/requirements-lock.txt`
- `python/bridge/tests/test_diagnostics.py`

## 零、闭卷回忆

**D91**　尚未投递如何填写岗位记录？

<details><summary>核对</summary>

保留真实状态与日期，把练习结果、个人贡献和待补材料分开写。

</details>

**D89**　12 个合成场景通过，能说明生产用户解决率吗？

<details><summary>核对</summary>

可陈述本机验证覆盖的路径和样本规模。业务效果需要真实用户结果。

</details>

**D85**　浏览器看到最后一帧就能证明逐帧到达吗？

<details><summary>核对</summary>

同时记录直连和代理路径每帧到达时间，比较首帧及间隔。

</details>

## 一、知识点与推导

先固定解释器和测试入口，将解析错误与业务判定分开断言。

示例按语法树从当天通过的测试提取。保留完整文件中的导入和辅助函数，使用所列命令运行，不要只复制函数体。

### 1.1 字符串与语法边界

Python的f-string用`f"{value}"`插值，美元符号会作为普通文字保留。缩进表达语句块，项目约定4空格；语法并非只接受4空格。分号可分隔简单语句，但Ruff E702不允许同一行多条语句。列表推导产生新列表，筛选无需改动输入。

**可运行示例：test_fstring_has_no_dollar**

来源：`python/bridge/tests/test_diagnostics.py`。

```python
def test_fstring_has_no_dollar() -> None:
    assert format_ticket("T001", 2) == "T001：尝试2次"
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_diagnostics.py::test_fstring_has_no_dollar
```

**推导题：把JS的`${value}`搬进f-string会发生什么？**

<details><summary>答案</summary>

会得到额外的美元符号；输出断言能揭示它。

</details>

### 1.2 调用协程不等于执行

调用async def只生成协程对象，必须await、提交Task或交给asyncio.run驱动。入口用asyncio.run一次管理事件循环；不能在已有循环中嵌套run。测试由同步pytest用例调用run，不安装额外异步插件。

**可运行示例：test_coroutine_does_not_start_on_call**

来源：`python/bridge/tests/test_diagnostics.py`。

```python
def test_coroutine_does_not_start_on_call() -> None:
    calls: list[str] = []

    async def job() -> str:
        calls.append("started")
        return "ok"

    coroutine = job()
    assert calls == []
    assert asyncio.run(coroutine) == "ok"
    assert calls == ["started"]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_diagnostics.py::test_coroutine_does_not_start_on_call
```

**推导题：创建协程后不await可以保证副作用执行吗？**

<details><summary>答案</summary>

不能，且可能出现未等待协程警告。测试显式消费协程对象，避免悬空。

</details>

### 1.3 并发完成顺序与返回顺序

gather把协程调度为任务，返回结果按输入位置排列。用Event强制B先完成，仍应得到[A,B]。这比睡眠时长猜顺序稳定。异常与取消在D95/D96展开。依据：[Python3.12任务文档](https://docs.python.org/3.12/library/asyncio-task.html)。

**可运行示例：test_gather_returns_input_order**

来源：`python/bridge/tests/test_diagnostics.py`。

```python
def test_gather_returns_input_order() -> None:
    async def scenario() -> None:
        second_done = asyncio.Event()
        finished: list[str] = []

        async def first() -> str:
            await second_done.wait()
            finished.append("A")
            return "A"

        async def second() -> str:
            finished.append("B")
            second_done.set()
            return "B"

        result = await gather_in_order([first(), second()])
        assert finished == ["B", "A"]
        assert result == ["A", "B"]

    asyncio.run(scenario())
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_diagnostics.py::test_gather_returns_input_order
```

**推导题：为何不能用as_completed的收集顺序替换gather？**

<details><summary>答案</summary>

as_completed提供完成顺序；替换后会破坏输入与输出对应关系。

</details>

## 二、动手开发

### 步骤1：建立隔离入口

<details><summary>提示1：方向</summary>

在验证工程的python/bridge建立虚拟环境；配置只覆盖本项目。

</details>
<details><summary>提示2：API与文档位置</summary>

[pytest运行入口](https://docs.pytest.org/en/stable/how-to/usage.html)；依赖固定在requirements文件。

</details>
<details><summary>提示3：伪代码</summary>

建立目录→安装锁定依赖→配置testpaths与strict mypy。

</details>

### 步骤2：写诊断函数

<details><summary>提示1：方向</summary>

先写预期输出，再实现字符串、筛选与gather。

</details>
<details><summary>提示2：API与文档位置</summary>

f-string、列表推导、asyncio.gather；不导入JS工具链。

</details>
<details><summary>提示3：伪代码</summary>

返回格式化文本；筛选pending；await gather后返回列表。

</details>

### 步骤3：区分语法与调度

<details><summary>提示1：方向</summary>

用compile检查语法，用Event检查任务次序。

</details>
<details><summary>提示2：API与文档位置</summary>

pytest.raises、asyncio.Event、asyncio.run。

</details>
<details><summary>提示3：伪代码</summary>

先断言协程尚未启动→驱动→断言输出；B发信号后A才完成。

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

在 `python/bridge` 运行 `python -m pytest tests/test_diagnostics.py -q`。

<details><summary>提示一 · 先找观察点</summary>

从空虚拟环境运行诊断入口，让它处理一条合成超时日志和一条缺字段输入。

</details>

<details><summary>提示二 · 切换一个条件</summary>

异常应在哪一层变成学员能核对的结果？

</details>

<details><summary>提示三 · 对照判定</summary>

先固定解释器和测试入口，将解析错误与业务判定分开断言。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**python/bridge/.gitignore**

```text
.venv/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
```

**python/bridge/ops_bridge/__init__.py**

```python
"""运维工单课程的独立Python练习。"""
```

**python/bridge/ops_bridge/diagnostics.py**

```python
"""D92：用少量业务输入暴露从JS迁移时容易混淆的语义。"""

import asyncio
from collections.abc import Awaitable


def format_ticket(ticket_no: str, attempts: int) -> str:
    return f"{ticket_no}：尝试{attempts}次"


def pending_titles(rows: list[dict[str, str]]) -> list[str]:
    # 生成新列表，保留原始输入顺序。
    return [row["title"] for row in rows if row["status"] == "pending"]


async def gather_in_order(jobs: list[Awaitable[str]]) -> list[str]:
    # gather按传入位置组织结果；D95再讨论异常时兄弟任务的生命周期。
    return list(await asyncio.gather(*jobs))
```

**python/bridge/pyproject.toml**

```text
[project]
name = "ops-python-bridge"
version = "0.1.0"
requires-python = ">=3.12,<3.13"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-ra --strict-markers"
filterwarnings = ["error"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I"]

[tool.mypy]
python_version = "3.12"
strict = true
files = ["ops_bridge"]
```

**python/bridge/requirements-dev.txt**

```text
pytest==9.0.3
mypy==1.20.2
ruff==0.15.11
```

**python/bridge/requirements-lock.txt**

```text
colorama==0.4.6
iniconfig==2.3.1
librt==0.16.0
mypy==1.20.2
mypy_extensions==1.2.0
packaging==26.3
pathspec==1.1.1
pluggy==1.7.0
Pygments==2.21.0
pytest==9.0.3
ruff==0.15.11
typing_extensions==4.16.0
```

**python/bridge/tests/test_diagnostics.py**

```python
import asyncio

import pytest

from ops_bridge.diagnostics import format_ticket, gather_in_order, pending_titles


def test_fstring_has_no_dollar() -> None:
    assert format_ticket("T001", 2) == "T001：尝试2次"


def test_pending_filter_does_not_mutate() -> None:
    rows = [
        {"title": "甲", "status": "pending"},
        {"title": "乙", "status": "closed"},
        {"title": "丙", "status": "pending"},
    ]
    assert pending_titles(rows) == ["甲", "丙"]
    assert len(rows) == 3


def test_gather_returns_input_order() -> None:
    async def scenario() -> None:
        second_done = asyncio.Event()
        finished: list[str] = []

        async def first() -> str:
            await second_done.wait()
            finished.append("A")
            return "A"

        async def second() -> str:
            finished.append("B")
            second_done.set()
            return "B"

        result = await gather_in_order([first(), second()])
        assert finished == ["B", "A"]
        assert result == ["A", "B"]

    asyncio.run(scenario())


def test_coroutine_does_not_start_on_call() -> None:
    calls: list[str] = []

    async def job() -> str:
        calls.append("started")
        return "ok"

    coroutine = job()
    assert calls == []
    assert asyncio.run(coroutine) == "ok"
    assert calls == ["started"]


def test_unexpected_indentation_is_rejected() -> None:
    with pytest.raises(IndentationError):
        compile(" value = 1\n", "<诊断片段>", "exec")


def test_semicolon_is_legal_syntax() -> None:
    # 分号不是语法错误；项目风格由Ruff的E702单独检查。
    compile("left = 1; right = 2\n", "<诊断片段>", "exec")
```

## 五、核心面试题

异常应在哪一层变成学员能核对的结果？

先固定解释器和测试入口，将解析错误与业务判定分开断言。 [本日配套面试题](D92-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。

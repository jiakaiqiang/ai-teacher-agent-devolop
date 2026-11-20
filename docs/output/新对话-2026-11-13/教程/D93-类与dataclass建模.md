# D93（周二）：类与dataclass建模

第 14 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D92-Python诊断与测试入口.md)。

## 今天要做出什么

分别用普通类和 dataclass 表达同一份工单材料，构造两张单后只向第一张追加日志。

## 今天的目录结构

- `python/bridge/ops_bridge/models.py`
- `python/bridge/tests/test_models.py`

## 零、闭卷回忆

**D92**　异常应在哪一层变成学员能核对的结果？

<details><summary>核对</summary>

先固定解释器和测试入口，将解析错误与业务判定分开断言。

</details>

**D90**　演示时间不足时应保留哪组证据？

<details><summary>核对</summary>

保留工单号、引用版本、用户动作及变更事件，流式链路用一条实际故障解释。

</details>

**D86**　首字之前取消的请求应怎样记？

<details><summary>核对</summary>

记入取消样本并将首字时间记为缺失，不能用零替代。

</details>

## 一、知识点与推导

可变默认值要在每个实例创建时分配；比较构造、相等判断及序列化结果。

示例按语法树从当天通过的测试提取。保留完整文件中的导入和辅助函数，使用所列命令运行，不要只复制函数体。

### 1.1 dataclass仍然是普通类

装饰器生成__init__、__repr__和按字段比较的__eq__等方法，实例方法照常写self。tags用default_factory=list为每个新实例建立列表；它不是在类定义时只创建一次的共享值。

**可运行示例：test_drafts_do_not_share_tags**

来源：`python/bridge/tests/test_models.py`。

```python
def test_drafts_do_not_share_tags() -> None:
    first, second = TicketDraft("A"), TicketDraft("B")
    first.add_tag(" 网络 ")
    assert first.tags == ["网络"]
    assert second.tags == []
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_models.py::test_drafts_do_not_share_tags
```

**推导题：两个草稿的标签为何要独立？**

<details><summary>答案</summary>

给甲工单加标签不应修改乙工单；测试同时观察两者。

</details>

### 1.2 快照切断可变引用

草稿允许添加标签，快照复制为tuple。字符串和tuple[str,...]构成这个模型的不可变值；后续草稿变化不会影响快照。frozen用于拒绝常规字段重新赋值。

**可运行示例：test_snapshot_is_detached**

来源：`python/bridge/tests/test_models.py`。

```python
def test_snapshot_is_detached() -> None:
    draft = TicketDraft("A")
    draft.add_tag("网络")
    saved = draft.snapshot()
    draft.add_tag("升级")
    assert saved == TicketSnapshot("A", ("网络",))
    assert draft.tags == ["网络", "升级"]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_models.py::test_snapshot_is_detached
```

**推导题：只把草稿对象赋值给另一个变量算快照吗？**

<details><summary>答案</summary>

不算，仍引用同一个对象；必须设计需要复制的边界。

</details>

### 1.3 冻结与输入校验分开

frozen只阻止常规字段赋值，不递归冻结字段引用的容器。本章对比一个带list的冻结类：append仍成功。类型注解也不会运行时自动验证输入；本章构造器面向已知类型，外部JSON在D94处理。依据：[dataclasses官方文档](https://docs.python.org/3.12/library/dataclasses.html)。

**可运行示例：test_frozen_alone_is_shallow**

来源：`python/bridge/tests/test_models.py`。

```python
def test_frozen_alone_is_shallow() -> None:
    @dataclass(frozen=True)
    class Shallow:
        tags: list[str]

    value = Shallow([])
    value.tags.append("仍可变")
    assert value.tags == ["仍可变"]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_models.py::test_frozen_alone_is_shallow
```

**推导题：frozen=True能保证任意对象深度不可变吗？**

<details><summary>答案</summary>

不能。需选择不可变字段或显式复制；object.__setattr__等低层绕过也不属于安全边界。

</details>

## 二、动手开发

### 步骤1：写草稿

<details><summary>提示1：方向</summary>

建立工单号与标签，字段初值按实例生成。

</details>
<details><summary>提示2：API与文档位置</summary>

dataclass、field(default_factory=list)、__post_init__。

</details>
<details><summary>提示3：伪代码</summary>

检查工单号非空；新增标签先strip再查重。

</details>

### 步骤2：写提交快照

<details><summary>提示1：方向</summary>

只保存提交时需要的值，避免后续编辑回写快照。

</details>
<details><summary>提示2：API与文档位置</summary>

frozen=True、slots=True、tuple。

</details>
<details><summary>提示3：伪代码</summary>

从当前标签创建tuple，再构造快照。

</details>

### 步骤3：验证隔离与浅冻结

<details><summary>提示1：方向</summary>

分别观察两个草稿、草稿与快照、冻结类内部列表。

</details>
<details><summary>提示2：API与文档位置</summary>

pytest.raises(FrozenInstanceError)；比较dataclass值。

</details>
<details><summary>提示3：伪代码</summary>

修改甲不改乙；修改草稿不改快照；冻结list仍可append。

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

在 `python/bridge` 运行 `python -m pytest tests/test_models.py -q`。

<details><summary>提示一 · 先找观察点</summary>

分别用普通类和 dataclass 表达同一份工单材料，构造两张单后只向第一张追加日志。

</details>

<details><summary>提示二 · 切换一个条件</summary>

为什么第二张单的日志列表也可能变化？

</details>

<details><summary>提示三 · 对照判定</summary>

可变默认值要在每个实例创建时分配；比较构造、相等判断及序列化结果。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**python/bridge/ops_bridge/models.py**

```python
"""草稿可编辑，提交快照只持有不可变字段。"""
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class TicketSnapshot:
    ticket_no: str
    tags: tuple[str, ...]


@dataclass(slots=True)
class TicketDraft:
    ticket_no: str
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.ticket_no.strip():
            raise ValueError("工单号不能为空")

    def add_tag(self, tag: str) -> None:
        cleaned = tag.strip()
        if not cleaned:
            raise ValueError("标签不能为空")
        if cleaned not in self.tags:
            self.tags.append(cleaned)

    def snapshot(self) -> TicketSnapshot:
        # 复制成tuple，后续草稿修改不影响已有快照。
        return TicketSnapshot(self.ticket_no, tuple(self.tags))
```

**python/bridge/tests/test_models.py**

```python
from dataclasses import FrozenInstanceError, dataclass

import pytest

from ops_bridge.models import TicketDraft, TicketSnapshot


def test_drafts_do_not_share_tags() -> None:
    first, second = TicketDraft("A"), TicketDraft("B")
    first.add_tag(" 网络 ")
    assert first.tags == ["网络"]
    assert second.tags == []


def test_tags_are_normalized_and_deduplicated() -> None:
    draft = TicketDraft("A")
    draft.add_tag(" 网络 ")
    draft.add_tag("网络")
    assert draft.tags == ["网络"]
    with pytest.raises(ValueError, match="标签"):
        draft.add_tag("  ")


def test_snapshot_is_detached() -> None:
    draft = TicketDraft("A")
    draft.add_tag("网络")
    saved = draft.snapshot()
    draft.add_tag("升级")
    assert saved == TicketSnapshot("A", ("网络",))
    assert draft.tags == ["网络", "升级"]


def test_frozen_blocks_field_reassignment() -> None:
    saved = TicketDraft("A").snapshot()
    with pytest.raises(FrozenInstanceError):
        setattr(saved, "ticket_no", "B")


def test_frozen_alone_is_shallow() -> None:
    @dataclass(frozen=True)
    class Shallow:
        tags: list[str]

    value = Shallow([])
    value.tags.append("仍可变")
    assert value.tags == ["仍可变"]


def test_blank_ticket_rejected() -> None:
    with pytest.raises(ValueError, match="工单号"):
        TicketDraft("  ")
```

## 五、核心面试题

为什么第二张单的日志列表也可能变化？

可变默认值要在每个实例创建时分配；比较构造、相等判断及序列化结果。 [本日配套面试题](D93-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。

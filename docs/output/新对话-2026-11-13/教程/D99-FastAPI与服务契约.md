# D99（周一）：FastAPI与服务契约

第 15 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D98-第十四周复盘.md)。

## 今天要做出什么

将已有资料检索请求编码成 JSON，分别向 FastAPI 发送合法请求和缺范围的请求。

## 今天的目录结构

- `python/bridge/ops_bridge/http_app.py`
- `python/bridge/ops_bridge/http_contracts.py`
- `python/bridge/requirements-dev.txt`
- `python/bridge/requirements-lock.txt`
- `python/bridge/requirements-runtime.txt`
- `python/bridge/tests/test_http_contracts.py`

## 零、闭卷回忆

**D98**　怎样用一个小用例复现自己的薄弱项？

<details><summary>核对</summary>

记录触发输入和失败断言，隔天从空文件重做。

</details>

**D96**　重试之前如何确认旧任务已停止？

<details><summary>核对</summary>

等待取消传播与清理，记录峰值并发、取消数及剩余任务数。

</details>

**D92**　异常应在哪一层变成学员能核对的结果？

<details><summary>核对</summary>

先固定解释器和测试入口，将解析错误与业务判定分开断言。

</details>

## 一、知识点与推导

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。

示例按语法树从当天通过的测试提取。保留完整文件中的导入和辅助函数，使用所列命令运行，不要只复制函数体。

### 1.1 Pydantic严格模型就是服务契约

`StrictModel`设置`strict=True, extra="forbid"`：严格模式不做类型转换（`True`不会当成字符串，`"1"`不会变成整数），多出的字段直接报错。`Annotated[str, Field(min_length=1, max_length=2048)]`把单条文本上限写进类型，列表限制1—16条；`field_validator`再拒绝全空白。响应`EmbedPlan`用`Literal`把`space`、`dimension`钉死为Node端`apps/server/src/retrieval/encoding.ts`里的同一组常量，NestJS以后能按值校验对方是不是同一个向量空间。常量标`Final`，mypy才会把它推成字面量类型。对照你熟悉的Nest：这相当于DTO加`whitelist + forbidNonWhitelisted`，但校验发生在类型层，不用另写装饰器。官方：[Pydantic严格模式](https://docs.pydantic.dev/latest/concepts/strict_mode/)。

**可运行示例：test_text_budget_and_type**

来源：`python/bridge/tests/test_http_contracts.py`。

```python
def test_text_budget_and_type(texts: object) -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": texts})
        assert result.status_code == 422
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_http_contracts.py::test_text_budget_and_type
```

**推导题：把`extra="forbid"`去掉（默认ignore），请求里多带`admin: true`会发生什么？**

<details><summary>答案</summary>

默认忽略未知字段，请求照样200。调用方拼错字段名不会被发现，越权字段也会被悄悄吞掉。反证B正是这个场景。

</details>

### 1.2 校验失败的响应也是契约

FastAPI默认的422响应体会列出每个错误的位置、消息和`input`。本章核对：`texts`非法时默认响应里带着原文；未知字段时带着字段名。工单文本可能含内部信息，所以用`@app.exception_handler(RequestValidationError)`统一改成`{"error":{"code":"BRIDGE_INPUT"}}`。诊断靠测试和日志，不靠把用户输入回给调用方。注意范围：这个处理器只管**请求**校验；返回值不符合`response_model`时是服务端错误（500），不会走它。

**可运行示例：test_unknown_fields_fail_without_echoing_input**

来源：`python/bridge/tests/test_http_contracts.py`。

```python
def test_unknown_fields_fail_without_echoing_input() -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": ["private-fixture"], "admin": True})
        assert result.status_code == 422
        assert result.json() == {"error": {"code": "BRIDGE_INPUT"}}
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_http_contracts.py::test_unknown_fields_fail_without_echoing_input
```

**推导题：为什么错误码是固定字符串，而不是把Pydantic的错误信息翻译成中文返回？**

<details><summary>答案</summary>

调用方是NestJS程序，它要按码分支；消息文本会随库版本变化，还可能带输入。固定码稳定，也不泄露内容。

</details>

### 1.3 依赖注入做服务鉴权

`authenticate`是一个依赖，挂在路由的`dependencies=[Depends(authenticate)]`上：先于请求体处理执行，失败抛`HTTPException(401)`。比较用`hmac.compare_digest`，避免逐字节短路比较带来的时间差。令牌是**服务之间**的身份，和用户JWT分开：Python服务不判断用户能看哪张工单，权限仍由NestJS在权威库里复核（W11约定）。`create_app`启动时检查令牌至少32个ASCII字符，缺失就拒绝启动，不会出现“忘配令牌所以谁都能调”的状态。`/healthz`不鉴权，只回`ok`，不暴露版本和配置。官方：[依赖](https://fastapi.tiangolo.com/tutorial/dependencies/)、[hmac.compare_digest](https://docs.python.org/3.12/library/hmac.html#hmac.compare_digest)。

**可运行示例：test_service_requires_its_own_token**

来源：`python/bridge/tests/test_http_contracts.py`。

```python
def test_service_requires_its_own_token() -> None:
    with TestClient(create_app(TOKEN)) as client:
        for headers in [{}, {"Authorization": "Bearer incorrect"}]:
            result = client.post("/v1/embedding/validate", headers=headers,
                                 json={"role": "query", "texts": ["网络故障"]})
            assert result.status_code == 401
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_http_contracts.py::test_service_requires_its_own_token
```

**推导题：令牌比较为什么先`.encode()`再比？**

<details><summary>答案</summary>

`compare_digest`对str只接受ASCII，非ASCII会抛TypeError变成500；先编码成bytes，任何请求头都能安全比较并得到401。

</details>

### 1.4 应用工厂与真实进程

`create_app(token)`让测试直接传夹具令牌，`from_environment()`给Uvicorn用：`uvicorn ops_bridge.http_app:from_environment --factory`每次启动调用工厂读取环境变量。`docs_url=None, redoc_url=None`关闭交互文档页。`TestClient`在进程内调ASGI应用，不走网络；所以另加一个测试真的启动Uvicorn子进程，在随机回环端口上用HTTP调用健康检查、合法请求和无令牌请求，结束时terminate并等待退出。依赖变更：Starlette1.10的TestClient对`httpx`发出弃用警告，要求`httpx2`；本项目把警告当错误，所以运行依赖改为`httpx2==2.16.2`（Pydantic团队维护的后继包），D100的异步客户端也用它。官方：[Uvicorn设置](https://www.uvicorn.org/settings/)。

**可运行示例：test_real_uvicorn_loopback_process**

来源：`python/bridge/tests/test_http_contracts.py`。

```python
def test_real_uvicorn_loopback_process() -> None:
    import os
    import socket
    import subprocess
    import sys
    import time

    import httpx2

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "ops_bridge.http_app:from_environment", "--factory",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        env={**os.environ, "OPS_BRIDGE_TOKEN": TOKEN}, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE)
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 10
        while True:
            try:
                assert httpx2.get(base + "/healthz", timeout=1).json() == {"status": "ok"}
                break
            except httpx2.TransportError:
                assert server.poll() is None and time.monotonic() < deadline
                time.sleep(0.1)
        result = httpx2.post(base + "/v1/embedding/validate", headers=HEADERS, timeout=2,
                             json={"role": "passage", "texts": ["甲", "乙"]})
        assert result.status_code == 200 and result.json()["count"] == 2
        assert httpx2.post(base + "/v1/embedding/validate", timeout=2,
                           json={"role": "passage", "texts": ["甲"]}).status_code == 401
    finally:
        server.terminate()
        server.communicate(timeout=10)
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_http_contracts.py::test_real_uvicorn_loopback_process
```

**推导题：只有TestClient测试通过，能说“服务能启动”吗？**

<details><summary>答案</summary>

不能。TestClient不经过Uvicorn的进程启动、环境变量读取和端口监听；工厂参数写错、导入路径写错都只在真实进程里暴露。

</details>

## 二、动手开发

### 步骤1：定义请求与响应模型

<details><summary>提示1：方向</summary>

先写类型和限制，再写路由；响应字段与Node端常量一致。

</details>
<details><summary>提示2：API与文档位置</summary>

pydantic的BaseModel、ConfigDict、Field、field_validator；typing的Annotated、Literal、Final。

</details>
<details><summary>提示3：伪代码</summary>

StrictModel(strict, forbid)
EmbedRequest: role∈{query,passage}; texts: 1..16条, 每条1..2048, 非空白
EmbedPlan: schema_version=1, space=常量, dimension=1024, count

</details>

### 步骤2：写应用工厂和鉴权依赖

<details><summary>提示1：方向</summary>

工厂接收令牌参数；启动校验；业务路由挂依赖；422统一处理。

</details>
<details><summary>提示2：API与文档位置</summary>

FastAPI(docs_url=None)、Header、Depends、HTTPException、exception_handler(RequestValidationError)、hmac.compare_digest。

</details>
<details><summary>提示3：伪代码</summary>

def create_app(token):
    令牌<32或非ASCII -> ValueError
    async def authenticate(authorization头): 不等于"Bearer "+token -> 401
    422处理器 -> 固定码
    GET /healthz; POST /v1/embedding/validate -> EmbedPlan(count)
def from_environment(): create_app(os.environ.get(...))

</details>

### 步骤3：测试进程内与真实进程

<details><summary>提示1：方向</summary>

先TestClient覆盖契约与错误，再起一个Uvicorn子进程验证真实启动。

</details>
<details><summary>提示2：API与文档位置</summary>

fastapi.testclient.TestClient、pytest.mark.parametrize(ids=...)、subprocess.Popen、socket绑定端口0取空闲端口、httpx2。

</details>
<details><summary>提示3：伪代码</summary>

取空闲端口 -> Popen(uvicorn --factory, env含令牌)
循环GET /healthz直到就绪或10秒超时
断言合法200、无令牌401
finally: terminate + communicate(timeout)

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

在 `python/bridge` 运行 `python -m pytest tests/test_http_contracts.py -q`。

<details><summary>提示一 · 先找观察点</summary>

将已有资料检索请求编码成 JSON，分别向 FastAPI 发送合法请求和缺范围的请求。

</details>

<details><summary>提示二 · 切换一个条件</summary>

Node 与 Python 对空数组和缺字段的解释一致吗？

</details>

<details><summary>提示三 · 对照判定</summary>

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**python/bridge/ops_bridge/http_app.py**

```python
"""只供回环访问的服务入口；业务路由要求独立服务令牌。"""
import os
from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ops_bridge.http_contracts import EmbedPlan, EmbedRequest


def create_app(token: str) -> FastAPI:
    if len(token) < 32 or not token.isascii():
        raise ValueError("OPS_BRIDGE_TOKEN必须为至少32字符的ASCII随机令牌")
    app = FastAPI(title="本机检索桥接", version="1.0.0", docs_url=None, redoc_url=None)

    async def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
        if not compare_digest((authorization or "").encode(), ("Bearer " + token).encode()):
            raise HTTPException(status_code=401, detail="BRIDGE_UNAUTHORIZED")

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, error: RequestValidationError) -> JSONResponse:
        # 不回显错误输入或请求头；诊断信息由独立测试保留。
        return JSONResponse(status_code=422, content={"error": {"code": "BRIDGE_INPUT"}})

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/embedding/validate", response_model=EmbedPlan,
              dependencies=[Depends(authenticate)])
    async def validate(body: EmbedRequest) -> EmbedPlan:
        # 只确认契约，不生成假向量；真实编码在下一章接入。
        return EmbedPlan(count=len(body.texts))

    return app


def from_environment() -> FastAPI:
    return create_app(os.environ.get("OPS_BRIDGE_TOKEN", ""))
```

**python/bridge/ops_bridge/http_contracts.py**

```python
"""桥接协议v1；向量空间沿用Node端既有常量。"""
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL: Final = "ops-teacher-qwen3-embedding:q8"
SPACE: Final = "qwen3_06b_q8_06507c7b_chunks_v1"
DIMENSION: Final = 1024
Text = Annotated[str, Field(min_length=1, max_length=2048)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class EmbedRequest(StrictModel):
    role: Literal["query", "passage"]
    texts: Annotated[list[Text], Field(min_length=1, max_length=16)]

    @field_validator("texts")
    @classmethod
    def nonblank(cls, texts: list[str]) -> list[str]:
        if any(not text.strip() for text in texts):
            raise ValueError("文本不能为空白")
        return texts


class EmbedPlan(StrictModel):
    schema_version: Literal[1] = 1
    space: Literal["qwen3_06b_q8_06507c7b_chunks_v1"] = SPACE
    dimension: Literal[1024] = DIMENSION
    count: int
```

**python/bridge/requirements-dev.txt**

```text
pytest==9.0.3
-r requirements-runtime.txt
mypy==1.20.2
ruff==0.15.11
```

**python/bridge/requirements-lock.txt**

```text
annotated-doc==0.0.6
annotated-types==0.8.0
anyio==4.16.0
certifi==2026.10.23
click==8.5.1
colorama==0.4.6
fastapi==0.163.2
h11==0.16.0
httpcore2==2.16.2
httpx2==2.16.2
idna==3.20
iniconfig==2.3.1
librt==0.16.0
mypy==1.20.2
mypy_extensions==1.2.0
opentelemetry-api==1.45.2
packaging==26.3
pathspec==1.1.1
pluggy==1.7.0
pydantic==2.14.3
pydantic_core==2.50.4
Pygments==2.21.0
pytest==9.0.3
ruff==0.15.11
starlette==1.10.0
truststore==0.10.5
typing-inspection==0.4.5
typing_extensions==4.16.0
uvicorn==0.54.0
```

**python/bridge/requirements-runtime.txt**

```text
fastapi==0.163.2
pydantic==2.14.3
httpx2==2.16.2
uvicorn==0.54.0
```

**python/bridge/tests/test_http_contracts.py**

```python
import pytest
from fastapi.testclient import TestClient

from ops_bridge.http_app import create_app
from ops_bridge.http_contracts import SPACE

TOKEN = "fixture-bridge-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def test_valid_http_contract_has_no_fake_vectors() -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": ["网络故障"]})
        assert result.status_code == 200
        assert result.json() == {"schema_version": 1, "space": SPACE, "dimension": 1024, "count": 1}
        assert client.get("/healthz").json() == {"status": "ok"}


def test_service_requires_its_own_token() -> None:
    with TestClient(create_app(TOKEN)) as client:
        for headers in [{}, {"Authorization": "Bearer incorrect"}]:
            result = client.post("/v1/embedding/validate", headers=headers,
                                 json={"role": "query", "texts": ["网络故障"]})
            assert result.status_code == 401


def test_unknown_fields_fail_without_echoing_input() -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": ["private-fixture"], "admin": True})
        assert result.status_code == 422
        assert result.json() == {"error": {"code": "BRIDGE_INPUT"}}


@pytest.mark.parametrize("texts", [[], [True], [" "], ["x"] * 17, ["x" * 2049]],
                         ids=["empty", "boolean", "blank", "batch-limit", "text-limit"])
def test_text_budget_and_type(texts: object) -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": texts})
        assert result.status_code == 422


def test_invalid_role_and_json() -> None:
    with TestClient(create_app(TOKEN)) as client:
        assert client.post("/v1/embedding/validate", headers=HEADERS,
                           json={"role": "admin", "texts": ["甲"]}).status_code == 422
        assert client.post("/v1/embedding/validate", headers=HEADERS, content="{").status_code == 422


def test_missing_startup_token_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    from ops_bridge.http_app import from_environment

    monkeypatch.delenv("OPS_BRIDGE_TOKEN", raising=False)
    with pytest.raises(ValueError, match="OPS_BRIDGE_TOKEN"):
        from_environment()


def test_real_uvicorn_loopback_process() -> None:
    import os
    import socket
    import subprocess
    import sys
    import time

    import httpx2

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "ops_bridge.http_app:from_environment", "--factory",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        env={**os.environ, "OPS_BRIDGE_TOKEN": TOKEN}, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE)
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 10
        while True:
            try:
                assert httpx2.get(base + "/healthz", timeout=1).json() == {"status": "ok"}
                break
            except httpx2.TransportError:
                assert server.poll() is None and time.monotonic() < deadline
                time.sleep(0.1)
        result = httpx2.post(base + "/v1/embedding/validate", headers=HEADERS, timeout=2,
                             json={"role": "passage", "texts": ["甲", "乙"]})
        assert result.status_code == 200 and result.json()["count"] == 2
        assert httpx2.post(base + "/v1/embedding/validate", timeout=2,
                           json={"role": "passage", "texts": ["甲"]}).status_code == 401
    finally:
        server.terminate()
        server.communicate(timeout=10)
```

## 五、核心面试题

Node 与 Python 对空数组和缺字段的解释一致吗？

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。 [本日配套面试题](D99-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。

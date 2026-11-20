"""桥接协议v1；向量空间沿用Node端既有常量。"""
import uuid
from typing import Annotated, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class EmbedResult(EmbedPlan):
    # 向量顺序与请求texts一致；维度由客户端在返回前逐条检查。
    vectors: list[list[float]]


# 严格模型里单独放宽UUID：JSON里只有字符串，解析后才是uuid.UUID。
GroupId = Annotated[uuid.UUID, Field(strict=False)]


class ChunkIn(StrictModel):
    source_key: Annotated[str, Field(pattern=r"^(solution|manual):[^/]{1,200}$")]
    group_id: GroupId | Literal["shared"]
    version: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]
    text: Text

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.end <= self.start or not self.text.strip():
            raise ValueError("切片坐标或正文不合法")
        return self


class ChunkUpsert(StrictModel):
    rows: Annotated[list[ChunkIn], Field(min_length=1, max_length=16)]


class ChunkSearch(StrictModel):
    query: Text
    # 必填但可为null：null只查共享知识，缺字段则422。
    group_id: GroupId | None
    limit: Annotated[int, Field(ge=1, le=24)] = 24


class CandidateOut(StrictModel):
    source_key: str
    version: str
    start: int
    end: int
    distance: float


class SearchResult(StrictModel):
    schema_version: Literal[1] = 1
    space: Literal["qwen3_06b_q8_06507c7b_chunks_v1"] = SPACE
    candidates: list[CandidateOut]

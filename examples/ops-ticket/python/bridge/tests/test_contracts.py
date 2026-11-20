import pytest

from ops_bridge.contracts import parse_request


def payload() -> dict[str, object]:
    return {"tickets": [{"ticket_no": " A ", "tags": [" 网络 ", "网络"]}], "concurrency": 2}


def test_parse_normalizes_and_copies() -> None:
    rows = [{"ticket_no": " A ", "tags": [" 网络 ", "网络"]}]
    request = parse_request({"tickets": rows, "concurrency": 2})
    rows.clear()
    assert request.tickets[0].ticket_no == "A"
    assert request.tickets[0].tags == ("网络",)
    assert request.concurrency == 2


def test_bool_is_not_a_business_integer() -> None:
    with pytest.raises(ValueError, match="整数"):
        parse_request({**payload(), "concurrency": True})


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValueError, match="字段"):
        parse_request({**payload(), "admin": True})


def test_duplicate_ids_after_normalization_are_rejected() -> None:
    with pytest.raises(ValueError, match="重复"):
        parse_request({"tickets": [{"ticket_no": "A", "tags": []},
                                   {"ticket_no": " A ", "tags": []}], "concurrency": 1})


@pytest.mark.parametrize("value", [None, [], {}, {"tickets": [], "concurrency": 1},
                                  {"tickets": [{}], "concurrency": 1}])
def test_invalid_shapes_fail(value: object) -> None:
    with pytest.raises(ValueError):
        parse_request(value)


@pytest.mark.parametrize("limit", [0, 9, 1.5, "2"])
def test_invalid_concurrency_fails(limit: object) -> None:
    with pytest.raises(ValueError):
        parse_request({**payload(), "concurrency": limit})


def test_size_and_text_limits() -> None:
    for row in [{"ticket_no": "", "tags": []}, {"ticket_no": "A", "tags": [False]},
                {"ticket_no": "A", "tags": ["x"] * 11},
                {"ticket_no": "A", "tags": ["x" * 65]}]:
        with pytest.raises(ValueError):
            parse_request({"tickets": [row], "concurrency": 1})
    with pytest.raises(ValueError):
        parse_request({"tickets": [{"ticket_no": str(i), "tags": []} for i in range(101)],
                       "concurrency": 1})

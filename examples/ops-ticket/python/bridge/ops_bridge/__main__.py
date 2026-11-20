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

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class EvalMetric:
    name: str
    passed: int
    total: int

    @property
    def rate(self) -> float:
        if self.total <= 0:
            return 0.0
        return self.passed / self.total


def summarize(metrics: List[EvalMetric]) -> Dict[str, Any]:
    out = {"metrics": [], "ok": True}
    for m in metrics:
        out["metrics"].append(
            {"name": m.name, "passed": m.passed, "total": m.total, "rate": m.rate}
        )
        if m.passed != m.total:
            out["ok"] = False
    return out

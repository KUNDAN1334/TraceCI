#!/usr/bin/env python
"""Export the compiled graph as Mermaid (and a PNG if the network allows).

The diagram in the README is generated from the *compiled* graph rather than
drawn by hand, so it cannot drift away from the code. If a node is added and
the README diagram does not change, the diagram is lying.

    python scripts/export_graph.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from traceci.graph import build_graph  # noqa: E402
from traceci.tools import ToolSession  # noqa: E402

DOCS = pathlib.Path(__file__).resolve().parents[2] / "docs"


def main() -> int:
    graph, _ = build_graph(ToolSession())
    DOCS.mkdir(parents=True, exist_ok=True)

    mermaid = graph.get_graph().draw_mermaid()
    (DOCS / "architecture.mermaid").write_text(mermaid)
    print(f"wrote docs/architecture.mermaid ({len(mermaid.splitlines())} lines)")

    try:
        png = graph.get_graph().draw_mermaid_png()
        (DOCS / "architecture.png").write_bytes(png)
        print(f"wrote docs/architecture.png ({len(png)} bytes)")
    except Exception as exc:  # mermaid.ink is a network call; not worth failing on
        print(f"PNG skipped ({type(exc).__name__}: {str(exc)[:120]}). "
              "The .mermaid file renders natively on GitHub anyway.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

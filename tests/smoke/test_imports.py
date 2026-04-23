from __future__ import annotations


def test_nxl_imports() -> None:
    import nxl
    import nxl.cli

    assert nxl.cli.main is not None

from __future__ import annotations

import getpass
import os
import re
from pathlib import Path

import pytest


def _effective_username() -> str:
    """Return the Windows security principal name when it is available."""
    try:
        username = os.getlogin()
    except OSError:
        username = getpass.getuser()
    return re.sub(r"[^A-Za-z0-9_.-]", "_", username) or "unknown"


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config: pytest.Config) -> None:
    """Keep pytest temp trees separate across Windows execution identities."""
    if config.option.basetemp is None:
        config.option.basetemp = str(
            Path(config.rootpath) / f".pytest-tmp-{_effective_username()}"
        )

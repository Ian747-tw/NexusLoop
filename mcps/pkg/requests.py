"""mcps.pkg.requests — Request models for pkg MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PkgAdd(BaseModel):
    """Request to add a package to the project venv."""
    name: str = Field(description="Package name from PyPI")
    version_spec: str | None = Field(
        default=None,
        description="Version specifier (e.g. '>=1.0.0', '==2.3.1')"
    )
    registry: str = Field(
        default="pypi",
        description="Package registry (only 'pypi' is allowed)"
    )


class PkgRemove(BaseModel):
    """Request to remove a package from the project venv."""
    name: str = Field(description="Package name to remove")


class PkgFreeze(BaseModel):
    """Request to get the lockfile diff."""
    pass

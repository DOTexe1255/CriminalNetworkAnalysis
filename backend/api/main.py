"""Container-facing API entrypoint kept separate from seed and data services."""

from api.app import app

__all__ = ["app"]

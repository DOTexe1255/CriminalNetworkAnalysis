from __future__ import annotations

import os
from pathlib import Path
from typing import Any, BinaryIO


class ObjectStorage:
    def __init__(self) -> None:
        self.root = Path(os.getenv("STORAGE_ROOT", "/app/storage"))
        self.bucket = os.getenv("STORAGE_BUCKET", "trace-case-files")

    def ensure_bucket(self) -> None:
        (self.root / self.bucket).mkdir(parents=True, exist_ok=True)

    def put_bytes(self, key: str, content: bytes, content_type: str) -> None:
        self.ensure_bucket()
        destination = self.root / self.bucket / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)

    def get_object(self, key: str) -> dict[str, Any]:
        self.ensure_bucket()
        destination = self.root / self.bucket / key
        if not destination.is_file():
            raise KeyError(key)
        return {"Body": destination.open("rb"), "ContentType": "application/octet-stream"}


storage = ObjectStorage()

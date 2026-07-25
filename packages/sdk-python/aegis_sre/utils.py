import datetime
import os
import socket
import sys
from typing import Any, Dict, Optional

TERMINAL_STATUSES = {"RESOLVED", "FAILED", "AWAITING_REVIEW"}


def is_terminal_status(status: str) -> bool:
    return status in TERMINAL_STATUSES


def collect_runtime() -> Dict[str, Any]:
    """Language-agnostic runtime fields the server's runtimeInfoSchema accepts."""
    info: Dict[str, Any] = {}
    try:
        info["pid"] = os.getpid()
    except Exception:
        pass
    try:
        info["platform"] = sys.platform
    except Exception:
        pass
    try:
        info["hostname"] = socket.gethostname()
    except Exception:
        pass
    return info


def detect_environment() -> Optional[str]:
    return os.environ.get("AEGIS_ENV") or os.environ.get("ENV") or os.environ.get("PYTHON_ENV")


def merge_metadata(*sources: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    merged: Dict[str, Any] = {}
    for source in sources:
        if source:
            merged.update(source)
    return merged or None


def iso_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

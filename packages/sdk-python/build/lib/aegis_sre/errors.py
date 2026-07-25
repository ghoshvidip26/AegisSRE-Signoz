from typing import Any, Optional


class AegisError(Exception):
    """Base class for all aegis_sre errors."""


class AegisApiError(AegisError):
    """The AegisSRE server returned a non-2xx response."""

    def __init__(self, status: int, body: Any, message: Optional[str] = None):
        super().__init__(message or f"AegisSRE API returned {status}")
        self.status = status
        self.body = body


class AegisNetworkError(AegisError):
    """The request never reached the server (DNS, connection refused, etc.)."""


class AegisTimeoutError(AegisError):
    """A request, or wait_for_resolution(), exceeded its time budget."""

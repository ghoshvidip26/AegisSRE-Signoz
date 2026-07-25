import sys
import threading
import time
import traceback
from typing import Any, Callable, Dict, List, Optional

import requests

from .errors import AegisApiError, AegisError, AegisNetworkError, AegisTimeoutError
from .utils import collect_runtime, detect_environment, is_terminal_status, iso_now, merge_metadata

DEFAULT_TIMEOUT = 10.0
DEFAULT_WAIT_TIMEOUT = 5 * 60.0
DEFAULT_WAIT_INTERVAL = 2.0

OnCaptured = Callable[[Dict[str, Any], str], None]


class AegisClient:
    """
    Generic runtime transport for AegisSRE. Captures errors and runtime
    context and forwards them to the AegisSRE Runtime — it never classifies,
    infers root cause, or picks a remediation. All intelligence lives on the
    server (Classifier -> Diagnosis -> Runbook Registry -> Planning ->
    Decision Gateway -> Sandbox -> Verification).
    """

    def __init__(
        self,
        base_url: str,
        service: str,
        api_key: Optional[str] = None,
        environment: Optional[str] = None,
        default_metadata: Optional[Dict[str, Any]] = None,
        timeout: float = DEFAULT_TIMEOUT,
        session: Optional[requests.Session] = None,
    ):
        if not base_url or not base_url.strip():
            raise AegisError("AegisClient: base_url is required")
        if not service or not service.strip():
            raise AegisError("AegisClient: service is required")

        self._base_url = base_url.rstrip("/")
        self._service = service
        self._api_key = api_key
        self._environment = environment or detect_environment()
        self._default_metadata = default_metadata
        self._timeout = timeout
        self._session = session or requests.Session()

        self._prev_excepthook = None
        self._prev_threading_excepthook = None
        self._handlers_installed = False

    # ---- manual reporting ----

    def capture(
        self,
        error: BaseException,
        metadata: Optional[Dict[str, Any]] = None,
        service: Optional[str] = None,
        environment: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Report an exception. Unlike JS, Python can only ever raise
        BaseException instances, so there's no "what did they actually
        throw" ambiguity to resolve here.
        """
        if not isinstance(error, BaseException):
            raise AegisError("capture() expects an exception instance")

        message = str(error) or type(error).__name__
        tb = getattr(error, "__traceback__", None)
        stack = (
            "".join(traceback.format_exception(type(error), error, tb))
            if tb is not None
            else None
        )

        return self._send(self._build_payload(message, stack, metadata, service, environment))

    def report(
        self,
        message: str,
        metadata: Optional[Dict[str, Any]] = None,
        service: Optional[str] = None,
        environment: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Report a non-exception event with a raw message."""
        if not message or not message.strip():
            raise AegisError("report(): message is required")
        return self._send(self._build_payload(message, None, metadata, service, environment))

    def get_incident(self, incident_id: str) -> Dict[str, Any]:
        res = self._request("GET", f"/api/incidents/{incident_id}")
        return res["incident"]

    def list_incidents(self) -> List[Dict[str, Any]]:
        res = self._request("GET", "/api/incidents")
        return res["incident"]

    def wait_for_resolution(
        self,
        incident_id: str,
        timeout: float = DEFAULT_WAIT_TIMEOUT,
        interval: float = DEFAULT_WAIT_INTERVAL,
    ) -> Dict[str, Any]:
        """Poll get_incident() until status is terminal (RESOLVED, FAILED, AWAITING_REVIEW) or timeout."""
        deadline = time.monotonic() + timeout
        while True:
            incident = self.get_incident(incident_id)
            if is_terminal_status(incident.get("status", "")):
                return incident
            if time.monotonic() >= deadline:
                raise AegisTimeoutError(
                    f"Incident {incident_id} did not reach a terminal state within "
                    f"{timeout}s (last status: {incident.get('status')})"
                )
            time.sleep(interval)

    # ---- automatic capture ----

    def install_global_handlers(
        self,
        on_captured: Optional[OnCaptured] = None,
        capture_threads: bool = True,
    ) -> None:
        """
        Install sys.excepthook (and threading.excepthook, unless
        capture_threads=False) so uncaught exceptions are reported
        automatically — no try/except needed at the call site.

        Note the asymmetry with the Node SDK: Python always terminates the
        main thread (and the process, if it's the only non-daemon thread)
        after an uncaught exception, whether or not a hook is installed.
        These hooks only observe the exception before that happens — there
        is no "exit_on_capture" flag here because Python doesn't give you
        the choice. Reporting runs synchronously (bounded by `timeout`), so
        it completes, or times out, before Python proceeds to exit.

        KeyboardInterrupt and SystemExit are never reported — those are
        user-initiated, not bugs.

        Idempotent: calling twice is a no-op.
        """
        if self._handlers_installed:
            return

        self._prev_excepthook = sys.excepthook

        def _on_uncaught(exc_type, exc_value, exc_tb):
            self._handle_uncaught(exc_type, exc_value, exc_tb, "uncaughtException", on_captured)
            if self._prev_excepthook:
                self._prev_excepthook(exc_type, exc_value, exc_tb)

        sys.excepthook = _on_uncaught

        if capture_threads:
            self._prev_threading_excepthook = threading.excepthook

            def _on_thread_uncaught(args):
                self._handle_uncaught(
                    args.exc_type,
                    args.exc_value,
                    args.exc_traceback,
                    "unhandledRejection",
                    on_captured,
                )
                if self._prev_threading_excepthook:
                    self._prev_threading_excepthook(args)

            threading.excepthook = _on_thread_uncaught

        self._handlers_installed = True

    def uninstall_global_handlers(self) -> None:
        """Remove handlers registered by install_global_handlers(). Idempotent."""
        if not self._handlers_installed:
            return
        if self._prev_excepthook:
            sys.excepthook = self._prev_excepthook
        if self._prev_threading_excepthook:
            threading.excepthook = self._prev_threading_excepthook
        self._prev_excepthook = None
        self._prev_threading_excepthook = None
        self._handlers_installed = False

    def _handle_uncaught(self, exc_type, exc_value, exc_tb, origin, on_captured):
        if exc_type is None or issubclass(exc_type, (KeyboardInterrupt, SystemExit)):
            return
        try:
            incident = self.capture(exc_value, metadata={"origin": origin})
        except Exception as report_err:
            print(f"[aegis-sre] failed to report error: {report_err}", file=sys.stderr)
            return
        if on_captured:
            try:
                on_captured(incident, origin)
            except Exception as cb_err:
                print(f"[aegis-sre] on_captured callback raised: {cb_err}", file=sys.stderr)

    # ---- internals ----

    def _build_payload(
        self,
        message: str,
        stack: Optional[str],
        metadata: Optional[Dict[str, Any]],
        service: Optional[str],
        environment: Optional[str],
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "service": (service or self._service).strip(),
            "message": message,
            "runtime": collect_runtime(),
            "timestamp": iso_now(),
        }
        if stack:
            payload["stack"] = stack
        env = environment or self._environment
        if env:
            payload["environment"] = env
        meta = merge_metadata(self._default_metadata, metadata)
        if meta:
            payload["metadata"] = meta
        return payload

    def _send(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        res = self._request("POST", "/api/incidents", json_body=payload)
        return res["incident"]

    def _request(
        self, method: str, path: str, json_body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        url = f"{self._base_url}{path}"
        try:
            response = self._session.request(
                method, url, json=json_body, headers=headers, timeout=self._timeout
            )
        except requests.Timeout as e:
            raise AegisTimeoutError(f"Request to {path} exceeded {self._timeout}s") from e
        except requests.RequestException as e:
            raise AegisNetworkError(f"Network error contacting {path}: {e}") from e

        body = _parse_body(response)
        if not response.ok:
            raise AegisApiError(response.status_code, body)
        return body


def _parse_body(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text

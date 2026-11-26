"""Exceptions returned for a finished, unsuccessful sprite worker invocation."""
from subprocess import CalledProcessError, TimeoutExpired


def terminal_result_errors():
    from modal.exception import ExecutionError, FunctionTimeoutError, InternalFailure, OutputExpiredError

    # The reader and renderer invoke child processes. Their exceptions are
    # serialized by Modal and re-raised in the game-side client on get().
    # Any other ordinary error a worker function raises is just as final: left out, it made the game
    # re-poll the same finished call every minute forever, so the job never ended and never refunded.
    # OSError stays out on purpose: TimeoutError (still running) and connection errors are its subclasses.
    return (CalledProcessError, TimeoutExpired, ValueError, ExecutionError,
            FunctionTimeoutError, InternalFailure, OutputExpiredError,
            RuntimeError, KeyError, IndexError, TypeError, AttributeError, AssertionError,
            ZeroDivisionError, ImportError, MemoryError)


DETAIL_CHARS = 600


def failure_detail(error):
    """The end of a failed call's error, for the game server's log. Modal re-raises a remote failure locally
    with the remote traceback in its message; its last lines name the step and why it stopped (2026-11-25:
    three failed jobs could only be read as "exit status 1")."""
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    text = " | ".join(lines[-6:]) or type(error).__name__
    return (type(error).__name__ + ": " + text)[-DETAIL_CHARS:]

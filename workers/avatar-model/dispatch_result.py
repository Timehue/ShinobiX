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

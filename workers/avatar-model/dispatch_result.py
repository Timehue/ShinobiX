"""Exceptions returned for a finished, unsuccessful sprite worker invocation."""
from subprocess import CalledProcessError, TimeoutExpired


def terminal_result_errors():
    from modal.exception import ExecutionError, FunctionTimeoutError, InternalFailure, OutputExpiredError

    # The reader and renderer invoke child processes. Their exceptions are
    # serialized by Modal and re-raised in the game-side client on get().
    return (CalledProcessError, TimeoutExpired, ValueError, ExecutionError,
            FunctionTimeoutError, InternalFailure, OutputExpiredError)

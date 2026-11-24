import time


def call_with_retry(fn, attempts=3, delay=0.5):
    """Call fn, retrying on failure with a growing delay."""
    last_error = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as error:
            last_error = error
            time.sleep(delay * (attempt + 1))
    raise last_error

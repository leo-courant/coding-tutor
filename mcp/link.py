"""How the agent side reaches the Coding Tutor extension.

Each VS Code window running the extension writes a file under
~/.coding-tutor/windows with its port, token and folders. The agent's tools and
hooks find the window whose folder holds their working directory and post to it
on 127.0.0.1. Standard library only.
"""
import glob
import json
import os
import urllib.error
import urllib.request

WINDOWS = os.path.join(os.path.expanduser("~"), ".coding-tutor", "windows")
NO_WINDOW = (
    "Coding Tutor is not running in a VS Code window that has this project open. "
    "Ask the engineer to install or enable the Coding Tutor extension and open this folder, then try again."
)


def is_within(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


def candidate_windows(cwd, narrating_only=False):
    """Windows whose folder contains `cwd` (or the reverse), best match first.

    With `narrating_only`, only windows running a narrated session: the hooks use
    this to do nothing, quickly, the rest of the time."""
    found = []
    for path in glob.glob(os.path.join(WINDOWS, "*.json")):
        try:
            with open(path) as f:
                window = json.load(f)
        except (OSError, ValueError):
            continue
        if narrating_only and not window.get("narrating"):
            continue
        scores = [len(os.path.realpath(d)) for d in window.get("folders", []) if is_within(cwd, d) or is_within(d, cwd)]
        if scores:
            found.append((max(scores), os.path.getmtime(path), window))
    return [w for _, _, w in sorted(found, key=lambda t: (t[0], t[1]), reverse=True)]


def post(window, route, payload, timeout):
    request = urllib.request.Request(
        f"http://127.0.0.1:{window['port']}{route}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Coding-Tutor-Token": window["token"]},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def call_extension(route, payload, cwd=None, timeout=900, narrating_only=False):
    """Post to the best window for `cwd`. Returns the extension's answer, or
    {"ok": False, "error": ...} when no window took it."""
    for window in candidate_windows(cwd or os.getcwd(), narrating_only):
        try:
            return post(window, route, payload, timeout)
        except urllib.error.HTTPError as error:
            return {"ok": False, "error": f"the extension refused the request ({error.code})"}
        except OSError:
            continue  # a window that has closed and left its file behind
    return {"ok": False, "error": NO_WINDOW}

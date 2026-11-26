# 0006: Show where the code lives in the Explorer

Status: open. It can be built before or after 0001, because it hangs off the pointer, whoever moves it.
Opened: 2026-11-26

## Why

The pointer opens one file at a time and marks the lines. The engineer sees the code, but not where it sits in the project. A file's path in a tab or breadcrumb is one line of text, and it gives no picture of the architecture.

Beside a senior engineer, Leo watches the Explorer: the folders it opens on the way to the file. Following that path is how they build a mental map of where each piece of logic lives. They also want to be able to click through the same folders themselves.

## What it should do

- Whenever the pointer moves to a file, the Explorer shows the path to it. Each folder on the way is open, and the file and every folder on its path are marked. When the narration announces where the work goes next ("now we go to the voice server"), the path shows before the edit lands.
- It is the real Explorer, not a picture, so the engineer can click through it, open neighbours and look around. Between pointer moves the Explorer belongs to the engineer, and the tutor does not pull it back. While the session is paused, the path does not move.
- The Narration panel stays visible at the same time. Today it lives in the activity bar, in the same side bar as the Explorer, so showing one hides the other.
- Revealing a file never takes keyboard focus away from the editor or the chat.

## Questions for Leo

1. **Only the current path, or a trail too?** One option is to mark only where the pointer is now. The other is to also keep a quieter mark on every file and folder the session has touched, so that by the end the Explorer shows the change's footprint across the architecture.
2. **Where the Narration panel goes.** The secondary side bar, the bottom panel, or the engineer's choice.

## VS Code notes, to check while building

- `revealInExplorer` opens the folders and selects the file, but it may move focus to the Explorer. `explorer.autoReveal` (on by default) already follows the active editor, but only while the Explorer is visible. Part of the reveal may come for free once the panel moves out of the Explorer's side bar.
- A `FileDecorationProvider` with `propagate: true` marks a file and its parent folders, the way git status colours them. Git's own colours are in the same place, so a badge may read better than a colour.
- Any colour must be one used for nothing else:
  - the pointer is yellow, `rgba(255, 200, 0, …)`
  - pause is amber, resume green, muted red
  - git uses its own colours
- `explorer.compactFolders` (on by default) joins a chain of single-child folders into one row, which is the one-line view this ticket is meant to replace. Decide whether to open each level anyway, or leave it to the engineer's setting.
- One alternative is a tree of our own that shows only the folders the session touches. It is easier to control, but it is not the Explorer the engineer clicks through, so try the real Explorer first.

## Done when

- In a narrated session, each time the pointer moves to a file, the Explorer shows that file's path opened and marked, while the Narration panel stays visible and focus stays where it was.
- The engineer can click through the marked path and the folders around it without the tutor pulling the Explorer back.
- Leo, following a session, can say where each change lives in the project without reading a path.
- The visual change has a preview link at http://127.0.0.1:47820/ to check it.

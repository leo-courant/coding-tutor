# 0007: Narrate where the work is in git

Status: open. It builds on the pointer, and on 0006 for the worktree case. It is easiest after 0001, whose hooks see every git command the coder runs.
Opened: 2026-11-26

## Why

Leo works with git through the terminal (`git branch`, `git checkout`) and has no visual picture of branches and worktrees. In a narrated session the coder may create a branch, commit, or work in a worktree. Today the tutor says nothing about it, so the engineer loses track of where the work is.

The worktree case is the one that misleads. A worktree is a second folder checked out on another branch, sharing the same history. When the coder edits there, the pointer opens files the engineer's Explorer does not show, and 0006's path would lead into a folder they do not recognise.

## What it should do

- **Narrate git when git changes, not all the time.** The moments are:
  - a new branch
  - a checkout
  - a commit, with what it holds ("this commit holds the last three edits")
  - entering or leaving a worktree
  - a merge or rebase
- **Point at VS Code's own Source Control graph** (in the Source Control view) for those moments, rather than drawing a graph of our own. This follows the same rule as 0006: the real thing the engineer can click through.
- **Worktrees first.** When the coder works in a worktree, say so before the first edit there: which folder, which branch, and that it shares this repo's history. The pointer and 0006's path must make clear that the file is in that other folder, not in the one open in the Explorer.
- **The pointer stays on code.** A git moment is short and does not take over the session.

## VS Code and Claude Code notes, to check while building

- After 0001, the coder's git commands arrive as Bash PostToolUse events, with their output. Claude Code's worktree tools (entering and leaving one) reach PreToolUse and PostToolUse like any other tool. Check whether there are hook events of their own for creating and removing a worktree.
- The Source Control graph is built into VS Code (1.93 and later). Check which commands reveal it and select a commit, and whether they take focus.
- A worktree folder may be outside the workspace. Decide whether to add it to the workspace for the session (`updateWorkspaceFolders`) so the Explorer can show it, and remove it afterwards.

## Done when

- In a narrated session where the coder makes a branch, commits and works in a worktree, the tutor names each moment once, and the Source Control graph shows it.
- An edit in a worktree is never pointed at without the engineer having been told which folder and branch it is in.
- Leo can say, after the session, which branch and folder each change went to.

# 0004: Publish to the VS Code Marketplace

Status: open, after 0001. The first publish also waits for 0005 (security review).
Opened: 2026-11-26

## Why

Coding Tutor only works in this repo today. Anyone who installs the extension in their own project gets the panel and the voice, but nothing that starts a session:

- `/tutor` is a project skill in `.claude/skills/tutor/`.
- The MCP server is set up in `.mcp.json` as `python3 mcp/server.py`, a path relative to this repo.

After 0001 the coder reaches the extension through hooks rather than MCP tools, so what has to reach other projects is `/tutor` and the hooks.

## Scope

**Install outside this repo (decided 2026-11-26).** Each agent gets its own small adapter, packaged the way that agent installs add-ons. All of them speak the same agent-neutral protocol to the extension (0001).

- **Claude Code: a Claude Code plugin.** It carries the `/tutor` skill and the hooks with their script. This repo doubles as the plugin marketplace (`.claude-plugin/marketplace.json`). It is installed at user level, so it works in every project.
- **OpenCode (ticket 0003): an OpenCode plugin.** It is installed with `opencode plugin <module>`, plus a `/tutor` command file in the user's OpenCode config.
- **The extension does the installing.** On first start it looks for `claude` and `opencode` and offers "Set up Coding Tutor for Claude Code" and "…for OpenCode". Each runs that agent's own install command, and there is a matching "Remove" command for each. The `vscode:uninstall` script removes them when the extension is uninstalled.
- **Hooks cost nothing outside a session.** A plugin's hooks run on every tool call in every project, so the hook script must exit at once when no narrated session is active. It checks a session file before touching the network.
- **No MCP server unless something still needs it.** If after 0001 the coder calls no MCP tool, the plugin carries no MCP server, and `.mcp.json` leaves the repo.

Why plugins rather than writing into the engineer's settings: the agent installs, updates and removes a plugin with its own commands, and the engineer can see it and switch it off there. Edits to someone's settings file are easy to get wrong and hard to undo cleanly.

**Package for the Marketplace.**
- A top-level `icon` in `package.json`: a PNG of at least 128×128. The Marketplace refuses SVG icons, and `media/icon.svg` is only the activity-bar icon.
- A `repository` field and a `LICENSE` file (`package.json` already says MIT). Drop `--allow-missing-repository` and `--skip-license` from the build.
- A `CHANGELOG.md`, and a `.vscodeignore` so the package carries only what runs. That means no `spike/`, `tests/`, `previews/` or `docs/`.
- `extension/README.md` rewritten as the Marketplace page:
  - what it does
  - install steps, which the repo README promises ("see below") but does not have
  - requirements: uv, an audio player and recorder, and the Claude Code CLI for the narrator
  - which platforms are supported
  - what leaves the machine: the narrator's model calls go through the engineer's Claude login, while voice and speech recognition stay local (decision 0005)
  - Images in it must be https links, and SVG images are not allowed apart from known badge providers.
- **Platforms.** The audio players and recorders found today are Linux and macOS ones (`paplay`, `pw-play`, `afplay`, `ffplay`, `parecord`, `pw-record`). Either support Windows or say on the page that it is not supported.
- **Version.** Choose the first public version (today 0.4.1).

**Publisher account (steps only Leo can do).**
- Create a publisher at https://marketplace.visualstudio.com/manage with a Microsoft account, and replace the placeholder publisher `coding-tutor` in `package.json` with its ID.
- Create a token for `vsce`, following the current vsce publishing docs. Keep it out of the repo.
- These steps fit the `wizard` skill.

**Publish.** Only after 0005 is done: `vsce publish` from `extension/`.

## Out of scope

- Open VSX (VSCodium and other editors). It can follow as its own ticket.
- OpenCode support (ticket 0003). The first release supports Claude Code only, and the page says so.

## Done when

- On a machine or user account that has never had this repo, installing Coding Tutor from the Marketplace and following its page is enough to run `/tutor` in an unrelated project and get a narrated session.
- `vsce package` builds without `--allow-missing-repository` or `--skip-license`. The package holds only what runs.
- Ticket 0005 is done before the first `vsce publish`.

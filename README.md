# Coding Tutor

The implementation is explained aloud while your coding agent builds it, with the code pointed at as it goes. You follow along the way you would beside a senior engineer, and interrupt when you want more, less, or something different.

The coder does not narrate. A separate narrator model watches the coder's work through its hooks and speaks it; each edit lands in the editor while it is described, and the coder's next step waits until the voice has finished (decision 0007).

Status: slice 1 of 3, plus pause and interrupts by typing or talking, with the narrator separate from the coder (ticket 0001), in Claude Code and OpenCode (ticket 0003). The route with a tempo per part (slice 2) is not built yet.

The vocabulary is in [GLOSSARY.md](GLOSSARY.md) and the design decisions in [docs/adr/](docs/adr/).

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| VS Code extension | `extension/` | Owns the voice, the captions panel, the pointer and the narrator. Listens on localhost for the agent's tool and hooks. |
| Session coordinator | `extension/lib/session.js` | Agent-neutral: takes the coder's events, asks the narrator, speaks, holds the coder's next step, passes the engineer's corrections to the coder. |
| Narrator | `extension/lib/narrator.js`, `extension/lib/opencode-narrator.js` | One long-running headless process of your agent's CLI per session, with your login and no tools: `claude -p` with no MCP servers, or `opencode serve` (on 127.0.0.1, with a password of its own) running an agent that has no tools. |
| Session script | `extension/session-script.md` | The narrator's instructions: the opening, how each depth sounds, how interrupts are handled. |
| Voice server | `extension/voice/server.py` | Local Kokoro voice and Whisper speech recognition (`small.en`), both on the GPU when there is one (through `extension/voice/gpu.py`). Started by the extension, on the host when VS Code is a Flatpak. |
| Agent tool | `mcp/server.py` | MCP server with `begin_session`. Standard-library Python. |
| Claude Code adapter | `mcp/claude_code.py` | The hooks: turns Claude Code's hook events into Coding Tutor's events and back. |
| OpenCode adapter | `mcp/opencode.js` | A plugin doing the same for OpenCode's plugin hooks. It does nothing unless a narrated session is running. |
| `/tutor` | `.claude/skills/tutor/`, `.opencode/commands/tutor.md` | Starts a narrated session. In Claude Code it also switches the hooks on for that turn (in its frontmatter). |

## Requirements

- VS Code, and Claude Code (its hooks and `claude -p`, which also runs the narrator with your login) or OpenCode 1.17 or later (its plugins and `opencode serve`, which runs the narrator with your providers).
- [uv](https://docs.astral.sh/uv/) on the host, for the voice. The first start downloads the voice model (about 350 MB) to `~/.cache/coding-tutor/`.
- `python3` where the agent runs, an audio player (`paplay`, `pw-play`, `afplay` or `ffplay`) and a recorder (`parecord` or `pw-record`).
- With an NVIDIA GPU, the first start also downloads its CUDA libraries (about 1.5 GB) for the voice and speech recognition: a sentence takes about 0.1 s to synthesise. Without one, both run on the CPU, where a sentence takes about as long to make as to say, and much longer while the agent runs tests or builds, which shows up as pauses between sentences; recognition takes about 1 s per question.

## Use

1. Install the extension (see below) and open the project in VS Code.
2. In Claude Code or OpenCode: `/tutor <task>`, for example `/tutor add a --verbose flag to the CLI, go deeper on the argument parsing`. The session lasts for that turn and ends with the spoken recap.
3. Watch the editor and the Coding Tutor panel (the graduation cap in the activity bar).
4. To take part:
   - **Pause** (or `Ctrl+Alt+P`) holds the coder while you think; **Resume** picks up where it stopped.
   - Type in the box at the bottom of the panel to interrupt: ask, correct, or change the depth. Typing pauses the voice; Enter sends. The narrator answers what it can (what was done, "show me", "say that again", more or less depth) and passes the rest to the coder (corrections, objections, a why it does not know) as the reason the coder's next step was held.
   - **Esc** in your agent stops the coder and ends the session. A step that was being held does not run.
   - Or click **Talk** (or `Ctrl+Alt+M`): wait for the red **Listening**, speak, click again. What was heard lands in the box for you to check, then Enter sends it.
   - **Skip** cuts the current narration short; **Mute** switches to captions only.

## Settings

`~/.config/coding-tutor/config.json` (run "Coding Tutor: Open settings"):

```json
{
  "voice": "am_adam",
  "defaultDepth": "outline",
  "language": "en",
  "muted": false,
  "speed": 1.0,
  "narratorModel": ""
}
```

- `narratorModel`: the model the narrator runs on, passed to your agent as is: for Claude Code its `--model` (`sonnet`, `opus`, …), for OpenCode its `provider/model` (as `opencode models` lists it, for example `local/qwen3.6-35b`). Empty means your agent's default model, the one you code with. A single value applies to every agent. If you use both, set one per agent, since Claude Code's names are not OpenCode's; an agent left out gets its default model:

  ```json
  "narratorModel": { "claude-code": "sonnet", "opencode": "local/qwen3.6-35b" }
  ```

- "Coding Tutor: Sample voices" plays every voice and saves the one you choose.
- To change how sessions run, copy `extension/session-script.md` to `~/.config/coding-tutor/session-script.md` and edit it. Your copy replaces the default.
- Transcripts are saved under `~/.local/share/coding-tutor/transcripts/<project>/`. Each ends with what the narrator cost.
- Files you deny the coder (Claude Code's `permissions.deny`, OpenCode's `permission`) stay hidden from the narrator too: it sees only what the coder's tools returned. Declare them there, once; Coding Tutor has no rules of its own. In OpenCode (1.19), a `read` rule does not stop its grep: grep still searches the file and shows the coder the lines that match, and the narrator sees them too. A `.ignore` file does not stop it either. In a project with such files, deny grep (`"permission": {"grep": "deny"}`), which takes the tool away from the coder.

## Install for every project

The MCP server and the `/tutor` skill can be registered once for all projects:

```sh
claude mcp add --scope user coding-tutor -- python3 $PWD/mcp/server.py
ln -s $PWD/.claude/skills/tutor ~/.claude/skills/tutor
```

The skill's hooks find the adapter through `.claude/skills/tutor/hook.py`, a link to `mcp/claude_code.py`.

For OpenCode, link the plugin and the command into its config folder, and add the MCP server to `~/.config/opencode/opencode.json`:

```sh
mkdir -p ~/.config/opencode/plugins ~/.config/opencode/commands
ln -s $PWD/mcp/opencode.js ~/.config/opencode/plugins/coding-tutor.js
ln -s $PWD/.opencode/commands/tutor.md ~/.config/opencode/commands/tutor.md
```

```json
"mcp": { "coding-tutor": { "type": "local", "command": ["python3", "/path/to/coding-tutor/mcp/server.py"] } }
```

In this repository, `opencode.json` and `.opencode/` already do this.

## Develop

```sh
python3 -m unittest tests/test_mcp_server.py tests/test_claude_code_hook.py
node --test tests/*.test.js                            # Node 22.12 or later
sh spike/e2e/opencode-e2e.sh                           # a narrated session in OpenCode, with a scripted fake model
code --extensionDevelopmentPath=$PWD/extension $PWD   # try the extension without installing it
cd extension && npx @vscode/vsce package               # build the .vsix
```

# Coding Tutor

Your coding agent explains the implementation aloud while it builds it, and points at the code as it goes. You follow along the way you would beside a senior engineer, and interrupt when you want more, less, or something different.

Status: slice 1 of 3, plus pause and interrupts by typing or talking. The voice, captions, pointer, microphone, settings, recap and transcript work. The route with a tempo per part (slice 2) is not built yet.

The vocabulary is in [GLOSSARY.md](GLOSSARY.md) and the design decisions in [docs/adr/](docs/adr/).

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| VS Code extension | `extension/` | Owns the voice, the captions panel and the pointer. Listens on localhost for the agent's tools. |
| Voice server | `extension/voice/server.py` | Local Kokoro voice and Whisper speech recognition (`small.en`), both on the GPU when there is one (through `extension/voice/gpu.py`). Started by the extension, on the host when VS Code is a Flatpak. |
| Agent tools | `mcp/server.py` | MCP server with `begin_session`, `narrate`, `wait`, `end_session`. Standard-library Python. |
| Session script | `mcp/session-script.md` | The instructions the agent follows during a narrated session. |
| `/tutor` | `.claude/skills/tutor/` | Starts a narrated session in Claude Code. |

## Requirements

- VS Code, and an agent that supports MCP (Claude Code is set up here).
- [uv](https://docs.astral.sh/uv/) on the host, for the voice. The first start downloads the voice model (about 350 MB) to `~/.cache/coding-tutor/`.
- `python3` where the agent runs, an audio player (`paplay`, `pw-play`, `afplay` or `ffplay`) and a recorder (`parecord` or `pw-record`).
- With an NVIDIA GPU, the first start also downloads its CUDA libraries (about 1.5 GB) for the voice and speech recognition: a sentence takes about 0.1 s to synthesise. Without one, both run on the CPU, where a sentence takes about as long to make as to say, and much longer while the agent runs tests or builds, which shows up as pauses between sentences; recognition takes about 1 s per question.

## Use

1. Install the extension (see below) and open the project in VS Code.
2. In the agent: `/tutor <task>`, for example `/tutor add a --verbose flag to the CLI, go deeper on the argument parsing`.
3. Watch the editor and the Coding Tutor panel (the graduation cap in the activity bar).
4. To take part:
   - **Pause** (or `Ctrl+Alt+P`) holds the agent while you think; **Resume** picks up where it stopped.
   - Type in the box at the bottom of the panel to interrupt: ask, correct, or change the depth. Typing pauses the voice; Enter sends.
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
  "speed": 1.0
}
```

- "Coding Tutor: Sample voices" plays every voice and saves the one you choose.
- To change how sessions run, copy `mcp/session-script.md` to `~/.config/coding-tutor/session-script.md` and edit it. Your copy replaces the default.
- Transcripts are saved under `~/.local/share/coding-tutor/transcripts/<project>/`.

## Develop

```sh
python3 -m unittest tests/test_mcp_server.py
node --test tests/*.test.js
code --extensionDevelopmentPath=$PWD/extension $PWD   # try the extension without installing it
cd extension && npx @vscode/vsce package               # build the .vsix
```

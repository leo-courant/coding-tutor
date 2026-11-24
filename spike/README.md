# Spike (throwaway)

Question: from inside Flatpak VS Code on Bazzite, can an agent tool call reach our extension, point at code, and speak with a local voice?

Answer (2026-11-24): yes, all three.

## Run it

1. Voice server, on the host (outside the Flatpak):
   `flatpak-spawn --host uv run --python 3.12 --with kokoro-onnx --with soundfile spike/tts_server.py`
   Model files live in `~/.cache/coding-tutor/`.
2. Extension: `code --extensionDevelopmentPath=$PWD/spike/extension $PWD/spike/sample`
   (launch it detached, e.g. with `setsid`, or it dies with the launching shell).
3. Agent tool: `.mcp.json` registers `spike/mcp_server.py`, which exposes `narrate(text, file, startLine, endLine)`.

## What was measured

- Kokoro on CPU only: 7.0 s of speech synthesised in 1.1 s; 0.9 s in 0.26 s. GPU not needed so far.
- Pointer set in 2-40 ms.
- `narrate` returns only when playback ends, so the voice paces the agent with no extra machinery.

## What was learned

- The voice engine must run on the host; the sandbox reaches it over localhost.
- `paplay` works from the sandbox through the PulseAudio socket, but only from a file, not stdin.
- The extension writes its port and token to `~/.coding-tutor/spike.json`; the MCP server reads it. Home is shared between sandbox and host.
- Silence before the first word is the full synthesis time (about 1 s for a long sentence). Sentence-by-sentence synthesis would cut it.

# Mic spike (throwaway), 2026-11-24

Question: can Coding Tutor record the engineer's voice from inside Flatpak VS Code and turn it into text locally, fast enough for push-to-talk?

- Recording works from inside the sandbox with `parecord` (PulseAudio socket). Webviews cannot use the mic, so the extension must record through a process.
- Speech recognition (faster-whisper, run on the host with uv). Synthetic test sentences, all transcribed correctly:
  - CPU: base.en ~0.3 s, small.en ~0.9 s, large-v3-turbo ~3.2 s for ~4 s of speech.
  - GPU (RTX 5070 Ti, needs pip CUDA libs on LD_LIBRARY_PATH): large-v3-turbo ~0.2-0.3 s after a one-off ~9 s warm-up.
- Bluetooth headset mic: the first ~1.3 s of each recording is dead air while the headset switches to call mode.
- Built-in laptop mic: starts at once, but very loud even in silence (noise or high gain).
- Whisper can invent words from near-silence ("That's it."); the VAD filter suppressed it in later runs.

Try it: `spike/mic/try.sh` (headset) or `spike/mic/try.sh laptop`. Takes are replayable at http://127.0.0.1:47820/mic.html.

# Narrator experiment (throwaway), 2026-11-24

Question: could a separate, cheaper model narrate the coder's work, seeing only what hooks would give it (reads, commands and output, exact edits, what the engineer said), never the coder's own narration?

Replay of the "transcript records session length" session (`spike/narrator/`), 11 narration moments, accuracy judged by the coding agent:

| Narrator | Accurate | Partly | Wrong or misleading | Cost for the session |
| --- | --- | --- | --- | --- |
| Haiku 5.5 | 5 | 2 | 4 | $0.008 |
| Sonnet 5.5 | 8 | 3 | 0 | $0.11 |
| Coder narrating itself (Opus 5.5, 11 narration-only calls on a ~276k-token context) | reference | | | about $0.65 in cache reads and output |

- Haiku describes what changed but misses the problem and the why; it twice invented a file path. Sonnet, with the same input, stated the problem correctly: the gap is the model, not the information.
- Neither could point well on "show me": the narrator should be handed edit locations mechanically.
- Neither knew why the coder closed transcripts without a recap; only a short "why" from the coder would give that.
- Sonnet twice broke the JSON answer format; the product should use structured outputs.

Side-by-side page with audio: http://127.0.0.1:47820/narrator.html

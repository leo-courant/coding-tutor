# 0005: Security review before release

Status: open, last. Start it only when everything going into the first release is built, including 0001 and 0004's packaging, because it reviews the code that ships. Redo it for any later release that changes one of the areas below.
Opened: 2026-11-26

## Why

Coding Tutor runs local servers, starts processes on the host, records the microphone and keeps transcripts of code and speech. After 0001 it can also tell the coder what to do: the coder is told that Coding Tutor's held steps and notes are the engineer speaking. A flaw in any of these is a way into the engineer's machine or their agent, so the first public release waits for this review.

## Open question

**Which standard to check against.** Proposal: OWASP ASVS level 1, keeping only the parts that apply to a local tool, plus VS Code's guidance for extensions and the Marketplace's own policies. Settle this before starting.

## What to review

Found in the code on 2026-11-26. The list is a starting point, not a limit.

- **The channel to the coder (highest stakes).** Anything that can reach the extension can speak to the coder as the engineer.
  - Who can call the extension's server? It listens on 127.0.0.1 with a random token, and the token sits in a 0600 file in `~/.coding-tutor/windows/`.
  - The token is checked with `!==`. Should it be a constant-time comparison?
  - Is there a Host header check against DNS rebinding, and a limit on request size?
- **Injection through the narrator.** After 0001, the narrator reads file contents and command output that the coder saw. That text can include instructions planted in the repo, and the narrator's "pass to the coder" field reaches the coder as the engineer. Check that only the engineer's own words reach the coder as the engineer, and that text the narrator writes can't.
- **The voice server.** It listens on a fixed port (47811) on 127.0.0.1 with no token, so any local process, or a web page through DNS rebinding, can make it speak or transcribe. Decide whether it needs the same token as the extension.
- **Supply chain.**
  - uv installs `kokoro-onnx`, `soundfile` and `faster-whisper`, plus the GPU build of onnxruntime and its CUDA libraries, with no versions pinned.
  - The voice model is downloaded from a GitHub release with no checksum, and the Whisper model is downloaded too.
  - Pin versions and check hashes. Check the licences of everything downloaded or bundled.
- **Starting processes.** Inside a Flatpak, `flatpak-spawn --host` runs uv, the audio player and the recorder outside the sandbox. Check that nothing from the agent, the narrator or the panel reaches their arguments.
- **Webviews.** They have a nonce-based Content Security Policy. Check that captions and narrator text are never rendered as HTML, since they are model output.
- **Files the coder may not read.** Re-run 0001's check on the release build: with a file denied, nothing of it reaches the narrator.
- **Local data.**
  - Transcripts in `~/.local/share/coding-tutor/` hold code and speech. What permissions do they have, and does the page say they are kept?
  - Recording happens only while the panel shows Listening.
  - Temporary audio files are deleted.
  - What is in the config file?
- **The package.** The Marketplace build carries no secrets, tokens or development files.

## Done when

- The standard is chosen and written at the top of the report.
- The report is in `docs/security/`, with each finding either fixed (with a test where one fits) or accepted with the reason.
- No finding rated high is left open.
- The first publish in 0004 goes ahead only after this.

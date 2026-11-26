# Coding Tutor

The implementation is explained aloud while your coding agent builds it, with the code pointed at as it goes.

This extension owns the voice, the captions panel, the pointer and the narrator, a separate model that follows the coder's work through its hooks. It needs Coding Tutor's agent side (the `begin_session` MCP server, the `/tutor` skill and its hooks) and `uv` installed for the local voice. See the project README for setup.

Commands: Sample voices, Open settings, Mute or unmute the voice, Skip what is being said, Open the latest transcript.

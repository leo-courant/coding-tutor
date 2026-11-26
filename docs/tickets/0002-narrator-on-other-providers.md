# 0002: Narrator on models from other providers

Status: open, after 0001
Opened: 2026-11-24. Updated 2026-11-26: any OpenAI-compatible endpoint, which covers GPT and local models.

## Why

Ticket 0001 runs the narrator through the engineer's own agent CLI, so it can only use models that agent offers. Claude Code offers Claude models only. An engineer who codes with GPT, or with their own local or fine-tuned model, must be able to narrate with it too. Coding Tutor assumes no particular model line.

Most of these models are reachable the same way: an OpenAI-compatible chat endpoint. OpenAI serves GPT through one. Local servers (llama.cpp, vLLM, Ollama, LM Studio) expose one for any model they load, fine-tuned ones included. Leo's OpenCode already uses a local Qwen through `http://localhost:8080/v1`.

## Scope

- **One narrator interface:** give it the session events, get back a structured answer (what to say, the pointer, anything to pass to the coder). 0001's agent CLI is the first backend.
- **An OpenAI-compatible backend:** a base URL, a model name, and an optional key read from an environment variable that the settings name. The key itself never goes in the settings file.
- **The answer format holds on every backend.** Use the endpoint's JSON-schema output (`response_format` with a schema) where it exists, and validate the answer on our side either way. Sonnet broke the format twice without structured output. Check that llama.cpp's server honours the schema with Leo's Qwen.
- **The narrator still has no tools on any backend,** as in 0001. It sees only what the coder's tools returned, so the coder's permission rules still decide what it can see.
- **The code stays on the machine when the model is local,** in line with decision 0005. The settings page says plainly which backends send code off the machine.

## Done when

- The backend and model are settings, and switching needs no code change.
- The "transcript records session length" replay runs on Leo's local Qwen and on one GPT model. Their accuracy and cost are reported next to Sonnet's.

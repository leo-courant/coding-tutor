# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "kokoro-onnx",
#   "soundfile",
#   "faster-whisper",
#   "onnxruntime-gpu==1.23.*",
#   "nvidia-cublas-cu12",
#   "nvidia-cudnn-cu12==9.*",
#   "nvidia-cuda-runtime-cu12==12.*",
#   "nvidia-cufft-cu12",
#   "nvidia-curand-cu12",
# ]
#
# [tool.uv]
# # kokoro-onnx and faster-whisper both ask for the CPU build of onnxruntime, which
# # installs into the same folder as the GPU build and breaks it. Drop it.
# override-dependencies = ["onnxruntime; sys_platform == 'never'"]
# ///
"""Starts the voice server on an NVIDIA GPU, for both the voice and speech recognition.

The extension runs this instead of server.py when `nvidia-smi` finds a GPU:
    uv run --quiet gpu.py [port]

onnxruntime-gpu 1.23 is the last release built for CUDA 12, the same CUDA as the
speech recognition libraries, so both share one download. On the CPU the voice
took as long to make a sentence as to say it, and longer while the agent ran
tests, which left gaps between sentences; on the GPU it takes about a tenth of a
second.
"""
import os
import runpy

runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py"), run_name="__main__")

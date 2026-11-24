# SPIKE - throwaway. How fast and accurate is local speech recognition here?
# Run on the host: uv run --python 3.12 --with faster-whisper --with kokoro-onnx --with soundfile spike/mic/stt_bench.py [cpu|cuda]
import os, sys, time
import numpy as np, soundfile as sf

C = os.path.expanduser("~/.cache/coding-tutor")
OUT = os.path.join(C, "mic")
LINES = [
    "Hold on, why are you checking this in the server and not in the extension?",
    "Go deeper on the values file, and skim the templates.",
    "Wait, you missed something. The retry loop never resets the delay.",
]
if not os.path.exists(f"{OUT}/line0.wav"):
    from kokoro_onnx import Kokoro
    k = Kokoro(f"{C}/kokoro-v1.0.onnx", f"{C}/voices-v1.0.bin")
    for i, (line, v) in enumerate(zip(LINES, ["am_adam", "af_heart", "bm_george"])):
        s, sr = k.create(line, voice=v, speed=1.0, lang="en-gb" if v[0] == "b" else "en-us")
        sf.write(f"{OUT}/line{i}.wav", s, sr)

from faster_whisper import WhisperModel
device = sys.argv[1] if len(sys.argv) > 1 else "cpu"
for name in ["base.en", "small.en", "large-v3-turbo"]:
    t = time.time()
    m = WhisperModel(name, device=device, compute_type="int8" if device == "cpu" else "float16")
    load = time.time() - t
    print(f"\n{name} on {device}: loaded in {load:.1f}s", flush=True)
    for i, line in enumerate(LINES):
        audio, sr = sf.read(f"{OUT}/line{i}.wav", dtype="float32")
        dur = len(audio) / sr
        t = time.time()
        x = np.interp(np.arange(0, len(audio), sr / 16000), np.arange(len(audio)), audio).astype(np.float32)
        segs, _ = m.transcribe(x, language="en", beam_size=1, vad_filter=False)
        text = " ".join(s.text.strip() for s in segs)
        print(f"  {dur:4.1f}s audio -> {time.time()-t:4.2f}s | {text}", flush=True)

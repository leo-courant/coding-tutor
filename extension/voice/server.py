"""Local voice server for Coding Tutor: speech out (Kokoro) and speech in (Whisper).

Runs outside any sandbox, started by the VS Code extension:
    uv run --python 3.12 --with kokoro-onnx --with soundfile --with faster-whisper server.py [port]
or, with an NVIDIA GPU, through gpu.py, which brings the GPU libraries:
    uv run gpu.py [port]

GET  /health                          -> {"ok": true, "voices": [...], "speaking": "gpu"|"cpu",
                                          "listening": "gpu"|"cpu"|"loading"|"unavailable: ..."}
POST /speak {text, voice, speed}       -> audio/wav
POST /transcribe  (body: audio/wav)    -> {"text": "..."}
"""
import glob
import io
import json
import os
import sys
import threading
import urllib.request

# The GPU libraries for speech recognition come as Python packages; the loader
# only finds them if they are on its path when the process starts.
try:
    import nvidia

    if os.environ.get("CODING_TUTOR_CUDA_PATH") != "1":
        os.environ["LD_LIBRARY_PATH"] = ":".join(d for r in nvidia.__path__ for d in glob.glob(r + "/*/lib"))
        os.environ["CODING_TUTOR_CUDA_PATH"] = "1"
        os.execv(sys.executable, [sys.executable] + sys.argv)
except ImportError:
    pass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "coding-tutor")
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
ENGLISH = ("af_", "am_", "bf_", "bm_")


def ensure_models():
    os.makedirs(CACHE, exist_ok=True)
    for name in FILES:
        path = os.path.join(CACHE, name)
        if not os.path.exists(path):
            print(f"downloading {name}", flush=True)
            urllib.request.urlretrieve(RELEASE + name, path + ".part")
            os.replace(path + ".part", path)


def load_voice():
    """The voice on the GPU when there is one (about 0.1 s per sentence), else on the CPU."""
    model, voices = (os.path.join(CACHE, f) for f in FILES)
    import onnxruntime as ort

    if "CUDAExecutionProvider" in ort.get_available_providers():
        try:
            options = ort.SessionOptions()
            options.log_severity_level = 3  # the GPU build warns about harmless graph details
            # The default exhaustive search for the fastest convolution reruns for every
            # new sentence length and took 40 s on the first sentence; the heuristic does not.
            cuda = ("CUDAExecutionProvider", {"cudnn_conv_algo_search": "HEURISTIC"})
            session = ort.InferenceSession(model, options, providers=[cuda, "CPUExecutionProvider"])
            if "CUDAExecutionProvider" in session.get_providers():
                voice = Kokoro.from_session(session, voices)
                voice.create("Warming up the voice.", voice="am_adam", lang="en-us")  # the first sentence is slow
                print("voice ready on gpu", flush=True)
                return voice, "gpu"
        except Exception as e:  # GPU libraries missing or out of memory: use the CPU
            print(f"voice on gpu failed: {e}", flush=True)
    print("voice ready on cpu", flush=True)
    return Kokoro(model, voices), "cpu"


ensure_models()
kokoro, VOICE_DEVICE = load_voice()
VOICES = sorted(v for v in np.load(os.path.join(CACHE, FILES[1])).keys() if v.startswith(ENGLISH))
synth_lock = Lock()

# Speech recognition loads in the background so the voice is ready at once.
# small.en: accurate on real speech in the mic spike, and does not repeat itself
# the way large-v3-turbo did.
STT_MODEL = "small.en"
stt = {"model": None, "state": "loading", "ready": threading.Event(), "lock": threading.Lock()}


def load_stt():
    from faster_whisper import WhisperModel

    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            model = WhisperModel(STT_MODEL, device=device, compute_type=compute)
            list(model.transcribe(np.zeros(16000, dtype=np.float32), language="en")[0])  # warm up
            stt.update(model=model, state="gpu" if device == "cuda" else "cpu")
            print(f"speech recognition ready on {device}", flush=True)
            break
        except Exception as e:  # no GPU, or its libraries are missing: try the CPU
            print(f"speech recognition on {device} failed: {e}", flush=True)
    else:
        stt["state"] = "unavailable: see the Coding Tutor output channel"
    stt["ready"].set()


def transcribe(wav_bytes):
    stt["ready"].wait()
    if stt["model"] is None:
        raise RuntimeError(f"speech recognition is {stt['state']}")
    audio, rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != 16000:
        audio = np.interp(np.arange(0, len(audio), rate / 16000), np.arange(len(audio)), audio).astype(np.float32)
    with stt["lock"]:  # live previews and the final pass must not use the model at once
        segments, _ = stt["model"].transcribe(audio, language="en", beam_size=1, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(200, {"ok": True, "voices": VOICES, "speaking": VOICE_DEVICE, "listening": stt["state"]})

    def do_POST(self):
        if self.path == "/transcribe":
            body = self.rfile.read(int(self.headers["Content-Length"]))
            try:
                return self._json(200, {"text": transcribe(body)})
            except Exception as e:
                return self._json(500, {"error": str(e)})
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        text = req.get("text")
        if not isinstance(text, str) or not text.strip():
            return self._json(400, {"error": "text is required and must not be empty"})
        voice = req.get("voice") or "am_adam"
        if voice not in VOICES:
            return self._json(400, {"error": f"unknown voice {voice}"})
        lang = "en-gb" if voice.startswith("b") else "en-us"
        with synth_lock:
            samples, rate = kokoro.create(text, voice=voice, speed=float(req.get("speed") or 1.0), lang=lang)
        buf = io.BytesIO()
        sf.write(buf, samples, rate, format="WAV")
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(buf.tell()))
        self.end_headers()
        self.wfile.write(buf.getvalue())

    def log_message(self, *args):
        pass


threading.Thread(target=load_stt, daemon=True).start()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 47811
print(f"ready on {port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

# SPIKE - throwaway. Local Kokoro voice server. Runs on the HOST (outside the VS Code Flatpak).
# Start: uv run --python 3.12 --with kokoro-onnx --with soundfile spike/tts_server.py
# POST /speak {"text": "..."} -> audio/wav
import io, json, os, time
from http.server import BaseHTTPRequestHandler, HTTPServer
import soundfile as sf
from kokoro_onnx import Kokoro

CACHE = os.path.expanduser("~/.cache/coding-tutor")
t = time.time()
kokoro = Kokoro(f"{CACHE}/kokoro-v1.0.onnx", f"{CACHE}/voices-v1.0.bin")
print(f"model loaded in {time.time()-t:.1f}s, providers={kokoro.sess.get_providers()}", flush=True)

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        t = time.time()
        samples, sr = kokoro.create(body["text"], voice=body.get("voice", "af_heart"), speed=1.0, lang="en-us")
        buf = io.BytesIO(); sf.write(buf, samples, sr, format="WAV")
        print(f"synth {len(samples)/sr:.1f}s of audio in {time.time()-t:.2f}s", flush=True)
        self.send_response(200); self.send_header("Content-Type", "audio/wav"); self.end_headers()
        self.wfile.write(buf.getvalue())
    def log_message(self, *a): pass

HTTPServer(("127.0.0.1", 47811), H).serve_forever()

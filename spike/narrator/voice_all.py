# SPIKE - throwaway. Speak every line of the comparison with the default voice (Adam).
import json, os, subprocess, sys
import soundfile as sf
from kokoro_onnx import Kokoro
C = os.path.expanduser("~/.cache/coding-tutor")
k = Kokoro(f"{C}/kokoro-v1.0.onnx", f"{C}/voices-v1.0.bin")
OUT = "previews/narrator"
h = json.load(open("spike/narrator/haiku-results.json"))["results"]
s = json.load(open("spike/narrator/sonnet-results.json"))["results"]
for a, b in zip(h, s):
    for who, text in (("coder", " ".join(c for c in a["coder"] if c)), ("haiku", a["haiku"].get("say")), ("sonnet", b["haiku"].get("say"))):
        if not text:
            continue
        wav = f"{OUT}/{a['event']}-{who}.wav"
        if os.path.exists(wav[:-4] + ".mp3"):
            continue
        samples, rate = k.create(text, voice="am_adam", speed=1.0, lang="en-us")
        sf.write(wav, samples, rate)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-b:a", "64k", wav[:-4] + ".mp3"], check=True)
        os.remove(wav)
        print(wav[:-4] + ".mp3", flush=True)

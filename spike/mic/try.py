# SPIKE - throwaway. Push-to-talk test: record with parecord, transcribe locally,
# report latency, and keep every take on a replay page in previews/mic.html.
import glob, html, os, subprocess, sys, time, warnings
warnings.filterwarnings("ignore")

import nvidia  # CUDA libraries must be on the loader path before the process starts
if os.environ.get("CT_LIBS") != "1":
    os.environ["LD_LIBRARY_PATH"] = ":".join(d for r in nvidia.__path__ for d in glob.glob(r + "/*/lib"))
    os.environ["CT_LIBS"] = "1"
    os.execv(sys.executable, [sys.executable] + sys.argv)

import numpy as np, soundfile as sf
from faster_whisper import WhisperModel

ROOT = os.getcwd()
TAKES = os.path.join(ROOT, "previews", "mic")
PAGE = os.path.join(ROOT, "previews", "mic.html")
os.makedirs(TAKES, exist_ok=True)
source = subprocess.run(["pactl", "get-default-source"], capture_output=True, text=True).stdout.strip()
if len(sys.argv) > 1 and sys.argv[1] == "laptop":
    sources = subprocess.run(["pactl", "list", "sources", "short"], capture_output=True, text=True).stdout.split("\n")
    source = next(l.split("\t")[1] for l in sources if "\talsa_input" in l)

print("Loading speech recognition (GPU large-v3-turbo, CPU small.en)...", flush=True)
gpu = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
cpu = WhisperModel("small.en", device="cpu", compute_type="int8")
silence = np.zeros(16000, dtype=np.float32)
list(gpu.transcribe(silence, language="en")[0])  # warm-up: the first GPU call is slow

def transcribe(model, audio):
    t = time.time()
    segs, _ = model.transcribe(audio, language="en", beam_size=1, vad_filter=True)
    text = " ".join(s.text.strip() for s in segs).strip()
    return text or "(nothing heard)", time.time() - t

def write_page(takes):
    rows = "".join(
        f"""<section><h2>Take {t['n']} ({t['mic']})</h2><audio controls src="mic/{t['file']}"></audio>
<p><b>GPU, large-v3-turbo</b> ({t['gpu_s']:.2f}s): {html.escape(t['gpu'])}</p>
<p><b>CPU, small.en</b> ({t['cpu_s']:.2f}s): {html.escape(t['cpu'])}</p>
<p class="dim">{t['dur']:.1f}s recorded; first sound {t['first']}; stop to text {t['total']:.2f}s</p></section>"""
        for t in reversed(takes))
    open(PAGE, "w").write(f"""<!doctype html><meta charset="utf-8"><title>Mic spike takes</title>
<style>:root{{color-scheme:light dark}} body{{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px}}
section{{border:1px solid #8885;border-radius:8px;padding:8px 16px;margin:12px 0}} h2{{font-size:1rem}} audio{{width:100%}} .dim{{opacity:.7}}</style>
<h1>Mic spike takes</h1><p>Newest first. Reload after each take.</p>{rows}""")

takes = []
print(f"\nMicrophone: {source}")
print("Replay page: http://127.0.0.1:47820/mic.html\n")
while True:
    if input("Press Enter, then talk (q + Enter to quit): ").strip().lower() == "q":
        break
    n = len(takes) + 1
    path = os.path.join(TAKES, f"take-{n}.wav")
    rec = subprocess.Popen(["parecord", f"--device={source}", "--channels=1", "--rate=16000", "--format=s16le", "--file-format=wav", path])
    input("  Recording... press Enter when you are done. ")
    stopped = time.time()
    rec.terminate(); rec.wait()
    try:
        audio, _ = sf.read(path, dtype="float32")
    except Exception:
        audio = np.zeros(0, dtype=np.float32)
    if len(audio) < 1600:
        print("  That was too short to hear anything; try again and talk for a second or more.\n")
        continue
    level = np.abs(audio)
    loud = np.nonzero(level > max(0.02, level.max() * 0.2))[0]
    first = f"at {loud[0] / 16000:.2f}s" if len(loud) else "never (silence?)"
    g, gs = transcribe(gpu, audio)
    total = time.time() - stopped
    c, cs = transcribe(cpu, audio)
    takes.append(dict(mic=source.split(".")[0], n=n, file=f"take-{n}.wav", dur=len(audio) / 16000, first=first, gpu=g, gpu_s=gs, cpu=c, cpu_s=cs, total=total))
    write_page(takes)
    print(f"  GPU ({gs:.2f}s): {g}\n  CPU ({cs:.2f}s): {c}\n  {len(audio)/16000:.1f}s recorded, first sound {first}, stop to text {total:.2f}s\n")

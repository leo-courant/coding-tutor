# SPIKE - throwaway. Builds previews/narrator-product.html from the replay of the
# recorded session through the product's narrator (product-results.json, made by
# replay.js), with audio from the running Coding Tutor voice server.
import html, json, os, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "previews")
r = json.load(open(os.path.join(HERE, "product-results.json")))
events = json.load(open(os.path.join(HERE, "events.json")))

WHAT = {
    1: "The coder opens the transcript code to understand the task. This is where the problem should be stated.",
    4: "You ask for a simpler explanation.",
    9: "The coder changes the transcript code: a helper that says a length of time in words, and the ending now records when the session ended and how long it took.",
    12: "The coder looks up where the extension starts and ends a session.",
    15: "Change: remember the moment the session starts.",
    16: "Change: always close the transcript at the end (before, it was skipped when there was no recap), and pass along the start time.",
    17: "Change: add a slot to keep the start time in.",
    18: "The coder looks up the new line numbers.",
    21: "You ask it to go faster and just skim.",
    23: "The coder writes three tests and runs them. All pass.",
    27: "You ask: where did you add this? Show me.",
    26: "The coder is done. Time for the recap.",
}
# My verdicts on accuracy. ok = accurate, part = partly, bad = wrong or misleading.
V = {
    1: ("ok", "States the problem: the transcript records when a session started and never when it ended. Like the experiment, it misses that sessions without a recap got no ending at all."),
    4: ("ok", "Simple and correct. No pointer: the coder read the file with a shell command rather than its file tool, so the narrator has no file lines to point at."),
    9: ("ok", "Accurate and complete, including the no-recap case, with the pointer on the change."),
    12: ("ok", "Names the gap in the caller exactly (only finishes when there is a recap, no start time yet). The experiment's Sonnet was vague here."),
    15: ("ok", "Accurate, pointing at the new line."),
    16: ("ok", "Says what changed and why (a session without a recap still gets its length). The experiment's Sonnet gave only the what."),
    17: ("ok", "A short sentence for a small edit, on the right line."),
    18: None,
    21: ("ok", "Accurate, and switches to the short version."),
    23: ("ok", "Accurate."),
    27: ("part", "Names all three places and points at two, on the lines where they are now. The start-time line is named but not highlighted."),
    26: ("ok", "Accurate and useful: says what to check yourself, and that nothing is committed."),
}
MARK = {"ok": ("✓", "Accurate"), "part": ("~", "Partly"), "bad": ("✗", "Wrong or misleading")}
COUNT = {k: sum(1 for v in V.values() if v and v[0] == k) for k in MARK}


def moment(turn):
    if "ended its turn" in turn["prompt"]:
        return 26
    if "Show me" in turn["prompt"]:
        return 27
    return turn["at"]


def speak(text, mp3):
    if os.path.exists(mp3):
        return
    req = urllib.request.Request("http://127.0.0.1:47811/speak", data=json.dumps({"text": text, "voice": "am_adam", "speed": 1.0}).encode(),
                                 headers={"Content-Type": "application/json"})
    wav = mp3[:-4] + ".wav"
    with urllib.request.urlopen(req, timeout=120) as res, open(wav, "wb") as f:
        f.write(res.read())
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-b:a", "64k", mp3], check=True)
    os.remove(wav)


coder_by = {}
for c in r["coder"]:
    coder_by.setdefault(c["at"], []).append(c["text"])
# Which coder narrations belong to which moment, as in the experiment.
TRUTH = {1: [2, 3], 4: [6, 7], 9: [8, 10, 11], 12: [14], 15: [19], 16: [20], 17: [], 18: [], 21: [22], 23: [25], 27: [28, 29, 30], 26: [26]}


def coder_text(m):
    out = []
    for j in TRUTH[m]:
        e = events[j]
        out.append(e.get("text") or e.get("recap") or "")
    return " ".join(t for t in out if t)


cards = []
for n, turn in enumerate(r["turns"], 1):
    m = moment(turn)
    parts = (turn["answer"] or {}).get("parts") or []
    said = " ".join(p["say"] for p in parts)
    pointers = turn.get("pointers") or []
    if said:
        speak(said, os.path.join(OUT, "narrator", f"{m}-product.mp3"))
    ctext = coder_text(m)
    coder_audio = f'<audio controls preload="none" src="narrator/{m}-coder.mp3"></audio>' if ctext and os.path.exists(os.path.join(OUT, "narrator", f"{m}-coder.mp3")) else ""
    rows = []
    for i, p in enumerate(parts):
        ptr = pointers[i] if i < len(pointers) else None
        where = f'<span class="ptr">{html.escape(os.path.basename(ptr["file"]))} lines {ptr["startLine"]}–{ptr["endLine"]}</span>' if ptr else '<span class="ptr none">no pointer</span>'
        rows.append(f'<li>{html.escape(p["say"])} {where}</li>')
    verdict = V.get(m)
    badge = f'<div class="verdict {verdict[0]}"><b>{MARK[verdict[0]][0]} {MARK[verdict[0]][1]}</b> {html.escape(verdict[1])}</div>' if verdict else '<div class="verdict ref">Not worth mentioning: the narrator stayed quiet.</div>'
    new_audio = f'<audio controls preload="none" src="narrator/{m}-product.mp3"></audio>' if said else ""
    new_body = f'<ul class="parts">{"".join(rows)}</ul>' if rows else '<p><i class="dim">Stayed quiet.</i></p>'
    old_body = f"<p>{html.escape(ctext)}</p>" if ctext else '<p><i class="dim">Said nothing here.</i></p>'
    pick = lambda who: f'<label class="pick"><input type="radio" name="m{n}" value="{who}"> Clearest</label>' if said and ctext else ""
    cards.append(f'''<section class="moment"><div class="what"><span class="n">{n}</span>{html.escape(WHAT[m])}</div><div class="cols">
<div class="col coder"><h4>Coder narrating itself (that day)</h4>{coder_audio}{old_body}{pick("coder")}</div>
<div class="col narr"><h4>The new narrator (Sonnet)</h4>{new_audio}{new_body}{badge}{pick("narrator")}</div></div></section>''')
picks = sum(1 for c in cards if 'type="radio"' in c)

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Separate narrator replay</title>
<style>
:root {{ color-scheme: dark; --green: #3fb950; --amber: #f0a020; --red: #e5484d; --blue: #3b8eea; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; padding: 24px 16px 60px; background: #0d0d0f; color: #d6d6da; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 1100px; margin: 0 auto; }}
h1 {{ font-size: 22px; margin: 0 0 6px; }}
.lead {{ color: #a3a3ab; max-width: 860px; }}
.summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 18px 0 8px; }}
.box {{ background: #16161a; border: 1px solid #26262c; border-radius: 12px; padding: 14px 16px; }}
.box h3 {{ margin: 0 0 6px; font-size: 14px; }}
.box.new {{ border-color: #2f5f3a; }}
.score {{ display: flex; flex-wrap: wrap; gap: 10px; font-size: 14px; margin: 4px 0; }}
.score span b {{ font-size: 18px; }}
.g {{ color: var(--green); }} .a {{ color: var(--amber); }} .r {{ color: var(--red); }}
.dim {{ color: #85858e; }}
.conclusion {{ background: #17161a; border-left: 3px solid var(--green); padding: 12px 16px; border-radius: 8px; margin: 14px 0 24px; }}
.conclusion li {{ margin: 4px 0; }}
#tally {{ position: sticky; top: 0; z-index: 3; background: #141417; border: 1px solid #2a2a30; border-radius: 10px; padding: 9px 14px; margin-bottom: 16px; }}
.moment {{ margin: 0 0 18px; border: 1px solid #24242a; border-radius: 14px; overflow: hidden; }}
.what {{ background: #17171b; padding: 10px 14px; display: flex; gap: 10px; align-items: baseline; }}
.n {{ flex: none; width: 24px; height: 24px; border-radius: 50%; background: #2a2a31; display: grid; place-items: center; font-size: 12px; font-weight: 600; }}
.cols {{ display: grid; grid-template-columns: 1fr 1fr; }}
.col {{ padding: 12px 14px; border-top: 1px solid #222227; display: flex; flex-direction: column; gap: 8px; min-width: 0; }}
.col + .col {{ border-left: 1px solid #222227; }}
.col h4 {{ margin: 0; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: #9a9aa3; }}
.col.coder h4 {{ color: #9cc2ef; }} .col.narr h4 {{ color: #8fd19e; }}
.col p {{ margin: 0; }}
.parts {{ margin: 0; padding-left: 18px; }} .parts li {{ margin: 0 0 6px; }}
.ptr {{ display: inline-block; font: 12px ui-monospace, monospace; background: #2a2410; color: #f0c040; border-radius: 6px; padding: 1px 6px; margin-left: 4px; }}
.ptr.none {{ background: #1e1e23; color: #85858e; }}
audio {{ width: 100%; height: 34px; }}
.verdict {{ font-size: 13px; padding: 7px 9px; border-radius: 8px; background: #1b1b20; }}
.verdict.ok {{ border-left: 3px solid var(--green); }} .verdict.ok b {{ color: var(--green); }}
.verdict.part {{ border-left: 3px solid var(--amber); }} .verdict.part b {{ color: var(--amber); }}
.verdict.bad {{ border-left: 3px solid var(--red); }} .verdict.bad b {{ color: var(--red); }}
.verdict.ref {{ border-left: 3px solid var(--blue); color: #9a9aa3; }}
.pick {{ font-size: 13px; color: #a3a3ab; cursor: pointer; margin-top: auto; }}
@media (max-width: 760px) {{ .cols {{ grid-template-columns: 1fr; }} .col + .col {{ border-left: 0; }} }}
</style></head><body><main>
<h1>Ticket 0001: the separate narrator, replayed</h1>
<p class="lead">The same session as the experiment ("make the transcript record how long the session took"), replayed through what was built: the coder's hooks report each step, the session coordinator hands it to the narrator, and each edit's location is passed in exactly, then followed as later edits move it. The narrator saw only what the coder's tools returned, never the coder's own narration. On the left, what the coder said that day; on the right, the new narrator, with the lines its pointer showed. The accuracy verdicts are mine; which is <i>clearer</i> is yours to judge.</p>
<div class="summary">
  <div class="box new"><h3>New narrator (Sonnet)</h3><div class="score"><span class="g"><b>{COUNT['ok']}</b> accurate</span><span class="a"><b>{COUNT['part']}</b> partly</span><span class="r"><b>{COUNT['bad']}</b> wrong</span></div><div class="dim">${r['costUsd']:.3f} for the session, {len(r['turns'])} narrator turns, about 2 s each. Every pointer on the right lines.</div></div>
  <div class="box"><h3>Experiment's Sonnet (Nov 24)</h3><div class="score"><span class="g"><b>8</b> accurate</span><span class="a"><b>3</b> partly</span><span class="r"><b>0</b> wrong</span></div><div class="dim">$0.11 for the session. Could not point on "show me".</div></div>
  <div class="box"><h3>Coder narrating itself</h3><div class="dim">About $0.65 for the session: 11 narration-only calls, each re-reading the whole conversation.</div></div>
</div>
<div class="conclusion"><b>What changed since the experiment</b><ul>
<li><b>The restatement comes at the first read</b>, before any change, as the session script asks.</li>
<li><b>"Show me" can walk through several places</b>, one sentence per place, each with its own pointer. Edits are pointed at by number, so a pointer follows the code when a later edit moves it.</li>
<li><b>No broken answers</b>: the narrator answers through the CLI's structured output.</li>
<li>In a live run with a real coder, the narrator passed your "also mention it in the docstring" to the coder as the reason its next step was held; the coder did it, and the fix was narrated.</li>
</ul></div>
<div id="tally">Your picks for clearer: <b id="t">none yet</b></div>
{''.join(cards)}
</main>
<script>
const update = () => {{
  const c = {{ coder: 0, narrator: 0 }};
  document.querySelectorAll('input[type=radio]:checked').forEach((i) => c[i.value]++);
  const total = c.coder + c.narrator;
  document.getElementById('t').textContent = total ? `Coder ${{c.coder}}, new narrator ${{c.narrator}} (of {picks} moments)` : 'none yet';
}};
document.querySelectorAll('input[type=radio]').forEach((i) => i.addEventListener('change', update));
</script></body></html>"""
open(os.path.join(OUT, "narrator-product.html"), "w").write(page)
print("written", COUNT)

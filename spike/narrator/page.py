# SPIKE - throwaway. Builds previews/narrator.html from the two runs and my verdicts.
import html, json
h = json.load(open("spike/narrator/haiku-results.json"))
s = json.load(open("spike/narrator/sonnet-results.json"))
WHAT = {
    1: "The coder opens the transcript code to understand the task. This is where the narrator should explain the problem.",
    4: "You ask for a simpler explanation.",
    9: "The coder changes the transcript code: a helper that says a length of time in words, and the ending now records when the session ended and how long it took.",
    12: "The coder looks up where the extension starts and ends a session.",
    15: "Change: remember the moment the session starts.",
    16: "Change: always close the transcript at the end (before, it was skipped when there was no recap), and pass along the start time.",
    17: "Change: add a slot to keep the start time in.",
    21: "You ask it to go faster and just skim.",
    23: "The coder writes three tests and runs them. All pass.",
    26: "The coder is done. Time for the recap.",
    27: "You ask: where did you add this? Show me.",
}
# My verdicts on accuracy: (mark, reason). ok = accurate, part = partly, bad = wrong or misleading.
V = {
    "haiku": {
        1: ("bad", "Describes what the coder is reading, but never says what the problem is: transcripts record a start time and no end."),
        4: ("bad", "Simpler, but still no problem stated. Its pointer names a folder that does not exist, so the editor could not open it."),
        9: ("ok", "Accurate. Misses that the ending now also works without a recap."),
        12: ("bad", "Misleading: presents the old \"only when there is a recap\" behaviour as a confirmation, when it is the gap about to be fixed."),
        15: ("ok", "Accurate."),
        16: ("part", "Says what changed, not why (sessions without a recap now get closed too)."),
        17: ("ok", "Accurate. Reads an identifier aloud (\"startedAt\"), which the rules forbid."),
        21: ("ok", "Accurate, and switches to a shorter style."),
        23: ("part", "Overclaims: passing unit tests do not prove the feature works in a real session."),
        26: ("ok", "Accurate and useful. Cannot know the extension needs reinstalling, since that is not visible to it."),
        27: ("bad", "Cannot point: admits it has no line numbers, and its pointer names a folder that does not exist."),
    },
    "sonnet": {
        1: ("ok", "States the problem: only the start is recorded, so nothing says how long a session ran. Misses the no-recap gap."),
        4: ("ok", "Simple and correct, with a pointer on the right function."),
        9: ("ok", "Accurate and complete, including the no-recap case."),
        12: ("part", "Vague: the remark about \"lining up\" with the ending value is confusing."),
        15: ("ok", "Accurate."),
        16: ("part", "Says what changed, not why."),
        17: ("ok", "Accurate."),
        21: ("ok", "Accurate."),
        23: ("ok", "Accurate and precise."),
        26: ("ok", "Accurate, with a sharp edge case to check yourself."),
        27: ("part", "Names the right places in words, but highlights only one area, and at the finish function's old position: the code moved down when the helper was added above it."),
    },
}
MARK = {"ok": ("✓", "Accurate"), "part": ("~", "Partly"), "bad": ("✗", "Wrong or misleading")}
def tally(m):
    t = {"ok": 0, "part": 0, "bad": 0}
    for v in V[m].values():
        t[v[0]] += 1
    return t
th, ts = tally("haiku"), tally("sonnet")

cards = []
for n, (a, b) in enumerate(zip(h["results"], s["results"]), 1):
    ev = a["event"]
    cols = []
    for who, label, text, verdict in (
        ("coder", "Coder (today)", " ".join(c for c in a["coder"] if c), None),
        ("haiku", "Haiku narrator", a["haiku"].get("say"), V["haiku"][ev]),
        ("sonnet", "Sonnet narrator", b["haiku"].get("say"), V["sonnet"][ev]),
    ):
        audio = f'<audio controls preload="none" src="narrator/{ev}-{who}.mp3"></audio>' if text else ""
        body = html.escape(text) if text else '<i class="dim">Said nothing here.</i>'
        badge = f'<div class="verdict {verdict[0]}"><b>{MARK[verdict[0]][0]} {MARK[verdict[0]][1]}</b> {html.escape(verdict[1])}</div>' if verdict else '<div class="verdict ref">The reference: what was actually said.</div>'
        pick = f'<label class="pick"><input type="radio" name="m{ev}" value="{who}"> Clearest</label>'
        cols.append(f'<div class="col {who}"><h4>{label}</h4>{audio}<p>{body}</p>{badge}{pick}</div>')
    cards.append(f'<section class="moment"><div class="what"><span class="n">{n}</span>{html.escape(WHAT[ev])}</div><div class="cols">{"".join(cols)}</div></section>')

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Narrator experiment</title>
<style>
:root {{ color-scheme: dark; --green: #3fb950; --amber: #f0a020; --red: #e5484d; --blue: #3b8eea; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; padding: 24px 16px 60px; background: #0d0d0f; color: #d6d6da; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 1180px; margin: 0 auto; }}
h1 {{ font-size: 22px; margin: 0 0 6px; }}
.lead {{ color: #a3a3ab; max-width: 860px; }}
.summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 18px 0 8px; }}
.box {{ background: #16161a; border: 1px solid #26262c; border-radius: 12px; padding: 14px 16px; }}
.box h3 {{ margin: 0 0 6px; font-size: 14px; }}
.score {{ display: flex; gap: 10px; font-size: 14px; margin: 4px 0; }}
.score span b {{ font-size: 18px; }}
.g {{ color: var(--green); }} .a {{ color: var(--amber); }} .r {{ color: var(--red); }}
.dim {{ color: #85858e; }}
.conclusion {{ background: #17161a; border-left: 3px solid var(--amber); padding: 12px 16px; border-radius: 8px; margin: 14px 0 24px; }}
.conclusion li {{ margin: 4px 0; }}
#tally {{ position: sticky; top: 0; z-index: 3; background: #141417; border: 1px solid #2a2a30; border-radius: 10px; padding: 9px 14px; margin-bottom: 16px; }}
.moment {{ margin: 0 0 18px; border: 1px solid #24242a; border-radius: 14px; overflow: hidden; }}
.what {{ background: #17171b; padding: 10px 14px; display: flex; gap: 10px; align-items: baseline; }}
.n {{ flex: none; width: 24px; height: 24px; border-radius: 50%; background: #2a2a31; display: grid; place-items: center; font-size: 12px; font-weight: 600; }}
.cols {{ display: grid; grid-template-columns: repeat(3, 1fr); }}
.col {{ padding: 12px 14px; border-top: 1px solid #222227; display: flex; flex-direction: column; gap: 8px; }}
.col + .col {{ border-left: 1px solid #222227; }}
.col h4 {{ margin: 0; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: #9a9aa3; }}
.col.coder h4 {{ color: #9cc2ef; }}
.col p {{ margin: 0; flex: 1; }}
audio {{ width: 100%; height: 34px; }}
.verdict {{ font-size: 13px; padding: 7px 9px; border-radius: 8px; background: #1b1b20; }}
.verdict.ok {{ border-left: 3px solid var(--green); }} .verdict.ok b {{ color: var(--green); }}
.verdict.part {{ border-left: 3px solid var(--amber); }} .verdict.part b {{ color: var(--amber); }}
.verdict.bad {{ border-left: 3px solid var(--red); }} .verdict.bad b {{ color: var(--red); }}
.verdict.ref {{ border-left: 3px solid var(--blue); color: #9a9aa3; }}
.pick {{ font-size: 13px; color: #a3a3ab; cursor: pointer; }}
@media (max-width: 820px) {{ .cols {{ grid-template-columns: 1fr; }} .col + .col {{ border-left: 0; }} }}
</style></head><body><main>
<h1>Narrator experiment: can a cheaper model explain the coder's work?</h1>
<p class="lead">I replayed the last narrated session ("make the transcript record how long the session took") to two narrator models. They saw only what a separate narrator would see: the files the coder read, the commands it ran and their output, each edit exactly, and what you said. They never saw the coder's own narration. Below, each moment shows what the coder said that day next to what each narrator said, with audio. The verdicts on accuracy are mine; which one is <i>clearest</i> is yours to judge.</p>
<div class="summary">
  <div class="box"><h3>Haiku narrator</h3><div class="score"><span class="g"><b>{th['ok']}</b> accurate</span><span class="a"><b>{th['part']}</b> partly</span><span class="r"><b>{th['bad']}</b> wrong or misleading</span></div><div class="dim">Cost for the whole session: ${h['cost_usd']:.3f}. About 4 seconds per narration.</div></div>
  <div class="box"><h3>Sonnet narrator</h3><div class="score"><span class="g"><b>{ts['ok']}</b> accurate</span><span class="a"><b>{ts['part']}</b> partly</span><span class="r"><b>{ts['bad']}</b> wrong or misleading</span></div><div class="dim">Cost for the whole session: ${s['cost_usd']:.2f}. About 4 seconds per narration.</div></div>
  <div class="box"><h3>Coder narrating itself (today)</h3><div class="dim">11 extra calls of the coding model in that session, each re-reading the whole conversation: roughly half the session's cost.</div></div>
</div>
<div class="conclusion"><b>What I conclude, as the engineer checking accuracy</b><ul>
<li><b>Haiku describes <i>what</i> changed well, but misses the <i>problem</i> and the <i>why</i></b>, which are the parts that matter most for following along. Twice it also invented a folder name, so the editor could not have shown the code.</li>
<li><b>Sonnet, given exactly the same information, got the problem right</b> and was never wrong. So the gap is the model, not missing information.</li>
<li><b>Neither could point properly when you said "show me"</b>, because neither knew where the edits landed. That is a plumbing fix, not a model fix: the narrator should be handed the exact locations of each edit instead of having to work them out.</li>
<li><b>Twice, Sonnet broke the answer format</b> (it wrote its narration, then repeated it as JSON). The real product would use the API's structured outputs, which rule that out.</li>
<li><b>Neither knew <i>why</i> the coder closed transcripts without a recap.</b> Only the coder knew that. A one-line "why" from the coder per change (ordinary text, no extra call) would close this gap.</li>
</ul></div>
<div id="tally">Your picks for clearest: <b id="t">none yet</b></div>
{''.join(cards)}
</main>
<script>
const update = () => {{
  const c = {{ coder: 0, haiku: 0, sonnet: 0 }};
  document.querySelectorAll('input[type=radio]:checked').forEach((i) => c[i.value]++);
  const total = c.coder + c.haiku + c.sonnet;
  document.getElementById('t').textContent = total ? `Coder ${{c.coder}}, Haiku ${{c.haiku}}, Sonnet ${{c.sonnet}} (of {len(cards)} moments)` : 'none yet';
}};
document.querySelectorAll('input[type=radio]').forEach((i) => i.addEventListener('change', update));
</script></body></html>"""
open("previews/narrator.html", "w").write(page)
print("written", th, ts)

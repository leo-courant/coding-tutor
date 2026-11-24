// The narrator speaks a narration sentence by sentence and obeys the engineer's
// controls: pause, resume, interrupt and skip. It knows nothing about VS Code;
// the voice and the player are passed in, so it can be tested on its own.
const { splitSentences, readingTimeMs } = require('./sentences');

// The engineer's controls, shared by the panel (which changes them) and the
// narrator (which waits on them).
class Control {
  constructor() {
    this.paused = false;
    this.message = null; // what the engineer said, until the agent picks it up
    this.skipped = false;
    this.stopCurrent = null; // cuts off the sentence being played
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of [...this.listeners]) fn();
  }

  stop() {
    if (this.stopCurrent) this.stopCurrent();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.stop();
    this.changed();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.changed();
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  interrupt(text) {
    this.message = this.message ? `${this.message}\n${text}` : text;
    this.paused = false;
    this.stop();
    this.changed();
  }

  skip() {
    this.skipped = true;
    this.stop();
    this.changed();
  }

  takeMessage() {
    const message = this.message;
    this.message = null;
    this.changed();
    return message;
  }

  reset() {
    this.paused = false;
    this.message = null;
    this.skipped = false;
    this.changed();
  }

  // Resolves 'resumed', 'interrupted', or 'timeout' if still paused after `ms`.
  waitUntilResumed(ms) {
    return new Promise((resolve) => {
      const check = () => {
        if (this.message) return 'interrupted';
        if (!this.paused) return 'resumed';
        return null;
      };
      const now = check();
      if (now) return resolve(now);
      const timer = setTimeout(() => { off(); resolve('timeout'); }, ms);
      const off = this.onChange(() => {
        const r = check();
        if (r) { clearTimeout(timer); off(); resolve(r); }
      });
    });
  }
}

// A stand-in for the voice when it is muted or broken: the sentence is "played"
// for as long as it takes to read, and can be stopped like real audio.
function silentPlay(ms) {
  let stop;
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    stop = () => { clearTimeout(timer); resolve(); };
  });
  return { done, stop };
}

// synth(sentence, cfg) -> Promise<audio>; play(audio) -> {done, stop};
// isMuted() is read before every sentence so muting takes effect at once.
function createNarrator({ control, synth, play, isMuted, quiet = silentPlay, readingTime = readingTimeMs }) {
  let held = null; // what is left of a narration when a pause outlasted the call

  async function run(sentences, index, cfg, holdLimitMs) {
    control.skipped = false;
    let voiceError = null;
    let wasMuted = false;
    const clips = new Map();
    const clip = (i) => {
      if (!clips.has(i)) {
        clips.set(i, synth(sentences[i], cfg).catch((e) => { voiceError = voiceError || e.message; return null; }));
      }
      return clips.get(i);
    };

    while (index < sentences.length) {
      if (control.message) return { outcome: 'interrupted', voiceError, muted: wasMuted };
      if (control.paused) {
        const r = await control.waitUntilResumed(holdLimitMs);
        if (r === 'interrupted') return { outcome: 'interrupted', voiceError, muted: wasMuted };
        if (r === 'timeout') {
          held = { sentences, index, cfg };
          return { outcome: 'paused', voiceError, muted: wasMuted };
        }
      }

      const muted = isMuted();
      wasMuted = wasMuted || muted;
      const audio = muted || voiceError ? null : await clip(index);
      if (!muted && !voiceError && index + 1 < sentences.length) clip(index + 1); // get the next one ready
      if (control.message || control.paused) continue;

      const playing = audio ? play(audio) : quiet(readingTime(sentences[index]));
      control.stopCurrent = playing.stop;
      try {
        await playing.done;
      } catch (e) {
        voiceError = voiceError || e.message; // the player failed: say it again, silently
        continue;
      } finally {
        control.stopCurrent = null;
      }

      if (control.message) return { outcome: 'interrupted', voiceError, muted: wasMuted };
      if (control.paused) continue; // cut off by a pause: this sentence is said again on resume
      if (control.skipped) return { outcome: 'skipped', voiceError, muted: wasMuted };
      if (isMuted() !== muted) continue; // muted or unmuted mid-sentence: say it again the new way
      index += 1;
    }
    return { outcome: 'spoken', voiceError, muted: wasMuted };
  }

  return {
    // Speak a whole narration. Resolves when it has been said, or earlier if the
    // engineer interrupted, skipped, or paused for longer than `holdLimitMs`.
    narrate(text, cfg, holdLimitMs) {
      held = null;
      return run(splitSentences(text), 0, cfg, holdLimitMs);
    },

    // Called while paused: waits for the engineer, then says what was left.
    async resumeHeld(holdLimitMs) {
      if (held) {
        const { sentences, index, cfg } = held;
        held = null;
        return run(sentences, index, cfg, holdLimitMs);
      }
      const r = await control.waitUntilResumed(holdLimitMs);
      if (r === 'interrupted') return { outcome: 'interrupted' };
      if (r === 'timeout') return { outcome: 'paused' };
      return { outcome: 'resumed' };
    },

    hasHeld() {
      return held !== null;
    },
  };
}

module.exports = { Control, createNarrator, silentPlay };

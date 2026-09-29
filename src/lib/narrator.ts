import { useSyncExternalStore } from "react";

/**
 * Text-to-speech narrator built on the browser's Web Speech API, so it works
 * offline and costs nothing. A "segment" is one readable block on the page
 * (a paragraph, a list); `key` matches a `data-read` attribute in the DOM so
 * the page can highlight what is being read.
 */
export interface Segment {
  key: string;
  text: string;
  section?: string;
}

export interface NarratorState {
  supported: boolean;
  playing: boolean;
  index: number;
  segments: Segment[];
  rate: number;
  voiceURI: string;
  voices: SpeechSynthesisVoice[];
  title: string;
}

const PREFS = "margin:narrator";
const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

function loadPrefs(): { rate: number; voiceURI: string } {
  try {
    return { rate: 1, voiceURI: "", ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return { rate: 1, voiceURI: "" };
  }
}

/** Split long text into sentence groups: some engines cut off utterances after ~15 seconds. */
function chunk(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Rank voices so the default is a natural-sounding one in the reader's language. */
function rankVoices(voices: SpeechSynthesisVoice[]) {
  const lang = (navigator.language || "en-US").toLowerCase();
  const base = lang.split("-")[0];
  const score = (v: SpeechSynthesisVoice) => {
    const vl = v.lang.toLowerCase();
    let s = 0;
    if (vl === lang) s += 40;
    else if (vl.startsWith(base)) s += 25;
    if (/natural|neural|premium|enhanced/i.test(v.name)) s += 20;
    if (/google|samantha|daniel|karen|moira|serena|ava|allison|aria|jenny|guy/i.test(v.name)) s += 8;
    if (v.localService) s += 2;
    if (/compact|eloquence|whisper|bells|bad news|zarvox|trinoids|albert|jester|organ|bubbles|boing|cellos|superstar|wobble|grandma|grandpa|rocko|shelley|flo|reed|sandy|eddy/i.test(v.name)) s -= 30;
    return s;
  };
  return voices
    .filter((v) => v.lang.toLowerCase().startsWith(base))
    .sort((a, b) => score(b) - score(a))
    .concat(voices.filter((v) => !v.lang.toLowerCase().startsWith(base)));
}

class Narrator {
  private state: NarratorState;
  private listeners = new Set<() => void>();
  private chunks: string[] = [];
  private chunkIndex = 0;
  private token = 0;

  constructor() {
    const prefs = loadPrefs();
    this.state = {
      supported: Boolean(synth),
      playing: false,
      index: 0,
      segments: [],
      rate: prefs.rate,
      voiceURI: prefs.voiceURI,
      voices: [],
      title: "",
    };
    if (synth) {
      const refresh = () => this.set({ voices: rankVoices(synth.getVoices()) });
      refresh();
      synth.addEventListener?.("voiceschanged", refresh);
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<NarratorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ rate: this.state.rate, voiceURI: this.state.voiceURI }));
    } catch {
      /* ignore */
    }
  }

  /** Replace the reading queue (does not start playback). */
  load(segments: Segment[], title: string) {
    this.stop();
    this.set({ segments, title, index: 0 });
  }

  play(index = this.state.index) {
    if (!synth || !this.state.segments.length) return;
    const i = Math.max(0, Math.min(index, this.state.segments.length - 1));
    const resume = i === this.state.index && this.chunks.length > 0 && !this.state.playing;
    if (!resume) {
      this.chunks = chunk(this.state.segments[i].text);
      this.chunkIndex = 0;
    }
    this.set({ index: i, playing: true });
    this.speak();
  }

  private speak() {
    if (!synth) return;
    const token = ++this.token;
    synth.cancel();
    const text = this.chunks[this.chunkIndex];
    if (text === undefined) return this.advance(token);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.state.rate;
    const voice = this.state.voices.find((v) => v.voiceURI === this.state.voiceURI) ?? this.state.voices[0];
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onend = () => {
      if (token !== this.token) return;
      this.chunkIndex++;
      if (this.chunkIndex < this.chunks.length) this.speak();
      else this.advance(token);
    };
    u.onerror = (e) => {
      if (token !== this.token || e.error === "interrupted" || e.error === "canceled") return;
      this.set({ playing: false });
    };
    synth.speak(u);
  }

  private advance(token: number) {
    if (token !== this.token) return;
    const next = this.state.index + 1;
    if (next >= this.state.segments.length) {
      this.chunks = [];
      this.set({ playing: false, index: 0 });
      return;
    }
    this.chunks = chunk(this.state.segments[next].text);
    this.chunkIndex = 0;
    this.set({ index: next });
    this.speak();
  }

  pause() {
    this.token++;
    synth?.cancel();
    this.set({ playing: false });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  stop() {
    this.token++;
    synth?.cancel();
    this.chunks = [];
    this.set({ playing: false });
  }

  skip(delta: number) {
    const i = this.state.index + delta;
    if (i < 0 || i >= this.state.segments.length) return;
    this.chunks = [];
    this.play(i);
  }

  /** Jump to the first segment whose key starts with `prefix` (e.g. a section id). */
  playFrom(prefix: string) {
    const i = this.state.segments.findIndex((s) => s.key.startsWith(prefix));
    if (i === -1) return;
    this.chunks = [];
    this.play(i);
  }

  setRate(rate: number) {
    this.set({ rate });
    this.savePrefs();
    if (this.state.playing) this.speak(); // restart current sentence group at the new rate
  }

  setVoice(voiceURI: string) {
    this.set({ voiceURI });
    this.savePrefs();
    if (this.state.playing) this.speak();
  }

  /** Speak a one-off string (flashcards). Interrupts the queue. */
  say(text: string) {
    if (!synth) return;
    this.pause();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.state.rate;
    const voice = this.state.voices.find((v) => v.voiceURI === this.state.voiceURI) ?? this.state.voices[0];
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    synth.speak(u);
  }
}

export const narrator = new Narrator();

export function useNarrator() {
  return useSyncExternalStore(narrator.subscribe, narrator.getState, narrator.getState);
}

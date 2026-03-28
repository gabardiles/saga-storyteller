/**
 * MoodMapper — maps story transcript text to Lyria music prompts.
 *
 * Pure local keyword matching, zero latency, zero API calls.
 * Buffers the last ~80 words of model output, detects the dominant mood,
 * and fires onPromptChange only when mood shifts (with a 15s cooldown
 * to avoid jarring musical transitions).
 */

const MOOD_PROMPTS: Record<string, string> = {
  forest:
    "gentle woodland ambience with soft flute, kalimba, and bird-like chimes, peaceful and magical",
  ocean:
    "calm ocean waves with soft marimba, gentle harp arpeggios, dreamy and flowing",
  space:
    "ethereal space ambience with soft synth pads, twinkling bells, slow and weightless",
  castle:
    "medieval fantasy with gentle lute, soft recorder, warm and noble",
  cave:
    "mysterious underground with deep resonant tones, soft echoing percussion, curious and wonder-filled",
  adventure:
    "upbeat playful adventure with light drums, bouncy bass, plucked strings, exciting but not intense",
  celebration:
    "joyful celebration with bright ukulele, tambourine, clapping rhythm, happy and festive",
  night:
    "peaceful nighttime lullaby with music box, soft piano, gentle and sleepy",
  silly:
    "playful comedic with bouncy tuba, xylophone, kazoo-like sounds, goofy and fun",
  mystery:
    "curious mystery with pizzicato strings, soft woodblock, tiptoeing rhythm, intriguing",
  flying:
    "soaring and free with sweeping strings, gentle wind chimes, uplifting and open",
  default:
    "warm gentle children's background music with soft acoustic guitar and light percussion",
};

const MOOD_KEYWORDS: Array<{ mood: string; words: string[] }> = [
  {
    mood: "forest",
    words: ["forest", "tree", "woodland", "mushroom", "fox", "rabbit", "deer"],
  },
  {
    mood: "ocean",
    words: ["ocean", "sea", "wave", "fish", "whale", "underwater", "boat", "pirate", "ship"],
  },
  {
    mood: "space",
    words: ["space", "star", "moon", "planet", "rocket", "astronaut", "galaxy"],
  },
  {
    mood: "castle",
    words: ["castle", "king", "queen", "prince", "princess", "knight", "throne", "tower"],
  },
  {
    mood: "cave",
    words: ["cave", "underground", "tunnel", "dark", "deep", "crystal", "gem"],
  },
  {
    mood: "adventure",
    words: ["run", "chase", "hurry", "fast", "race", "climb", "jump", "escape"],
  },
  {
    mood: "celebration",
    words: ["party", "dance", "cheer", "hooray", "celebrate", "feast", "won", "victory"],
  },
  {
    mood: "night",
    words: ["night", "sleep", "dream", "bed", "quiet", "whisper"],
  },
  {
    mood: "silly",
    words: ["silly", "funny", "laugh", "giggle", "sneeze", "oops", "whoops", "upside"],
  },
  {
    mood: "mystery",
    words: ["secret", "hidden", "clue", "puzzle", "mystery", "strange", "wonder"],
  },
  {
    mood: "flying",
    words: ["fly", "flying", "soar", "wings", "cloud", "sky", "bird", "dragon"],
  },
];

const WORD_BUFFER_LIMIT = 80;
const COOLDOWN_MS = 15_000;

export class MoodMapper {
  private buffer: string[] = [];
  private currentMood = "default";
  private lastChange = 0;
  private onPromptChange: (prompt: string) => void;

  constructor(onPromptChange: (prompt: string) => void) {
    this.onPromptChange = onPromptChange;
  }

  /** Feed a chunk of model transcript text. Triggers a mood check. */
  feed(text: string): void {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    this.buffer.push(...words);
    if (this.buffer.length > WORD_BUFFER_LIMIT) {
      this.buffer = this.buffer.slice(-WORD_BUFFER_LIMIT);
    }
    this.checkMood();
  }

  private checkMood(): void {
    const now = Date.now();
    if (now - this.lastChange < COOLDOWN_MS) return;

    const bufferText = this.buffer.join(" ");
    let detected = "default";
    let maxScore = 0;

    for (const { mood, words } of MOOD_KEYWORDS) {
      const score = words.filter((w) => bufferText.includes(w)).length;
      if (score > maxScore) {
        maxScore = score;
        detected = mood;
      }
    }

    if (detected !== this.currentMood) {
      this.currentMood = detected;
      this.lastChange = now;
      this.onPromptChange(MOOD_PROMPTS[detected]!);
    }
  }

  reset(): void {
    this.buffer = [];
    this.currentMood = "default";
    this.lastChange = 0;
  }
}

import { getEnv } from "../config";

export interface ProsodyResult {
  emotion: string | null;
  confidence: number;
}

export default class ProsodyDetector {
  enabled: boolean;
  constructor() {
    this.enabled = getEnv("EMOTION_AUDIO_ENABLED") === "true";
  }

  async analyze(_audio: Float32Array): Promise<ProsodyResult> {
    if (!this.enabled) return { emotion: null, confidence: 0 };
    // placeholder tiny model: compute simple energy
    const energy = _audio.reduce((s, v) => s + Math.abs(v), 0) / _audio.length;
    if (energy > 0.5) {
      return { emotion: "excited", confidence: 0.6 };
    }
    return { emotion: null, confidence: 0.3 };
  }
}




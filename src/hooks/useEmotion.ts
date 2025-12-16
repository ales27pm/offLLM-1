import { useRef } from "react";
import ProsodyDetector from "../emotion/ProsodyDetector";

export function useEmotion() {
  const prosody = useRef(new ProsodyDetector());

  const detectText = (text: string): string | null => {
    const checks: Record<string, string[]> = {
      happy: ["happy", "glad", "joy", "excited", "awesome"],
      sad: ["sad", "unhappy", "depressed", "down"],
      angry: ["angry", "mad", "furious", "annoyed", "frustrated"],
      scared: ["scared", "afraid", "fear", "nervous"],
      surprised: ["surprised", "shocked"],
    };
    const lower = text.toLowerCase();
    const found = Object.entries(checks).find(([, words]) =>
      words.some((w) => lower.includes(w)),
    );
    return found ? found[0] : null;
  };

  const detectAudio = async (audio: Float32Array): Promise<string | null> => {
    try {
      const { emotion, confidence } = await prosody.current.analyze(audio);
      return confidence > 0.5 ? emotion : null;
    } catch {
      return null;
    }
  };

  return { detectText, detectAudio };
}




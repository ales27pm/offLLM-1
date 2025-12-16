import { useEffect, useRef } from "react";
import Tts from "react-native-tts";
import { AgentOrchestrator } from "../core/AgentOrchestrator";
import useLLMStore from "../store/llmStore";
import { useEmotion } from "./useEmotion";

export function useChat() {
  const { addMessage, setIsGenerating } = useLLMStore();
  const { detectText } = useEmotion();
  const orchestrator = useRef(new AgentOrchestrator());

  useEffect(() => {
    Tts.setDefaultRate(0.53);
    Tts.setDefaultPitch(1.0);
  }, []);

  const send = async (text) => {
    const query = text.trim();
    if (!query) return;

    addMessage({ role: "user", content: query });
    setIsGenerating(true);

    try {
      const emotion = detectText(query);
      const augmentedPrompt = emotion ? `[User emotion: ${emotion}] ${query}` : query;

      const reply = await orchestrator.current.run(augmentedPrompt);

      addMessage({ role: "assistant", content: reply });

      Tts.stop();
      const speechText = reply.replace(/([.?!])\s+/g, "$1 <break time=\"300ms\"/> ");
      Tts.speak(speechText);
    } catch (e) {
      console.error("Agent execution failed:", e);
      addMessage({
        role: "assistant",
        content: "I encountered an error while thinking: " + e.message,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const cancel = () => {
    setIsGenerating(false);
    Tts.stop();
  };

  return { send, cancel };
}


import { useState, useEffect, useCallback, useRef } from "react";
import Voice from "@react-native-voice/voice";

export function useSpeechRecognition(onResult, onError) {
  const [isRecording, setIsRecording] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Voice.onSpeechResults = (event) => {
      if (mountedRef.current) {
        setIsRecording(false);
      }
      onResult(event.value?.[0] ?? "");
    };
    Voice.onSpeechError = (event) => {
      if (mountedRef.current) {
        setIsRecording(false);
      }
      if (onError) {
        onError(event.error);
      }
    };
    return () => {
      mountedRef.current = false;
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, [onResult, onError]);

  const start = useCallback(async () => {
    if (isRecording) {
      return;
    }
    setIsRecording(true);
    try {
      await Voice.start("en-US");
    } catch (e) {
      if (mountedRef.current) {
        setIsRecording(false);
      }
      if (onError) {
        onError(e);
      }
    }
  }, [isRecording, onError]);

  const stop = useCallback(async () => {
    if (!isRecording) {
      return;
    }
    try {
      await Voice.stop();
    } finally {
      if (mountedRef.current) {
        setIsRecording(false);
      }
    }
  }, [isRecording]);

  return { isRecording, start, stop };
}




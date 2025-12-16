import { useCallback, useEffect, useMemo, useState } from "react";
import { mlxChat, type ChatTurn } from "../services/chat/mlxChat";

export function useMlxChat(modelId?: string) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load model on mount (optional: pass modelId)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await mlxChat.load(modelId ? { modelId } : undefined);
        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
      mlxChat.unload();
    };
  }, [modelId]);

  const send = useCallback(async (prompt: string) => {
    setBusy(true);
    setError(null);
    try {
      const reply = await mlxChat.send(prompt);
      setHistory(mlxChat.getHistory());
      return reply;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    mlxChat.reset();
    setHistory([]);
  }, []);

  return useMemo(
    () => ({ ready, busy, history, error, send, reset }),
    [ready, busy, history, error, send, reset],
  );
}




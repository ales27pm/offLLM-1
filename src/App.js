import { useCallback, useEffect, useMemo, useRef, useState } from "react";
/* global __DEV__ */
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Button,
} from "react-native";
import LLMService from "./services/llmService";
import { ensureModelDownloaded } from "./utils/modelDownloader";
import { ToolRegistry, builtInTools } from "./architecture/toolSystem";
import {
  createCalendarEventTool,
  sendMessageTool,
  makePhoneCallTool,
  getCallHistoryTool,
  getCurrentLocationTool,
  startLocationUpdatesTool,
  stopLocationUpdatesTool,
  showMapTool,
  getDirectionsTool,
  searchPlacesTool,
  findContactTool,
  addContactTool,
  playMusicTool,
  getMusicLibraryTool,
  getBatteryInfoTool,
  getSensorDataTool,
  setClipboardTool,
  getClipboardTool,
  vibrateTool,
  toggleFlashlightTool,
  getDeviceInfoTool,
  setBrightnessTool,
  pickPhotoTool,
  takePhotoTool,
  pickFileTool,
  openUrlTool,
} from "./tools/iosTools";
import { PluginManager } from "./architecture/pluginManager";
import { DependencyInjector } from "./architecture/dependencyInjector";
import ChatInterface from "./components/ChatInterface";
import DebugConsole from "./debug/DebugConsole";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useChat } from "./hooks/useChat";
import useLLMStore from "./store/llmStore";
import { MODEL_CONFIG } from "./config/model";

const MODEL_PRESETS = [
  {
    id: "configured",
    name: "Configured model",
    url: MODEL_CONFIG.url,
    checksum: MODEL_CONFIG.checksum,
    description:
      "Uses MODEL_URL or the default Dolphin 3.0 1B quantised build.",
    size: "1.1 GB",
  },
  {
    id: "qwen2-1_5b-mlx",
    name: "Qwen2 1.5B Instruct (MLX)",
    modelId: "Qwen/Qwen2-1.5B-Instruct-MLX",
    description:
      "Ships bundled in iOS builds as an MLX-optimised Qwen2 chat model for offline use.",
    size: "0.81 GB",
    platforms: ["ios"],
  },
  {
    id: "tinyllama-1b-q4",
    name: "TinyLlama 1.1B Q4_K_M",
    url: "https://huggingface.co/jzhang38/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/TinyLlama-1.1B-Chat-v1.0.Q4_K_M.gguf",
    checksum: undefined,
    description:
      "Ultra-fast miniature chat model ideal for quick interactions.",
    size: "0.7 GB",
  },
  {
    id: "phi-2-q4",
    name: "Phi-2 2.7B Q4_K_M",
    url: "https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf",
    checksum: undefined,
    description: "Larger reasoning-focused model with a compact quantisation.",
    size: "1.6 GB",
  },
];

function App() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const { send } = useChat();
  const messages = useLLMStore((state) => state.messages);
  const conversations = useLLMStore((state) => state.conversations);
  const currentConversationId = useLLMStore(
    (state) => state.currentConversationId,
  );
  const startNewConversation = useLLMStore(
    (state) => state.startNewConversation,
  );
  const selectConversation = useLLMStore((state) => state.selectConversation);
  const voiceMode = useLLMStore((state) => state.voiceMode);
  const setVoiceMode = useLLMStore((state) => state.setVoiceMode);
  const modelStatus = useLLMStore((state) => state.modelStatus);
  const setModelStatus = useLLMStore((state) => state.setModelStatus);
  const setCurrentModelPath = useLLMStore((state) => state.setCurrentModelPath);
  const currentModelPath = useLLMStore((state) => state.currentModelPath);
  const downloadProgress = useLLMStore((state) => state.downloadProgress);
  const setDownloadProgress = useLLMStore((state) => state.setDownloadProgress);
  const modelError = useLLMStore((state) => state.modelError);
  const setModelError = useLLMStore((state) => state.setModelError);
  const selectedModel = useLLMStore((state) => state.selectedModel);
  const setSelectedModel = useLLMStore((state) => state.setSelectedModel);
  const isGenerating = useLLMStore((state) => state.isGenerating);
  const activeModelId = useLLMStore((state) => state.activeModelId);
  const setActiveModelId = useLLMStore((state) => state.setActiveModelId);
  const platform = Platform.OS;
  const modelOptions = useMemo(() => {
    const filtered = MODEL_PRESETS.filter(
      (preset) => !preset.platforms || preset.platforms.includes(platform),
    );
    if (platform === "ios") {
      return [...filtered].sort((a, b) => {
        const aBundled = Boolean(a.modelId && a.platforms?.includes("ios"));
        const bBundled = Boolean(b.modelId && b.platforms?.includes("ios"));
        if (aBundled === bBundled) {
          return 0;
        }
        return aBundled ? -1 : 1;
      });
    }
    return filtered;
  }, [platform]);
  const initializingRef = useRef(false);
  const handleSend = useCallback(
    (text) => {
      if (modelStatus !== "ready") {
        return;
      }
      const candidate = typeof text === "string" ? text : input;
      const trimmed = candidate.trim();
      if (!trimmed) {
        return;
      }
      send(trimmed);
      setInput("");
    },
    [input, modelStatus, send],
  );
  const handleSpeechResult = useCallback(
    (transcript) => {
      if (transcript) {
        handleSend(transcript);
      }
    },
    [handleSend],
  );
  const handleSpeechError = useCallback(
    (err) => console.warn("Speech recognition error", err),
    [],
  );
  const { isRecording, start, stop } = useSpeechRecognition(
    handleSpeechResult,
    handleSpeechError,
  );

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      setSelectedModel(modelOptions[0]);
    }
  }, [selectedModel, setSelectedModel, modelOptions]);

  const handleModelDownload = useCallback(
    async (model) => {
      if (!model?.url && !model?.modelId) {
        setModelError("Select a model to download.");
        return;
      }
      try {
        setModelError(null);
        setDownloadProgress(0);
        if (model.url) {
          setModelStatus("downloading");
          setDownloadProgress(0.05);
          const path = await ensureModelDownloaded(model.url, {
            checksum: model.checksum,
          });
          setDownloadProgress(0.75);
          setModelStatus("loading");
          await LLMService.loadModel(path);
          setDownloadProgress(1);
          setCurrentModelPath(path);
          setActiveModelId(model.id);
        } else if (model.modelId) {
          setModelStatus("loading");
          setDownloadProgress(0.1);
          await LLMService.loadModel(model.modelId);
          setDownloadProgress(1);
          setCurrentModelPath(model.modelId);
          setActiveModelId(model.id);
        } else {
          throw new Error("Model is missing download information.");
        }
        setModelStatus("ready");
      } catch (err) {
        console.error("Model selection failed:", err);
        setModelStatus("error");
        setDownloadProgress(0);
        setModelError(err instanceof Error ? err.message : String(err));
      }
    },
    [
      setActiveModelId,
      setCurrentModelPath,
      setDownloadProgress,
      setModelError,
      setModelStatus,
    ],
  );

  const initializeApp = useCallback(
    async (model) => {
      try {
        const dependencyInjector = new DependencyInjector();
        const toolRegistry = new ToolRegistry();
        Object.entries(builtInTools).forEach(([name, tool]) => {
          toolRegistry.registerTool(name, tool);
        });
        if (Platform.OS === "ios") {
          [
            createCalendarEventTool,
            sendMessageTool,
            makePhoneCallTool,
            getCallHistoryTool,
            getCurrentLocationTool,
            startLocationUpdatesTool,
            stopLocationUpdatesTool,
            showMapTool,
            getDirectionsTool,
            searchPlacesTool,
            findContactTool,
            addContactTool,
            playMusicTool,
            getMusicLibraryTool,
            getBatteryInfoTool,
            getSensorDataTool,
            setClipboardTool,
            getClipboardTool,
            vibrateTool,
            toggleFlashlightTool,
            getDeviceInfoTool,
            setBrightnessTool,
            pickPhotoTool,
            takePhotoTool,
            pickFileTool,
            openUrlTool,
          ].forEach((tool) => {
            toolRegistry.registerTool(tool.name, tool);
          });
        }
        const pluginManager = new PluginManager();
        dependencyInjector.register("toolRegistry", toolRegistry);
        dependencyInjector.register("pluginManager", pluginManager);
        dependencyInjector.register("llmService", LLMService);
        setInitialized(true);
        await handleModelDownload(model);
      } catch (err) {
        console.error("App initialization failed:", err);
        setError(err.message);
      } finally {
        initializingRef.current = false;
      }
    },
    [handleModelDownload],
  );

  useEffect(() => {
    if (!selectedModel || initialized || initializingRef.current) {
      return;
    }
    initializingRef.current = true;
    initializeApp(selectedModel).catch((err) => {
      console.error("Initialization error", err);
      setError(err.message);
      initializingRef.current = false;
    });
  }, [initializeApp, initialized, selectedModel]);

  useEffect(() => {
    if (!initialized) {
      return;
    }
    if (conversations.length === 0) {
      startNewConversation();
    }
  }, [initialized, conversations.length, startNewConversation]);

  useEffect(() => {
    if (!initialized) {
      return;
    }
    if (modelStatus !== "ready") {
      if (isRecording) {
        stop();
      }
      return;
    }
    if (!voiceMode) {
      if (isRecording) {
        stop();
      }
      return;
    }
    if (!isRecording) {
      const timer = setTimeout(() => {
        start().catch((err) => {
          console.warn("Unable to start speech recognition", err);
          setVoiceMode(false);
        });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [
    initialized,
    modelStatus,
    voiceMode,
    isRecording,
    start,
    stop,
    setVoiceMode,
  ]);

  const handleModelSelect = useCallback(
    (model) => {
      if (!model) {
        setModelError("Select a model to download.");
        return;
      }
      setModelError(null);
      setSelectedModel(model);
      if (model.id === activeModelId) {
        setModelStatus("ready");
        setDownloadProgress(1);
      } else {
        setModelStatus("idle");
        setDownloadProgress(0);
      }
    },
    [
      activeModelId,
      setDownloadProgress,
      setModelError,
      setModelStatus,
      setSelectedModel,
    ],
  );

  const handleDownloadPress = useCallback(() => {
    if (selectedModel) {
      handleModelDownload(selectedModel);
    } else {
      setModelError("Select a model to download.");
    }
  }, [handleModelDownload, selectedModel, setModelError]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Error initializing app: {error}</Text>
      </View>
    );
  }

  if (!initialized) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loading}>Initializing...</Text>
      </View>
    );
  }

  return (
    <>
      <ChatInterface
        messages={messages}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        isRecording={isRecording}
        onMicPress={start}
        onMicStop={stop}
        conversations={conversations}
        onSelectConversation={selectConversation}
        onNewConversation={startNewConversation}
        currentConversationId={currentConversationId}
        voiceModeEnabled={voiceMode}
        onVoiceModeToggle={setVoiceMode}
        modelOptions={modelOptions}
        onModelSelect={handleModelSelect}
        selectedModel={selectedModel}
        onDownloadModel={handleDownloadPress}
        modelStatus={modelStatus}
        modelError={modelError}
        downloadProgress={downloadProgress}
        currentModelPath={currentModelPath}
        isGenerating={isGenerating}
        activeModelId={activeModelId}
      />
      {(__DEV__ || process.env.DEBUG_PANEL === "1") && (
        <>
          <DebugConsole
            visible={showDebug}
            onClose={() => setShowDebug(false)}
          />
          <View style={styles.debugButton}>
            <Button title="Debug" onPress={() => setShowDebug(true)} />
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loading: { marginTop: 20 },
  errorText: { color: "red" },
  debugButton: {
    position: "absolute",
    bottom: 20,
    right: 20,
  },
});

export default App;




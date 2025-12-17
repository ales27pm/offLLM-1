import { create } from "zustand";

const generateId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const normaliseMessage = (message) => ({
  id: message.id ?? generateId("msg"),
  role: message.role,
  content: message.content,
  timestamp: message.timestamp ?? Date.now(),
});

const inferTitleFromMessage = (message, fallback) => {
  if (!message?.content) {
    return fallback;
  }
  const trimmed = message.content.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > 42 ? `${trimmed.slice(0, 39)}…` : trimmed;
};

const createConversation = ({ id, title }) => ({
  id: id ?? generateId("conv"),
  title: title ?? "New conversation",
  createdAt: Date.now(),
  lastUpdated: Date.now(),
  messages: [],
});

const useLLMStore = create((set, get) => ({
  messages: [],
  conversations: [],
  currentConversationId: null,
  voiceMode: false,
  isGenerating: false,
  modelStatus: "idle",
  modelError: null,
  downloadProgress: 0,
  currentModelPath: null,
  selectedModel: null,
  activeModelId: null,
  addMessage: (message) =>
    set((state) => {
      const normalised = normaliseMessage(message);
      let conversationId = state.currentConversationId;
      let conversations = state.conversations;

      let activeConversation = conversations.find(
        (conv) => conv.id === conversationId,
      );

      if (!activeConversation) {
        const created = createConversation({ id: conversationId });
        if (normalised.role === "user") {
          created.title = inferTitleFromMessage(normalised, created.title);
        }
        activeConversation = {
          ...created,
          messages: [normalised],
          lastUpdated: normalised.timestamp,
        };
        conversations = [activeConversation, ...conversations];
        conversationId = activeConversation.id;
        return {
          messages: activeConversation.messages,
          conversations,
          currentConversationId: conversationId,
        };
      }

      const updatedConversation = {
        ...activeConversation,
        messages: [...activeConversation.messages, normalised],
        lastUpdated: normalised.timestamp,
      };

      if (
        normalised.role === "user" &&
        activeConversation.messages.length === 0
      ) {
        updatedConversation.title = inferTitleFromMessage(
          normalised,
          activeConversation.title,
        );
      }

      const otherConversations = conversations.filter(
        (conv) => conv.id !== updatedConversation.id,
      );

      return {
        messages: updatedConversation.messages,
        conversations: [updatedConversation, ...otherConversations],
        currentConversationId: updatedConversation.id,
      };
    }),
  setMessages: (messages) =>
    set((state) => {
      const normalisedMessages = messages.map(normaliseMessage);
      const conversationId = state.currentConversationId;
      if (!conversationId) {
        return { messages: normalisedMessages };
      }
      const conversations = state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: normalisedMessages,
              lastUpdated:
                normalisedMessages[normalisedMessages.length - 1]?.timestamp ??
                conv.lastUpdated,
            }
          : conv,
      );
      const activeConversation = conversations.find(
        (conv) => conv.id === conversationId,
      );
      return {
        messages: activeConversation?.messages ?? normalisedMessages,
        conversations,
      };
    }),
  startNewConversation: (title) =>
    set((state) => {
      const conversation = createConversation({ title });
      return {
        conversations: [conversation, ...state.conversations],
        currentConversationId: conversation.id,
        messages: [],
        isGenerating: false,
      };
    }),
  selectConversation: (conversationId) => {
    const state = get();
    const conversation = state.conversations.find(
      (conv) => conv.id === conversationId,
    );
    if (!conversation) {
      return;
    }
    const others = state.conversations.filter(
      (conv) => conv.id !== conversationId,
    );
    set({
      currentConversationId: conversationId,
      messages: conversation.messages,
      conversations: [conversation, ...others],
      isGenerating: false,
    });
  },
  setVoiceMode: (voiceMode) => set({ voiceMode }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setModelStatus: (status) => set({ modelStatus: status }),
  setModelError: (modelError) => set({ modelError }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress }),
  setCurrentModelPath: (path) => set({ currentModelPath: path }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setActiveModelId: (modelId) => set({ activeModelId: modelId }),
  generateResponse: async (prompt, llmService) => {
    const { addMessage, setIsGenerating } = get();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return;
    }
    const trimmed = prompt.trim();
    addMessage({ role: "user", content: trimmed });
    setIsGenerating(true);
    try {
      const response = await llmService.generate(trimmed);
      const text = response?.text ?? response;
      addMessage({ role: "assistant", content: text });
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addMessage({ role: "assistant", content: `Error: ${message}` });
      throw error;
    } finally {
      setIsGenerating(false);
    }
  },
}));

export default useLLMStore;

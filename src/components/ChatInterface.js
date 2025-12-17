import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

const STATUS_META = {
  idle: {
    label: "Model not loaded",
    description: "Select a model and load it to start chatting.",
    tone: "info",
  },
  downloading: {
    label: "Downloading model",
    description: "We're fetching the model weights for offline use.",
    tone: "progress",
  },
  loading: {
    label: "Preparing model",
    description: "Finalising setup so responses stay fast.",
    tone: "progress",
  },
  ready: {
    label: "Model ready",
    description: "You're ready to chat and use voice commands.",
    tone: "success",
  },
  error: {
    label: "Model error",
    description: "Try downloading again or pick a different preset.",
    tone: "error",
  },
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const toPercentage = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
};

function ModelStatusBanner({
  status,
  progress,
  error,
  currentModelPath,
  isBundledSelection,
  selectedModelName,
  activeModelName,
  showingDifferentModel,
}) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const tone = meta.tone ?? "info";
  const progressPercent = toPercentage(progress);
  const isBusy = status === "downloading" || status === "loading";
  const showProgress = isBusy;
  const showPath =
    status === "ready" && currentModelPath && !showingDifferentModel;

  return (
    <View
      style={[
        styles.statusBanner,
        tone === "success"
          ? styles.statusBannerSuccess
          : tone === "error"
            ? styles.statusBannerErrorContainer
            : tone === "progress"
              ? styles.statusBannerProgress
              : styles.statusBannerInfo,
      ]}
    >
      <View style={styles.statusBannerHeader}>
        <Text style={styles.statusBannerLabel}>{meta.label}</Text>
        {isBusy ? <ActivityIndicator size="small" color="#2a5fff" /> : null}
      </View>
      {meta.description ? (
        <Text style={styles.statusBannerDescription}>{meta.description}</Text>
      ) : null}
      {selectedModelName ? (
        <Text style={styles.statusBannerModel}>
          Selected preset: {selectedModelName}
        </Text>
      ) : null}
      {showingDifferentModel && activeModelName ? (
        <Text style={styles.statusBannerHint}>
          Currently running {activeModelName}. Load{" "}
          {selectedModelName ?? "the selected preset"} to switch models.
        </Text>
      ) : null}
      {!showingDifferentModel && status === "idle" && isBundledSelection ? (
        <Text style={styles.statusBannerHint}>
          The selected preset ships with the app. Tap “Load bundled model” to
          use it instantly.
        </Text>
      ) : null}
      {showProgress ? (
        <View style={styles.statusProgressWrapper}>
          <View style={styles.statusProgressTrack}>
            <View
              style={[
                styles.statusProgressFill,
                { width: `${progressPercent}%` },
              ]}
            />
          </View>
          <Text style={styles.statusProgressText}>{progressPercent}%</Text>
        </View>
      ) : null}
      {showPath ? (
        <Text style={styles.statusBannerPath} numberOfLines={1}>
          Active source: {currentModelPath}
        </Text>
      ) : null}
      {status === "error" && error ? (
        <Text style={styles.statusBannerErrorText}>{error}</Text>
      ) : null}
    </View>
  );
}

function ConversationSection({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}) {
  return (
    <View style={styles.sidebarSection}>
      <View style={styles.sidebarSectionHeader}>
        <Text style={styles.sidebarTitle}>Conversations</Text>
        <TouchableOpacity
          onPress={onNewConversation}
          style={styles.newConversationButton}
        >
          <Text style={styles.newConversationText}>New</Text>
        </TouchableOpacity>
      </View>
      {conversations.length === 0 ? (
        <Text style={styles.emptyConversationText}>
          Start a conversation to see it here.
        </Text>
      ) : (
        conversations.map((conversation) => {
          const isActive = conversation.id === currentConversationId;
          return (
            <TouchableOpacity
              key={conversation.id}
              onPress={() => onSelectConversation(conversation.id)}
              style={[
                styles.conversationCard,
                isActive && styles.activeConversationCard,
              ]}
            >
              <Text style={styles.conversationTitle}>{conversation.title}</Text>
              <Text style={styles.conversationTimestamp}>
                {formatTimestamp(conversation.lastUpdated)}
              </Text>
              <Text style={styles.conversationPreview} numberOfLines={2}>
                {conversation.lastMessage?.content ?? "No messages yet"}
              </Text>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

function VoiceModeSection({ enabled, onToggle, disabled, isRecording }) {
  return (
    <View style={styles.sidebarSection}>
      <View style={styles.toggleHeader}>
        <View style={styles.toggleTextGroup}>
          <Text style={styles.toggleLabel}>Vocal mode</Text>
          <Text style={styles.toggleDescription}>
            Automatically listen for speech and send transcriptions.
          </Text>
        </View>
        <Switch value={enabled} onValueChange={onToggle} disabled={disabled} />
      </View>
      {disabled ? (
        <Text style={styles.toggleHint}>
          Load a model to enable hands-free conversations.
        </Text>
      ) : enabled ? (
        <Text style={[styles.toggleHint, styles.toggleHintActive]}>
          {isRecording
            ? "Listening… say something and we'll transcribe it."
            : "Voice mode is on. We'll start listening shortly."}
        </Text>
      ) : (
        <Text style={styles.toggleHint}>
          Keep it off to type manually or toggle it on for auto listening.
        </Text>
      )}
    </View>
  );
}

function ModelSettingsSection({
  modelOptions,
  selectedModel,
  activeModelId,
  onModelSelect,
  onDownloadModel,
  modelStatus,
  downloadProgress,
  modelError,
  isBundledSelection,
}) {
  const busy = modelStatus === "downloading" || modelStatus === "loading";
  const buttonLabel = busy
    ? modelStatus === "downloading"
      ? "Downloading…"
      : "Loading…"
    : isBundledSelection
      ? "Load bundled model"
      : "Download & load model";
  const statusLabel = STATUS_META[modelStatus]?.label ?? STATUS_META.idle.label;
  const progressPercent = toPercentage(downloadProgress);

  return (
    <View style={styles.settingsSection}>
      <Text style={styles.sidebarTitle}>Model settings</Text>
      <Text style={styles.modelHint}>
        Choose a preset to run locally. Bundled models are ready immediately.
      </Text>
      <View style={styles.modelList}>
        {modelOptions.map((option) => {
          const selected = option.id === selectedModel?.id;
          const isActive = option.id === activeModelId;
          const isBundled = Boolean(option.modelId && !option.url);
          const badges = [];
          if (isActive) {
            badges.push({
              key: "active",
              label: "Active",
              style: styles.activeBadge,
            });
          }
          if (selected) {
            badges.push({
              key: "selected",
              label: "Selected",
              style: styles.selectedBadge,
            });
          }

          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.modelOption,
                selected && styles.modelOptionSelected,
              ]}
              onPress={() => onModelSelect(option)}
            >
              <View style={styles.modelOptionHeader}>
                <Text style={styles.modelOptionTitle}>{option.name}</Text>
                <View style={styles.modelBadgeRow}>
                  {badges.map((badge, index) => (
                    <Text
                      key={badge.key}
                      style={[
                        styles.modelBadge,
                        badge.style,
                        index > 0 ? styles.modelBadgeSpaced : null,
                      ]}
                    >
                      {badge.label}
                    </Text>
                  ))}
                </View>
              </View>
              {option.description ? (
                <Text style={styles.modelOptionDescription}>
                  {option.description}
                </Text>
              ) : null}
              <View style={styles.modelOptionMetaRow}>
                {option.size ? (
                  <Text style={styles.modelOptionMeta}>
                    Size · {option.size}
                  </Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                {isBundled ? (
                  <Text style={[styles.modelBadge, styles.bundledBadge]}>
                    Bundled
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        onPress={onDownloadModel}
        style={[
          styles.downloadButton,
          (!selectedModel || busy) && styles.downloadButtonDisabled,
        ]}
        disabled={!selectedModel || busy}
      >
        <Text style={styles.downloadButtonText}>{buttonLabel}</Text>
      </TouchableOpacity>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>{statusLabel}</Text>
      </View>
      {busy ? (
        <View style={styles.modelProgressTrack}>
          <View
            style={[styles.modelProgressFill, { width: `${progressPercent}%` }]}
          />
        </View>
      ) : null}
      {modelError ? (
        <Text style={styles.modelErrorText}>{modelError}</Text>
      ) : null}
    </View>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <View
      style={[
        styles.messageBubble,
        isUser ? styles.userMessage : styles.assistantMessage,
      ]}
    >
      <View style={styles.messageHeader}>
        <Text style={styles.messageRole}>{isUser ? "You" : "Assistant"}</Text>
        <Text style={styles.messageTimestamp}>
          {formatTimestamp(message.timestamp)}
        </Text>
      </View>
      <Text style={styles.messageText}>{message.content}</Text>
    </View>
  );
}

function Composer({
  input,
  onInputChange,
  onSendPress,
  canSend,
  isRecording,
  onMicPress,
  onMicStop,
  voiceModeEnabled,
}) {
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    onSendPress(trimmed);
  }, [input, onSendPress]);

  const placeholder = voiceModeEnabled
    ? "Listening… edit text or tap send to confirm"
    : "Type your message…";
  return (
    <View>
      <View style={styles.composerRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={onInputChange}
          placeholder={placeholder}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          onPress={handleSend}
          style={[
            styles.sendButton,
            (!input.trim() || !canSend) && styles.sendButtonDisabled,
          ]}
          disabled={!input.trim() || !canSend}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={isRecording ? onMicStop : onMicPress}
          style={[
            styles.micButton,
            isRecording && styles.micButtonActive,
            !isRecording && !canSend && styles.micButtonDisabled,
          ]}
          disabled={!isRecording && !canSend}
        >
          <Text style={styles.micButtonText}>{isRecording ? "⏹" : "🎤"}</Text>
        </TouchableOpacity>
      </View>
      <Text
        style={[
          styles.composerHint,
          voiceModeEnabled && styles.composerHintActive,
        ]}
      >
        {voiceModeEnabled
          ? isRecording
            ? "Listening now. We'll send the transcript automatically."
            : "Voice mode is enabled—tap the mic or just start speaking."
          : "Tip: enable vocal mode in the sidebar for hands-free chats."}
      </Text>
    </View>
  );
}
export default function ChatInterface({
  messages,
  input,
  onInputChange,
  onSend,
  isRecording,
  onMicPress,
  onMicStop,
  conversations,
  onSelectConversation,
  onNewConversation,
  currentConversationId,
  voiceModeEnabled,
  onVoiceModeToggle,
  modelOptions,
  onModelSelect,
  selectedModel,
  onDownloadModel,
  modelStatus,
  modelError,
  downloadProgress,
  currentModelPath,
  isGenerating,
  activeModelId,
}) {
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 900;
  const [showSidebar, setShowSidebar] = useState(isLargeScreen);
  const canSend = modelStatus === "ready";
  const statusLabel = STATUS_META[modelStatus]?.label ?? STATUS_META.idle.label;
  const isBundledSelection = Boolean(
    selectedModel?.modelId && !selectedModel?.url,
  );

  useEffect(() => {
    if (isLargeScreen) {
      setShowSidebar(true);
    }
  }, [isLargeScreen]);

  const orderedConversations = useMemo(() => {
    return conversations
      .map((conversation) => ({
        ...conversation,
        lastMessage: conversation.messages.slice(-1)[0],
      }))
      .sort((a, b) => (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0));
  }, [conversations]);

  const handleSelectConversation = useCallback(
    (conversationId) => {
      onSelectConversation(conversationId);
      if (!isLargeScreen) {
        setShowSidebar(false);
      }
    },
    [isLargeScreen, onSelectConversation],
  );

  const renderMessage = useCallback(
    ({ item }) => <MessageBubble message={item} />,
    [],
  );

  const activeModelName = useMemo(() => {
    const match = modelOptions.find((option) => option.id === activeModelId);
    return match?.name;
  }, [activeModelId, modelOptions]);

  const showingDifferentModel = Boolean(
    activeModelId && selectedModel && activeModelId !== selectedModel.id,
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        {(isLargeScreen || showSidebar) && (
          <View
            style={[styles.sidebar, !isLargeScreen && styles.sidebarFloating]}
          >
            {!isLargeScreen && (
              <TouchableOpacity
                onPress={() => setShowSidebar(false)}
                style={styles.closeSidebarButton}
              >
                <Text style={styles.closeSidebarText}>Close</Text>
              </TouchableOpacity>
            )}
            <ScrollView
              style={styles.sidebarScroll}
              contentContainerStyle={styles.sidebarContent}
            >
              <ConversationSection
                conversations={orderedConversations}
                currentConversationId={currentConversationId}
                onSelectConversation={handleSelectConversation}
                onNewConversation={onNewConversation}
              />
              <View style={styles.sidebarDivider} />
              <VoiceModeSection
                enabled={voiceModeEnabled}
                onToggle={onVoiceModeToggle}
                disabled={!canSend}
                isRecording={isRecording}
              />
              <View style={styles.sidebarDivider} />
              <ModelSettingsSection
                modelOptions={modelOptions}
                selectedModel={selectedModel}
                activeModelId={activeModelId}
                onModelSelect={onModelSelect}
                onDownloadModel={onDownloadModel}
                modelStatus={modelStatus}
                downloadProgress={downloadProgress}
                modelError={modelError}
                isBundledSelection={isBundledSelection}
              />
            </ScrollView>
          </View>
        )}
        <View style={styles.chatColumn}>
          {!isLargeScreen && (
            <View style={styles.mobileHeader}>
              <TouchableOpacity
                onPress={() => setShowSidebar(true)}
                style={styles.openSidebarButton}
              >
                <Text style={styles.openSidebarText}>
                  ☰ Conversations & Settings
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <KeyboardAvoidingView
            style={styles.chatArea}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 32 : 0}
          >
            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={styles.chatHeaderTitle}>Chat</Text>
                <View style={styles.chatHeaderMeta}>
                  <View style={styles.chatHeaderStatus}>
                    <Text style={styles.headerStatusLabel}>Model</Text>
                    <Text style={styles.headerStatusValue} numberOfLines={1}>
                      {selectedModel?.name ?? "Not selected"}
                    </Text>
                  </View>
                  <View style={styles.chatHeaderStatus}>
                    <Text style={styles.headerStatusLabel}>Mode</Text>
                    <Text style={styles.headerStatusValue}>
                      {voiceModeEnabled ? "Vocal" : "Text"}
                    </Text>
                  </View>
                </View>
              </View>
              <ModelStatusBanner
                status={modelStatus}
                progress={downloadProgress}
                error={modelError}
                currentModelPath={currentModelPath}
                isBundledSelection={isBundledSelection}
                selectedModelName={selectedModel?.name}
                activeModelName={activeModelName}
                showingDifferentModel={showingDifferentModel}
              />
              <FlatList
                style={styles.messageList}
                contentContainerStyle={styles.messageListContent}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.id}
                inverted
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateTitle}>No messages yet</Text>
                    <Text style={styles.emptyStateSubtitle}>
                      {canSend
                        ? "Ask a question, tap the mic, or pick a conversation."
                        : "Load a model to start chatting."}
                    </Text>
                  </View>
                }
                ListHeaderComponent={
                  isGenerating ? (
                    <View style={styles.generatingIndicator}>
                      <ActivityIndicator size="small" color="#007AFF" />
                      <Text style={styles.generatingText}>Thinking…</Text>
                    </View>
                  ) : (
                    <View style={styles.listHeaderSpacer} />
                  )
                }
                ListFooterComponent={<View style={styles.listFooterSpacer} />}
              />
              <Composer
                input={input}
                onInputChange={onInputChange}
                onSendPress={onSend}
                canSend={canSend}
                isRecording={isRecording}
                onMicPress={onMicPress}
                onMicStop={onMicStop}
                voiceModeEnabled={voiceModeEnabled}
              />
              {!canSend ? (
                <Text style={styles.composerDisabledHint}>
                  Model status: {statusLabel}. Messaging unlocks once it is
                  ready.
                </Text>
              ) : showingDifferentModel && activeModelName ? (
                <Text style={styles.composerDisabledHint}>
                  Currently responding with {activeModelName}. Load the selected
                  preset to switch models.
                </Text>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
      {!isLargeScreen && showSidebar ? (
        <TouchableOpacity
          style={styles.sidebarOverlay}
          onPress={() => setShowSidebar(false)}
          activeOpacity={1}
        />
      ) : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f7fa",
    position: "relative",
  },
  root: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 340,
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#dfe3f0",
  },
  sidebarFloating: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  closeSidebarButton: {
    alignSelf: "flex-end",
    marginTop: 16,
    marginRight: 20,
  },
  closeSidebarText: {
    color: "#007AFF",
    fontWeight: "600",
    fontSize: 16,
  },
  sidebarScroll: {
    flex: 1,
  },
  sidebarContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 32,
  },
  sidebarSection: {
    marginBottom: 24,
  },
  sidebarSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#132149",
  },
  newConversationButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  newConversationText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  emptyConversationText: {
    color: "#6b7a99",
    marginTop: 8,
    fontSize: 14,
  },
  conversationCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dfe3f0",
    backgroundColor: "#ffffff",
    marginBottom: 12,
  },
  activeConversationCard: {
    borderColor: "#007AFF",
    backgroundColor: "#f0f6ff",
  },
  conversationTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#132149",
  },
  conversationTimestamp: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7a99",
  },
  conversationPreview: {
    marginTop: 6,
    fontSize: 13,
    color: "#3b4b6b",
  },
  sidebarDivider: {
    height: 1,
    backgroundColor: "#e2e6f2",
    marginVertical: 24,
  },
  toggleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleTextGroup: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#132149",
  },
  toggleDescription: {
    marginTop: 4,
    fontSize: 13,
    color: "#6b7a99",
  },
  toggleHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7a99",
  },
  toggleHintActive: {
    color: "#1b8f5a",
  },
  settingsSection: {
    marginBottom: 16,
  },
  modelHint: {
    marginTop: 8,
    fontSize: 13,
    color: "#6b7a99",
  },
  modelList: {
    marginTop: 16,
  },
  modelOption: {
    borderWidth: 1,
    borderColor: "#dfe3f0",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#ffffff",
  },
  modelOptionSelected: {
    borderColor: "#007AFF",
    backgroundColor: "#f0f6ff",
  },
  modelOptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modelOptionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#132149",
  },
  modelBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  modelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "600",
  },
  modelBadgeSpaced: {
    marginLeft: 6,
  },
  activeBadge: {
    backgroundColor: "#e6f4ef",
    color: "#1b8f5a",
  },
  selectedBadge: {
    backgroundColor: "#e5edff",
    color: "#2a5fff",
  },
  bundledBadge: {
    backgroundColor: "#fdf5e6",
    color: "#b07000",
  },
  modelOptionDescription: {
    marginTop: 6,
    fontSize: 13,
    color: "#3b4b6b",
  },
  modelOptionMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modelOptionMeta: {
    fontSize: 12,
    color: "#6b7a99",
    flex: 1,
  },
  downloadButton: {
    marginTop: 16,
    backgroundColor: "#007AFF",
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  downloadButtonDisabled: {
    opacity: 0.6,
  },
  downloadButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  statusRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusLabel: {
    fontSize: 12,
    color: "#6b7a99",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#132149",
  },
  modelProgressTrack: {
    height: 6,
    borderRadius: 4,
    backgroundColor: "#dfe3f0",
    marginTop: 10,
  },
  modelProgressFill: {
    height: 6,
    borderRadius: 4,
    backgroundColor: "#007AFF",
  },
  modelErrorText: {
    marginTop: 10,
    fontSize: 12,
    color: "#b42318",
  },
  chatColumn: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  mobileHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  openSidebarButton: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#dfe3f0",
  },
  openSidebarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#132149",
  },
  chatArea: {
    flex: 1,
  },
  chatContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  chatHeaderTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#132149",
  },
  chatHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  chatHeaderStatus: {
    marginLeft: 18,
    alignItems: "flex-start",
  },
  headerStatusLabel: {
    fontSize: 11,
    color: "#6b7a99",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  headerStatusValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: "#132149",
    maxWidth: 180,
  },
  statusBanner: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusBannerInfo: {
    backgroundColor: "#f4f7ff",
    borderColor: "#cbd8ff",
  },
  statusBannerProgress: {
    backgroundColor: "#f4f7ff",
    borderColor: "#cbd8ff",
  },
  statusBannerSuccess: {
    backgroundColor: "#edf8f2",
    borderColor: "#c2ead6",
  },
  statusBannerErrorContainer: {
    backgroundColor: "#fdecea",
    borderColor: "#f5c6c3",
  },
  statusBannerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusBannerLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#132149",
  },
  statusBannerDescription: {
    marginTop: 6,
    fontSize: 13,
    color: "#3b4b6b",
  },
  statusBannerModel: {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7a99",
  },
  statusBannerHint: {
    marginTop: 8,
    fontSize: 13,
    color: "#3b4b6b",
  },
  statusProgressWrapper: {
    marginTop: 12,
  },
  statusProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#dfe3f0",
  },
  statusProgressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2a5fff",
  },
  statusProgressText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "600",
    color: "#2a5fff",
    alignSelf: "flex-end",
  },
  statusBannerPath: {
    marginTop: 10,
    fontSize: 12,
    color: "#6b7a99",
  },
  statusBannerErrorText: {
    marginTop: 10,
    fontSize: 13,
    color: "#b42318",
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: 16,
    paddingHorizontal: 0,
  },
  messageBubble: {
    maxWidth: "82%",
    padding: 14,
    borderRadius: 18,
    marginVertical: 6,
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#dceeff",
  },
  assistantMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e0e6ef",
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: "700",
    color: "#132149",
    textTransform: "uppercase",
  },
  messageTimestamp: {
    fontSize: 11,
    color: "#6b7a99",
  },
  messageText: {
    fontSize: 16,
    color: "#111827",
    lineHeight: 22,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#132149",
  },
  emptyStateSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#6b7a99",
    textAlign: "center",
  },
  generatingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  generatingText: {
    marginLeft: 8,
    fontSize: 13,
    color: "#6b7a99",
  },
  listHeaderSpacer: {
    height: 12,
  },
  listFooterSpacer: {
    height: 28,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#dfe3f0",
  },
  sendButton: {
    marginLeft: 12,
    backgroundColor: "#007AFF",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  micButton: {
    marginLeft: 10,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#dfe3f0",
  },
  micButtonActive: {
    backgroundColor: "#ffece5",
    borderColor: "#ff9472",
  },
  micButtonDisabled: {
    opacity: 0.45,
  },
  micButtonText: {
    fontSize: 20,
  },
  composerHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7a99",
  },
  composerHintActive: {
    color: "#1b8f5a",
  },
  composerDisabledHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#9aa6c3",
  },
  sidebarOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 26, 52, 0.45)",
    zIndex: 20,
  },
});

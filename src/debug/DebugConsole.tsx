import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  Button,
  ScrollView,
  StyleSheet,
  Share,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import logger, { LogEntry, LogLevel } from "../utils/logger";
import { useDebugSettings } from "./useDebugSettings";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatLogEntry = (entry: LogEntry): string => {
  const timestamp =
    entry.timestamp instanceof Date
      ? entry.timestamp.toISOString()
      : new Date(entry.timestamp).toISOString();
  const levelName = LogLevel[entry.level];
  const parts: string[] = [entry.message];

  if (entry.data !== undefined) {
    const serialised = formatValue(entry.data);
    if (serialised) {
      parts.push(serialised);
    }
  }

  if (entry.error) {
    const serialised = formatValue(entry.error);
    if (serialised) {
      parts.push(serialised);
    }
  }

  const suffix = parts.length ? ` ${parts.join(" ")}` : "";
  return `[${timestamp}] [${levelName}] [${entry.tag}]${suffix}`;
};

export default function DebugConsole({ visible, onClose }: Props) {
  const [logs, setLogs] = useState("");
  const { verbose, file, toggleVerbose, toggleFile } = useDebugSettings();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (visible) {
      const refresh = () => {
        const entries = logger.getLogs();
        setLogs(entries.map(formatLogEntry).join("\n"));
      };
      refresh();
      timer = setInterval(refresh, 1000);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [visible]);

  const copy = () => Clipboard.setString(logs);
  const share = async () => {
    try {
      await Share.share({ message: logs });
    } catch {
      copy();
    }
  };
  const clear = () => {
    logger.clearLogs();
    setLogs("");
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ScrollView style={styles.scroll}>
          <Text style={styles.logText}>{logs}</Text>
        </ScrollView>
        <View style={styles.buttons}>
          <Button title="Copy" onPress={copy} />
          <Button title="Share" onPress={share} />
          <Button title="Clear" onPress={clear} />
          <Button
            title={verbose ? "Verbose" : "Quiet"}
            onPress={toggleVerbose}
          />
          <Button title={file ? "File On" : "File Off"} onPress={toggleFile} />
        </View>
        <Button title="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 8, backgroundColor: "white" },
  scroll: { flex: 1, marginBottom: 8 },
  logText: { fontFamily: "Courier", fontSize: 12 },
  buttons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 8,
  },
});

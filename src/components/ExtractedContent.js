import { View, Text, ScrollView, StyleSheet, Linking } from "react-native";
import HTML from "react-native-render-html";

const ExtractedContent = ({ content, onLinkPress }) => {
  if (!content) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>No content available</Text>
      </View>
    );
  }

  const handleLinkPress = (event, href) => {
    if (typeof href !== "string" || !href.trim()) {
      console.error("Invalid URL: href is empty or not a string");
      return;
    }
    try {
      new URL(href);
      if (onLinkPress) {
        onLinkPress(href);
      } else {
        Linking.openURL(href).catch((err) =>
          console.error("Failed to open URL:", err),
        );
      }
    } catch (e) {
      console.error("Invalid URL:", href, e);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{content.title}</Text>

      {content.siteName && (
        <Text style={styles.siteName}>From: {content.siteName}</Text>
      )}

      {content.publishedTime && (
        <Text style={styles.meta}>Published: {content.publishedTime}</Text>
      )}

      {content.readingTime && (
        <Text style={styles.meta}>Reading time: {content.readingTime} min</Text>
      )}

      {content.excerpt && (
        <View style={styles.excerptContainer}>
          <Text style={styles.excerpt}>{content.excerpt}</Text>
        </View>
      )}

      {content.content ? (
        <HTML
          source={{ html: content.content }}
          onLinkPress={handleLinkPress}
          tagsStyles={htmlStyles}
          baseStyle={styles.htmlBase}
        />
      ) : content.textContent ? (
        <Text style={styles.textContent}>{content.textContent}</Text>
      ) : (
        <Text style={styles.error}>No content available</Text>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  siteName: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  },
  excerptContainer: {
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
  },
  excerpt: {
    fontSize: 16,
    fontStyle: "italic",
    color: "#555",
  },
  textContent: {
    fontSize: 16,
    lineHeight: 24,
    color: "#333",
  },
  htmlBase: {
    fontSize: 16,
    lineHeight: 24,
    color: "#333",
  },
  error: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    marginVertical: 20,
  },
});

const htmlStyles = {
  p: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
    color: "#333",
  },
  h1: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 24,
    marginBottom: 16,
    color: "#333",
  },
  h2: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 12,
    color: "#333",
  },
  h3: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 18,
    marginBottom: 10,
    color: "#333",
  },
  a: {
    color: "#0066cc",
    textDecorationLine: "underline",
  },
  ul: {
    marginBottom: 16,
  },
  ol: {
    marginBottom: 16,
  },
  li: {
    fontSize: 16,
    lineHeight: 24,
    color: "#333",
  },
  blockquote: {
    backgroundColor: "#f5f5f5",
    borderLeftWidth: 4,
    borderLeftColor: "#ddd",
    paddingLeft: 12,
    marginBottom: 16,
    fontStyle: "italic",
  },
};

export default ExtractedContent;




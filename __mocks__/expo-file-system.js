const files = new Map();

module.exports = {
  documentDirectory: "file://mock-document/",
  EncodingType: {
    UTF8: "utf8",
  },
  makeDirectoryAsync: async () => {
    return true;
  },
  writeAsStringAsync: async (path, contents) => {
    files.set(path, contents);
  },
  readAsStringAsync: async (path) => {
    return files.get(path) || "";
  },
  getInfoAsync: async (path) => {
    return { exists: files.has(path) };
  },
  deleteAsync: async (path) => {
    files.delete(path);
  },
  __files: files,
};

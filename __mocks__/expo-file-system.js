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
  deleteAsync: async (path) => {
    files.delete(path);
  },
  __files: files,
};

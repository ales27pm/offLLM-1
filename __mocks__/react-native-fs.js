module.exports = {
  DocumentDirectoryPath: "/tmp",
  mkdir: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.reject(new Error("no file"))),
  appendFile: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve("")),
};

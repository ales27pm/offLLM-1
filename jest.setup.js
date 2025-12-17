global.__DEV__ = false;
jest.mock("react-native-fs");
jest.mock("react-native", () => {
  const createSubscription = () => ({ remove: jest.fn() });
  const mockEmitter = jest.fn(() => ({
    addListener: jest.fn(() => createSubscription()),
    removeAllListeners: jest.fn(),
    removeSubscription: jest.fn(),
  }));

  return {
    NativeModules: {
      DeviceInfo: {},
      MLXModule: {
        load: jest.fn().mockResolvedValue({ id: "mock" }),
        generate: jest.fn().mockResolvedValue(""),
        startStream: jest.fn().mockResolvedValue(undefined),
        reset: jest.fn(),
        unload: jest.fn(),
        stop: jest.fn(),
      },
      MLXEvents: {},
    },
    Platform: { OS: "ios" },
    TurboModuleRegistry: {
      getOptional: jest.fn().mockReturnValue(null),
    },
    NativeEventEmitter: mockEmitter,
  };
});
jest.mock("react-native-config");
jest.mock("expo-file-system");
jest.mock("./src/utils/NativeLogger", () => ({}));

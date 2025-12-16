jest.mock("@react-native-async-storage/async-storage", () => {
  let store = {};
  return {
    setItem: async (key, value) => {
      store[key] = value;
    },
    getItem: async (key) => (key in store ? store[key] : null),
    multiRemove: async (keys) => {
      keys.forEach((key) => {
        delete store[key];
      });
    },
    __clear: () => {
      store = {};
    },
  };
});

import { ConsentManager, ConsentType } from "../src/utils/consents";

const AsyncStorage = require("@react-native-async-storage/async-storage");

beforeEach(() => {
  AsyncStorage.__clear();
});

describe("ConsentManager", () => {
  test("stores and retrieves consent decisions", async () => {
    await ConsentManager.setConsent(ConsentType.DATA_SHARING, true);
    const record = await ConsentManager.getConsent(ConsentType.DATA_SHARING);
    expect(record).not.toBeNull();
    expect(record?.id).toBe(ConsentType.DATA_SHARING);
    expect(record?.granted).toBe(true);
    expect(record?.grantedAt).toBeInstanceOf(Date);
  });

  test("returns null when consent not found", async () => {
    const record = await ConsentManager.getConsent(ConsentType.VOICE_RECORDING);
    expect(record).toBeNull();
  });

  test("clears all stored consents", async () => {
    await ConsentManager.setConsent(ConsentType.DATA_SHARING, true);
    await ConsentManager.setConsent(ConsentType.VOICE_RECORDING, false);
    await ConsentManager.clearAllConsents();

    expect(
      await ConsentManager.getConsent(ConsentType.DATA_SHARING),
    ).toBeNull();
    expect(
      await ConsentManager.getConsent(ConsentType.VOICE_RECORDING),
    ).toBeNull();
  });

  test("handles invalid JSON entries gracefully", async () => {
    await AsyncStorage.setItem("consent_DATA_SHARING", "{invalid json");
    const record = await ConsentManager.getConsent(ConsentType.DATA_SHARING);
    expect(record).toBeNull();
  });
});

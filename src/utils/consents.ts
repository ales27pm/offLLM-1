import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Consent {
  id: string;
  granted: boolean;
  grantedAt: Date;
}

/** Keys for different consent categories in the app */
export enum ConsentType {
  DATA_SHARING = "DATA_SHARING",
  VOICE_RECORDING = "VOICE_RECORDING",
  // Add more as needed
}

/**
 * ConsentManager handles persisting user consents.
 * All methods are fully typed and do not rely on global __DEV__.
 */
export class ConsentManager {
  /**
   * Save a consent decision.
   * @param type The type of consent.
   * @param granted Whether consent was granted.
   */
  static async setConsent(type: ConsentType, granted: boolean): Promise<void> {
    const entry: Consent = {
      id: type,
      granted,
      grantedAt: new Date(),
    };
    await AsyncStorage.setItem(`consent_${type}`, JSON.stringify(entry));
  }

  /**
   * Retrieve a consent decision.
   * @param type The type of consent.
   * @returns The consent record, or null if not set.
   */
  static async getConsent(type: ConsentType): Promise<Consent | null> {
    const json = await AsyncStorage.getItem(`consent_${type}`);
    if (!json) {
      return null;
    }
    try {
      const obj = JSON.parse(json);
      return {
        id: obj.id,
        granted: obj.granted,
        grantedAt: new Date(obj.grantedAt),
      } as Consent;
    } catch {
      return null;
    }
  }

  /**
   * Clear all consents (e.g. on logout).
   */
  static async clearAllConsents(): Promise<void> {
    const keys = Object.values(ConsentType).map((type) => `consent_${type}`);
    await AsyncStorage.multiRemove(keys);
  }
}

import { NativeModules, Linking, Vibration, Clipboard } from "react-native";

const {
  CalendarTurboModule,
  MessagesTurboModule,
  CallTurboModule,
  MapsTurboModule,
  PhotosTurboModule,
  CameraTurboModule,
  FilesTurboModule,
  LocationTurboModule,
  ContactsTurboModule,
  MusicTurboModule,
  BatteryTurboModule,
  SensorsTurboModule,
  FlashlightTurboModule,
  DeviceInfoTurboModule,
  BrightnessTurboModule,
} = NativeModules;

// Calendar
export const createCalendarEventTool = {
  name: "create_calendar_event",
  description: "Create a new calendar event with title, date, location, notes",
  parameters: {
    title: { type: "string", required: true },
    startDate: {
      type: "string",
      required: true,
      description: "ISO 8601 format",
    },
    endDate: {
      type: "string",
      required: false,
      description: "ISO 8601 format",
    },
    location: { type: "string", required: false },
    notes: { type: "string", required: false },
  },
  execute: async (params) => {
    const hasEndDate = Boolean(params.endDate);
    const fallbackDuration = hasEndDate ? null : 3600;
    return await CalendarTurboModule.createEvent(
      params.title,
      params.startDate,
      hasEndDate ? params.endDate : null,
      fallbackDuration,
      params.location ?? null,
      params.notes ?? null,
    );
  },
};

// Messages
export const sendMessageTool = {
  name: "send_message",
  description: "Compose and send SMS/iMessage (user confirmation required)",
  parameters: {
    recipient: {
      type: "string",
      required: true,
      description: "Phone number or email",
    },
    body: { type: "string", required: true },
  },
  execute: async (params) =>
    await MessagesTurboModule.sendMessage(params.recipient, params.body),
};

// Phone calls
export const makePhoneCallTool = {
  name: "make_phone_call",
  description: "Initiate a phone call (user confirmation required)",
  parameters: {
    phoneNumber: { type: "string", required: true },
  },
  execute: async (params) => {
    const url = `tel:${params.phoneNumber}`;
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return { success: true };
    }
    throw new Error("Cannot make call");
  },
};

export const getCallHistoryTool = {
  name: "get_call_history",
  description: "Get recent call history (limited access)",
  parameters: {
    limit: { type: "number", required: false, default: 10 },
  },
  execute: async (params) =>
    await CallTurboModule.getRecentCalls(params.limit || 10),
};

// Location
export const getCurrentLocationTool = {
  name: "get_current_location",
  description: "Get current GPS location",
  parameters: {
    accuracy: {
      type: "string",
      required: false,
      default: "high",
      enum: ["low", "medium", "high"],
    },
  },
  execute: async (params) =>
    await LocationTurboModule.getCurrentLocation(params.accuracy || "high"),
};

export const startLocationUpdatesTool = {
  name: "start_location_updates",
  description: "Start continuous location updates",
  parameters: {
    interval: { type: "number", required: false, default: 10000 },
  },
  execute: async (params) =>
    await LocationTurboModule.startUpdates(params.interval || 10000),
};

export const stopLocationUpdatesTool = {
  name: "stop_location_updates",
  description: "Stop location updates",
  parameters: {},
  execute: async () => await LocationTurboModule.stopUpdates(),
};

// Maps
export const showMapTool = {
  name: "show_map",
  description: "Display map at location",
  parameters: {
    latitude: { type: "number", required: true },
    longitude: { type: "number", required: true },
    title: { type: "string", required: false },
  },
  execute: async (params) =>
    await MapsTurboModule.showMap(
      params.latitude,
      params.longitude,
      params.title,
    ),
};

export const getDirectionsTool = {
  name: "get_directions",
  description: "Get directions between points",
  parameters: {
    from: {
      type: "string",
      required: true,
      description: "Address or lat,long",
    },
    to: { type: "string", required: true, description: "Address or lat,long" },
    mode: {
      type: "string",
      required: false,
      default: "driving",
      enum: ["driving", "walking", "transit"],
    },
  },
  execute: async (params) =>
    await MapsTurboModule.getDirections(
      params.from,
      params.to,
      params.mode || "driving",
    ),
};

export const searchPlacesTool = {
  name: "search_places",
  description: "Search for places on map",
  parameters: {
    query: { type: "string", required: true },
    near: {
      type: "string",
      required: false,
      description: "lat,long or address",
    },
  },
  execute: async (params) =>
    await MapsTurboModule.searchPlaces(params.query, params.near),
};

// Contacts
export const findContactTool = {
  name: "find_contact",
  description: "Find contact by name or number",
  parameters: {
    query: { type: "string", required: true },
  },
  execute: async (params) =>
    await ContactsTurboModule.findContact(params.query),
};

export const addContactTool = {
  name: "add_contact",
  description: "Add new contact",
  parameters: {
    name: { type: "string", required: true },
    phone: { type: "string", required: false },
    email: { type: "string", required: false },
  },
  execute: async (params) =>
    await ContactsTurboModule.addContact(
      params.name,
      params.phone,
      params.email,
    ),
};

// Music
export const playMusicTool = {
  name: "play_music",
  description: "Play music from library",
  parameters: {
    query: {
      type: "string",
      required: true,
      description: "Song, artist, or playlist",
    },
  },
  execute: async (params) => await MusicTurboModule.playMusic(params.query),
};

export const getMusicLibraryTool = {
  name: "get_music_library",
  description: "Search music library",
  parameters: {
    query: { type: "string", required: true },
    type: {
      type: "string",
      required: false,
      default: "songs",
      enum: ["songs", "artists", "playlists"],
    },
  },
  execute: async (params) =>
    await MusicTurboModule.searchLibrary(params.query, params.type || "songs"),
};

// Battery
export const getBatteryInfoTool = {
  name: "get_battery_info",
  description: "Get battery level and state",
  parameters: {},
  execute: async () => await BatteryTurboModule.getBatteryInfo(),
};

// Sensors
export const getSensorDataTool = {
  name: "get_sensor_data",
  description: "Get accelerometer/gyro/magnetometer data",
  parameters: {
    type: {
      type: "string",
      required: true,
      enum: ["accelerometer", "gyroscope", "magnetometer"],
    },
    duration: { type: "number", required: false, default: 1000 },
  },
  execute: async (params) =>
    await SensorsTurboModule.getSensorData(
      params.type,
      params.duration || 1000,
    ),
};

// Clipboard
export const setClipboardTool = {
  name: "set_clipboard",
  description: "Set text to clipboard",
  parameters: {
    text: { type: "string", required: true },
  },
  execute: async (params) => {
    Clipboard.setString(params.text);
    return { success: true };
  },
};

export const getClipboardTool = {
  name: "get_clipboard",
  description: "Get text from clipboard",
  parameters: {},
  execute: async () => ({ text: await Clipboard.getString() }),
};

// Vibration
export const vibrateTool = {
  name: "vibrate",
  description: "Vibrate device",
  parameters: {
    pattern: { type: "array", required: false, default: [1000] },
  },
  execute: async (params) => {
    Vibration.vibrate(params.pattern || [1000]);
    return { success: true };
  },
};

// Flashlight
export const toggleFlashlightTool = {
  name: "toggle_flashlight",
  description: "Toggle flashlight on/off",
  parameters: {
    on: { type: "boolean", required: true },
  },
  execute: async (params) =>
    await FlashlightTurboModule.setTorchMode(params.on),
};

// Device info
export const getDeviceInfoTool = {
  name: "get_device_info",
  description: "Get device information",
  parameters: {},
  execute: async () => await DeviceInfoTurboModule.getDeviceInfo(),
};

// Brightness
export const setBrightnessTool = {
  name: "set_brightness",
  description: "Set screen brightness (0-1)",
  parameters: {
    level: { type: "number", required: true },
  },
  execute: async (params) =>
    await BrightnessTurboModule.setBrightness(params.level),
};

// Photos
export const pickPhotoTool = {
  name: "pick_photo",
  description: "Pick photo from library",
  parameters: {},
  execute: async () => await PhotosTurboModule.pickPhoto(),
};

export const takePhotoTool = {
  name: "take_photo",
  description: "Take photo with camera",
  parameters: {
    quality: { type: "number", required: false, default: 0.8 },
  },
  execute: async (params) =>
    await CameraTurboModule.takePhoto(params.quality || 0.8),
};

// Files
export const pickFileTool = {
  name: "pick_file",
  description: "Pick file from device",
  parameters: {
    type: { type: "string", required: false, default: "any" },
  },
  execute: async (params) =>
    await FilesTurboModule.pickFile(params.type || "any"),
};

export const openRecentFileTool = {
  name: "open_recent_file",
  description: "Open the most recently used file",
  parameters: {},
  execute: async () => await FilesTurboModule.openRecent(),
};

// URL
export const openUrlTool = {
  name: "open_url",
  description: "Open URL in default browser",
  parameters: {
    url: { type: "string", required: true },
  },
  execute: async (params) => {
    if (await Linking.canOpenURL(params.url)) {
      await Linking.openURL(params.url);
      return { success: true };
    }
    throw new Error("Cannot open URL");
  },
};

export const openSettingsTool = {
  name: "open_settings",
  description: "Open device settings",
  parameters: {
    section: { type: "string", required: false },
  },
  execute: async (params) => {
    const url = params.section
      ? `app-settings:${params.section}`
      : "app-settings:";
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return { success: true };
    }
    throw new Error("Cannot open settings");
  },
};

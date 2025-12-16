export const unsupported = (name) => ({
  name,
  execute: async () => {
    throw new Error(`${name} is unsupported on Android`);
  },
});

export const getBatteryInfoTool = unsupported("get_battery_info");
export const getCurrentLocationTool = unsupported("get_current_location");
export const createCalendarEventTool = unsupported("create_calendar_event");
export const showMapTool = unsupported("show_map");
export const setClipboardTool = unsupported("set_clipboard");
export const getClipboardTool = unsupported("get_clipboard");
export const openRecentFileTool = unsupported("open_recent_file");
export const openSettingsTool = unsupported("open_settings");




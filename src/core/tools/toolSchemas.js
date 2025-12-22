export const toolSchemas = new Map([
  [
    "create_calendar_event",
    require("../../../schemas/tools/create_calendar_event.schema.json"),
  ],
  ["send_message", require("../../../schemas/tools/send_message.schema.json")],
  [
    "make_phone_call",
    require("../../../schemas/tools/make_phone_call.schema.json"),
  ],
  [
    "get_call_history",
    require("../../../schemas/tools/get_call_history.schema.json"),
  ],
  [
    "get_current_location",
    require("../../../schemas/tools/get_current_location.schema.json"),
  ],
  [
    "start_location_updates",
    require("../../../schemas/tools/start_location_updates.schema.json"),
  ],
  [
    "stop_location_updates",
    require("../../../schemas/tools/stop_location_updates.schema.json"),
  ],
  ["show_map", require("../../../schemas/tools/show_map.schema.json")],
  [
    "get_directions",
    require("../../../schemas/tools/get_directions.schema.json"),
  ],
  [
    "search_places",
    require("../../../schemas/tools/search_places.schema.json"),
  ],
  ["find_contact", require("../../../schemas/tools/find_contact.schema.json")],
  ["add_contact", require("../../../schemas/tools/add_contact.schema.json")],
  ["play_music", require("../../../schemas/tools/play_music.schema.json")],
  [
    "get_music_library",
    require("../../../schemas/tools/get_music_library.schema.json"),
  ],
  [
    "get_battery_info",
    require("../../../schemas/tools/get_battery_info.schema.json"),
  ],
  [
    "get_sensor_data",
    require("../../../schemas/tools/get_sensor_data.schema.json"),
  ],
  [
    "set_clipboard",
    require("../../../schemas/tools/set_clipboard.schema.json"),
  ],
  [
    "get_clipboard",
    require("../../../schemas/tools/get_clipboard.schema.json"),
  ],
  ["vibrate", require("../../../schemas/tools/vibrate.schema.json")],
  [
    "toggle_flashlight",
    require("../../../schemas/tools/toggle_flashlight.schema.json"),
  ],
  [
    "get_device_info",
    require("../../../schemas/tools/get_device_info.schema.json"),
  ],
  [
    "set_brightness",
    require("../../../schemas/tools/set_brightness.schema.json"),
  ],
  ["pick_photo", require("../../../schemas/tools/pick_photo.schema.json")],
  ["take_photo", require("../../../schemas/tools/take_photo.schema.json")],
  ["pick_file", require("../../../schemas/tools/pick_file.schema.json")],
  [
    "open_recent_file",
    require("../../../schemas/tools/open_recent_file.schema.json"),
  ],
  ["open_url", require("../../../schemas/tools/open_url.schema.json")],
  [
    "open_settings",
    require("../../../schemas/tools/open_settings.schema.json"),
  ],
  ["web_search", require("../../../schemas/tools/web_search.schema.json")],
]);

export const getToolSchema = (name) => toolSchemas.get(name);

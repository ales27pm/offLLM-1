package com.mongars;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.text.TextUtils;
import android.content.ContentUris;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;
import java.text.ParseException;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * CalendarTurboModule enables creation of calendar events on Android using
 * {@link CalendarContract}. Events are inserted into the first writable
 * calendar found on the device. Dates are expected in ISO 8601 format
 * (e.g. 2025-08-26T15:00:00Z). If an end date is omitted a one hour
 * duration is applied. If parsing fails or a calendar cannot be located
 * the promise is rejected.
 */
@ReactModule(name = CalendarTurboModule.NAME)
public class CalendarTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "CalendarTurboModule";

    public CalendarTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void createEvent(String title, String startDate, String endDate,
                            Double durationSeconds, String location, String notes,
                            Promise promise) {
        ReactApplicationContext ctx = getReactApplicationContext();
        try {
            long startMillis = parseIsoDate(startDate);
            long endMillis;
            if (!TextUtils.isEmpty(endDate)) {
                endMillis = parseIsoDate(endDate);
            } else if (durationSeconds != null) {
                endMillis = startMillis + durationSeconds.longValue() * 1000L;
            } else {
                endMillis = startMillis + 3600 * 1000L;
            }
            if (endMillis <= startMillis) {
                promise.reject("DATE_ERROR", "End date must be after start date");
                return;
            }
            long calendarId = findPrimaryCalendarId(ctx.getContentResolver());
            if (calendarId == -1) {
                promise.reject("CALENDAR_ERROR", "No writable calendar found");
                return;
            }
            ContentValues values = new ContentValues();
            values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
            values.put(CalendarContract.Events.TITLE, title);
            values.put(CalendarContract.Events.DTSTART, startMillis);
            values.put(CalendarContract.Events.DTEND, endMillis);
            values.put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().getID());
            if (!TextUtils.isEmpty(location)) values.put(CalendarContract.Events.EVENT_LOCATION, location);
            if (!TextUtils.isEmpty(notes)) values.put(CalendarContract.Events.DESCRIPTION, notes);
            Uri uri = ctx.getContentResolver().insert(CalendarContract.Events.CONTENT_URI, values);
            if (uri == null) {
                promise.reject("SAVE_ERROR", "Failed to insert event");
                return;
            }
            long id = ContentUris.parseId(uri);
            com.facebook.react.bridge.WritableMap result = new com.facebook.react.bridge.WritableNativeMap();
            result.putBoolean("success", true);
            result.putString("eventId", String.valueOf(id));
            promise.resolve(result);
        } catch (ParseException e) {
            ModuleUtils.rejectWithException(promise, "DATE_ERROR", e);
        } catch (SecurityException e) {
            ModuleUtils.rejectWithException(promise, "PERMISSION_DENIED", e);
        } catch (Exception e) {
            ModuleUtils.rejectWithException(promise, "CALENDAR_ERROR", e);
        }
    }

    private long findPrimaryCalendarId(ContentResolver resolver) {
        final String[] projection = new String[]{
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.VISIBLE,
                CalendarContract.Calendars.SYNC_EVENTS
        };
        try (Cursor cursor = resolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                projection,
                CalendarContract.Calendars.VISIBLE + " = 1", null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        }
        return -1;
    }

    private long parseIsoDate(String iso) throws ParseException {
        // Robustly parse ISO 8601 timestamps, supporting optional milliseconds and timezone.
        try {
            DateTimeFormatter formatterWithZone = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss[.SSS]X")
                    .withLocale(Locale.US);
            OffsetDateTime odt = OffsetDateTime.parse(iso, formatterWithZone);
            return odt.toInstant().toEpochMilli();
        } catch (Exception e) {
            try {
                DateTimeFormatter formatterNoZone = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss[.SSS]")
                        .withLocale(Locale.US);
                LocalDateTime ldt = LocalDateTime.parse(iso, formatterNoZone);
                return ldt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            } catch (Exception ex) {
                throw new ParseException("Unable to parse: " + iso, 0);
            }
        }
    }
}

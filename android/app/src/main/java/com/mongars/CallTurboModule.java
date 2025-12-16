package com.mongars;

import android.database.Cursor;
import android.provider.CallLog;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;

/**
 * CallTurboModule exposes the device's call log to JavaScript. The
 * getRecentCalls method returns an array of the most recent calls with
 * basic metadata: number, type (incoming=1, outgoing=2, missed=3), date
 * (milliseconds since epoch) and duration (seconds). READ_CALL_LOG
 * permission is required; calls will be rejected if not granted.
 */
@ReactModule(name = CallTurboModule.NAME)
public class CallTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "CallTurboModule";

    public CallTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void getRecentCalls(int limit, Promise promise) {
        if (limit <= 0) limit = 10;
        WritableArray result = new WritableNativeArray();
        try (Cursor cursor = getReactApplicationContext().getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                new String[]{CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION},
                null, null,
                CallLog.Calls.DATE + " DESC")) {
            if (cursor != null) {
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    String number = cursor.getString(0);
                    int type = cursor.getInt(1);
                    long date = cursor.getLong(2);
                    long duration = cursor.getLong(3);
                    WritableMap map = new WritableNativeMap();
                    map.putString("number", number != null ? number : "");
                    map.putInt("type", type);
                    map.putDouble("date", (double) date);
                    map.putDouble("duration", (double) duration);
                    result.pushMap(map);
                    count++;
                }
            }
            promise.resolve(result);
        } catch (SecurityException e) {
            promise.reject("permission_denied", "Call log access denied", e);
        } catch (Exception e) {
            promise.reject("call_error", e.getMessage(), e);
        }
    }
}

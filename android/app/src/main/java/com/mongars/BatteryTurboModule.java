package com.mongars;

import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;

/**
 * BatteryTurboModule provides access to basic battery information on Android. It
 * mirrors the behaviour of the iOS implementation by resolving a promise with
 * the current battery level (0-100) and charging state. The charging state
 * corresponds to the constants exposed by {@link BatteryManager}: 1=unknown,
 * 2=charging, 3=discharging, 4=not charging, 5=full.
 */
@ReactModule(name = BatteryTurboModule.NAME)
public class BatteryTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "BatteryTurboModule";

    public BatteryTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    /**
     * Returns the current battery level and state. This method listens to the
     * ACTION_BATTERY_CHANGED broadcast synchronously by registering a null
     * receiver. If no battery information can be obtained the promise is
     * rejected.
     *
     * @param promise promise to resolve with battery info
     */
    @ReactMethod
    public void getBatteryInfo(Promise promise) {
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = getReactApplicationContext().registerReceiver(null, ifilter);
            if (batteryStatus == null) {
                promise.reject("BATTERY_ERROR", "Unable to retrieve battery status");
                return;
            }
            int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN);
            float pct = (level >= 0 && scale > 0) ? (level * 100f) / scale : -1f;
            WritableMap result = new WritableNativeMap();
            result.putDouble("level", pct);
            result.putInt("state", status);
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("BATTERY_ERROR", e.getMessage(), e);
        }
    }
}

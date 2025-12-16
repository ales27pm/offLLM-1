package com.mongars;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;

/**
 * DeviceInfoTurboModule exposes basic information about the Android device.
 * Fields mirror the iOS implementation where possible. The identifier
 * corresponds to the ANDROID_ID and may change if the device is factory
 * reset. Low power mode information is retrieved via {@link PowerManager}.
 */
@ReactModule(name = DeviceInfoTurboModule.NAME)
public class DeviceInfoTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "DeviceInfoTurboModule";

    public DeviceInfoTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void getDeviceInfo(Promise promise) {
        try {
            WritableMap result = new WritableNativeMap();
            result.putString("model", Build.MODEL != null ? Build.MODEL : "");
            result.putString("systemName", "Android");
            result.putString("systemVersion", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
            result.putString("name", Build.DEVICE != null ? Build.DEVICE : "");
            // Note: ANDROID_ID may change after a factory reset and may not be unique on all
            // devices, such as emulators and some tablets. Use with caution if you require a
            // stable or unique identifier.
            String androidId = Settings.Secure.getString(getReactApplicationContext().getContentResolver(), Settings.Secure.ANDROID_ID);
            result.putString("identifierForVendor", androidId != null ? androidId : "unknown");
            PowerManager pm = (PowerManager) getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
            boolean isLowPower = pm != null && pm.isPowerSaveMode();
            result.putBoolean("isLowPowerMode", isLowPower);
            promise.resolve(result);
        } catch (Exception e) {
            ModuleUtils.rejectWithException(promise, "DEVICE_INFO_ERROR", e);
        }
    }
}

package com.mongars;

import android.app.Activity;
import android.view.Window;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * BrightnessTurboModule allows adjusting the screen brightness for the current
 * activity. Unlike system-wide brightness changes via Settings.System, this
 * implementation updates the window attributes which does not require
 * additional permissions. Values should be between 0 and 1 inclusive. If no
 * activity is currently active the promise is rejected.
 */
@ReactModule(name = BrightnessTurboModule.NAME)
public class BrightnessTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "BrightnessTurboModule";

    public BrightnessTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    /**
     * Sets the brightness for the current activity. Level values outside the
     * range [0,1] are clamped. The change applies immediately and only
     * persists as long as the activity is in the foreground.
     *
     * @param level   desired brightness between 0 and 1
     * @param promise promise resolved once the value is applied
     */
    @ReactMethod
    public void setBrightness(double level, Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No active activity to set brightness on");
            return;
        }
        try {
            Window window = activity.getWindow();
            WindowManager.LayoutParams layoutParams = window.getAttributes();
            float clamped = (float) Math.max(0f, Math.min(1f, level));
            layoutParams.screenBrightness = clamped;
            window.setAttributes(layoutParams);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("BRIGHTNESS_ERROR", e.getMessage(), e);
        }
    }
}

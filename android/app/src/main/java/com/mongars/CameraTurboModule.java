package com.mongars;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * CameraTurboModule is a stub implementation for Android. Capturing
 * photos from the device camera requires a foreground activity and a
 * FileProvider setup, which is beyond the scope of this example. The
 * method returns a rejected promise indicating the lack of support. A
 * full implementation could leverage React Native's CameraX modules or
 * third party libraries.
 */
@ReactModule(name = CameraTurboModule.NAME)
public class CameraTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "CameraTurboModule";

    public CameraTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void takePhoto(double quality, Promise promise) {
        promise.reject("NOT_SUPPORTED", "Camera capture is not implemented on Android");
    }
}

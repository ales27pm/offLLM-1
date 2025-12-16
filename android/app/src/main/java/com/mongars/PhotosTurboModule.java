package com.mongars;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * PhotosTurboModule provides a stub for photo picking on Android. Picking
 * images from the gallery requires an activity result handler; this
 * headless module does not support that functionality. Use a dedicated
 * library such as react-native-image-picker instead.
 */
@ReactModule(name = PhotosTurboModule.NAME)
public class PhotosTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "PhotosTurboModule";

    public PhotosTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void pickPhoto(Promise promise) {
        promise.reject("NOT_SUPPORTED", "Photo picking is not implemented on Android");
    }
}

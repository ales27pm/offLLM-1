package com.mongars;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * FilesTurboModule provides file selection on Android. Implementing a file
 * picker requires an activity with an {@link android.content.Intent} and
 * result handling which cannot be achieved from a headless module alone.
 * For now this module rejects any call. Consider using a third party
 * React Native library such as react-native-document-picker for full
 * functionality.
 */
@ReactModule(name = FilesTurboModule.NAME)
public class FilesTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "FilesTurboModule";

    public FilesTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void pickFile(String type, Promise promise) {
        promise.reject("NOT_SUPPORTED", "File picking is not implemented on Android");
    }
}

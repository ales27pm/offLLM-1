package com.mongars;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * MusicTurboModule provides stubs for music playback and searching on
 * Android. Access to the system music library is restricted and cannot
 * be implemented without a custom media browser or usage of external
 * services. Calls to this module will reject indicating the lack of
 * support.
 */
@ReactModule(name = MusicTurboModule.NAME)
public class MusicTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "MusicTurboModule";

    public MusicTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void playMusic(String query, Promise promise) {
        promise.reject("NOT_SUPPORTED", "Music playback is not implemented on Android");
    }

    @ReactMethod
    public void searchLibrary(String query, String type, Promise promise) {
        promise.reject("NOT_SUPPORTED", "Music search is not implemented on Android");
    }
}

package com.mongars;

import android.content.Intent;
import android.net.Uri;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * MapsTurboModule provides basic integration with mapping applications on
 * Android. It relies on implicit intents to launch Google Maps or a
 * compatible mapping app. Advanced features such as place search and
 * directions parsing are not implemented and will reject.
 */
@ReactModule(name = MapsTurboModule.NAME)
public class MapsTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "MapsTurboModule";

    public MapsTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void showMap(double latitude, double longitude, String title, Promise promise) {
        try {
            String uri = "geo:" + latitude + "," + longitude;
            if (title != null && !title.isEmpty()) {
                uri += "?q=" + latitude + "," + longitude + "(" + Uri.encode(title) + ")";
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("MAP_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void getDirections(String from, String to, String mode, Promise promise) {
        // Construct a URL for Google Maps directions and launch it. We do not
        // parse directions but instead hand off to the Maps app. Mode can be
        // driving, walking or transit.
        try {
            String url = "https://www.google.com/maps/dir/?api=1&origin=" + Uri.encode(from) + "&destination=" + Uri.encode(to);
            if (mode != null && !mode.isEmpty()) {
                url += "&travelmode=" + mode;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("MAP_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void searchPlaces(String query, String near, Promise promise) {
        promise.reject("NOT_SUPPORTED", "Place search is not implemented on Android");
    }
}

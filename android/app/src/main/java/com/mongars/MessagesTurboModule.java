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
 * MessagesTurboModule composes an SMS or MMS message using an implicit
 * intent. A third party messaging app will handle the actual sending
 * after the user confirms. Directly sending messages without user
 * interaction is restricted on modern Android versions.
 */
@ReactModule(name = MessagesTurboModule.NAME)
public class MessagesTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "MessagesTurboModule";

    public MessagesTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void sendMessage(String recipient, String body, Promise promise) {
        if (recipient == null || recipient.isEmpty()) {
            promise.reject("INVALID_ARGUMENT", "recipient is required");
            return;
        }
        if (body == null) body = "";
        try {
            Intent intent = new Intent(Intent.ACTION_SENDTO);
            intent.setData(Uri.parse("smsto:" + Uri.encode(recipient)));
            intent.putExtra("sms_body", body);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            com.facebook.react.bridge.WritableMap result = new com.facebook.react.bridge.WritableNativeMap();
            result.putBoolean("success", true);
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("SEND_ERROR", e.getMessage(), e);
        }
    }
}

package com.mongars;

import android.content.Context;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import com.facebook.react.bridge.Promise;

/**
 * ModuleUtils provides small helpers used across multiple TurboModules
 * to reduce boilerplate for permission checks and promise rejections.
 */
public final class ModuleUtils {
    private ModuleUtils() {}

    /**
     * Returns true if the given permission has been granted.
     */
    public static boolean hasPermission(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Returns true if at least one of the provided permissions has been granted.
     */
    public static boolean hasAnyPermission(Context context, String... permissions) {
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED) {
                return true;
            }
        }
        return false;
    }

    /**
     * Rejects the promise with the supplied code and exception message.
     */
    public static void rejectWithException(Promise promise, String code, Exception e) {
        promise.reject(code, e.getMessage(), e);
    }
}

package com.mongars;

import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

/**
 * FlashlightTurboModule toggles the device torch (flashlight) on or off.
 * The implementation searches for the first camera with an available
 * flash unit and uses {@link CameraManager#setTorchMode(String, boolean)}
 * to change its state. On devices without a flash or if the operation
 * fails the promise is rejected.
 */
@ReactModule(name = FlashlightTurboModule.NAME)
public class FlashlightTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "FlashlightTurboModule";

    public FlashlightTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void setTorchMode(boolean on, Promise promise) {
        CameraManager cameraManager = (CameraManager) getReactApplicationContext().getSystemService(Context.CAMERA_SERVICE);
        if (cameraManager == null) {
            promise.reject("no_torch", "Camera service unavailable");
            return;
        }
        try {
            String[] ids = cameraManager.getCameraIdList();
            String torchId = null;
            for (String id : ids) {
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                Boolean flashAvailable = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer lensFacing = c.get(CameraCharacteristics.LENS_FACING);
                // Prefer back facing camera with flash
                if (flashAvailable != null && flashAvailable && lensFacing != null && lensFacing == CameraCharacteristics.LENS_FACING_BACK) {
                    torchId = id;
                    break;
                }
            }
            if (torchId == null) {
                // Fallback: find any camera with a flash (regardless of lens facing)
                for (String id : ids) {
                    CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                    Boolean flashAvailable = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (flashAvailable != null && flashAvailable) {
                        torchId = id;
                        break;
                    }
                }
            }
            if (torchId == null) {
                promise.reject("no_torch", "No camera with flash available");
                return;
            }
            cameraManager.setTorchMode(torchId, on);
            com.facebook.react.bridge.WritableMap res = new com.facebook.react.bridge.WritableNativeMap();
            res.putBoolean("success", true);
            promise.resolve(res);
        } catch (CameraAccessException e) {
            ModuleUtils.rejectWithException(promise, "lock_error", e);
        }
    }
}

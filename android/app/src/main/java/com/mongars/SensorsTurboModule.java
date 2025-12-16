package com.mongars;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;

/**
 * SensorsTurboModule collects accelerometer, gyroscope or magnetometer data
 * over a specified duration and returns the averaged X/Y/Z values. The
 * sampling frequency is determined by SENSOR_DELAY_GAME (approx. 50Hz). If
 * the requested sensor is unavailable or any error occurs, the promise is
 * rejected. Ensure that the host device includes the appropriate sensors.
 */
@ReactModule(name = SensorsTurboModule.NAME)
public class SensorsTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "SensorsTurboModule";

    public SensorsTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void getSensorData(String type, int duration, Promise promise) {
        SensorManager sensorManager = (SensorManager) getReactApplicationContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) {
            promise.reject("sensor_error", "Sensor service unavailable");
            return;
        }
        int sensorType;
        if ("accelerometer".equalsIgnoreCase(type)) {
            sensorType = Sensor.TYPE_ACCELEROMETER;
        } else if ("gyroscope".equalsIgnoreCase(type)) {
            sensorType = Sensor.TYPE_GYROSCOPE;
        } else if ("magnetometer".equalsIgnoreCase(type)) {
            sensorType = Sensor.TYPE_MAGNETIC_FIELD;
        } else {
            promise.reject("invalid_type", "Unsupported sensor type");
            return;
        }
        Sensor sensor = sensorManager.getDefaultSensor(sensorType);
        if (sensor == null) {
            promise.reject("sensor_unavailable", "Requested sensor is not available");
            return;
        }
        final float[] sums = new float[]{0f, 0f, 0f};
        final int[] count = new int[]{0};
        SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (event.values != null && event.values.length >= 3) {
                    sums[0] += event.values[0];
                    sums[1] += event.values[1];
                    sums[2] += event.values[2];
                    count[0]++;
                }
            }
            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {}
        };
        if (duration <= 0) {
            promise.reject("invalid_duration", "Duration must be positive and non-zero.");
            return;
        }
        try {
            sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME);
        } catch (Exception e) {
            ModuleUtils.rejectWithException(promise, "sensor_error", e);
            return;
        }
        int durationMs = duration;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            sensorManager.unregisterListener(listener);
            int samples = count[0];
            float avgX = samples > 0 ? sums[0] / samples : 0f;
            float avgY = samples > 0 ? sums[1] / samples : 0f;
            float avgZ = samples > 0 ? sums[2] / samples : 0f;
            WritableMap map = new WritableNativeMap();
            map.putDouble("x", avgX);
            map.putDouble("y", avgY);
            map.putDouble("z", avgZ);
            promise.resolve(map);
        }, durationMs);
    }
}

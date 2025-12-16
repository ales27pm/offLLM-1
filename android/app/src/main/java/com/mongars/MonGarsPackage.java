package com.mongars;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * MonGarsPackage registers the custom TurboModules implemented in this
 * application with the React Native bridge. Older architectures rely on
 * explicit registration via a ReactPackage, whereas the new architecture
 * will auto-link modules annotated with @ReactModule. Including this
 * package provides backwards compatibility across versions. Add the
 * package to your MainApplication#getPackages() method to ensure modules
 * are available.
 */
public class MonGarsPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new BatteryTurboModule(reactContext));
        modules.add(new BrightnessTurboModule(reactContext));
        modules.add(new CalendarTurboModule(reactContext));
        modules.add(new CallTurboModule(reactContext));
        modules.add(new CameraTurboModule(reactContext));
        modules.add(new ContactsTurboModule(reactContext));
        modules.add(new DeviceInfoTurboModule(reactContext));
        modules.add(new FilesTurboModule(reactContext));
        modules.add(new FlashlightTurboModule(reactContext));
        modules.add(new LocationTurboModule(reactContext));
        modules.add(new MapsTurboModule(reactContext));
        modules.add(new MessagesTurboModule(reactContext));
        modules.add(new MusicTurboModule(reactContext));
        modules.add(new PhotosTurboModule(reactContext));
        modules.add(new SensorsTurboModule(reactContext));
        modules.add(new LlamaTurboModule(reactContext));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}

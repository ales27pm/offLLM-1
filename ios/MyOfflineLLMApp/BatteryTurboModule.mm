#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface BatteryTurboModule : NSObject <RCTBridgeModule>
@end

@implementation BatteryTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getBatteryInfo:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [[UIDevice currentDevice] setBatteryMonitoringEnabled:YES];
    float level = [UIDevice currentDevice].batteryLevel;
    UIDeviceBatteryState state = [UIDevice currentDevice].batteryState;
    resolve(@{
      @"level": @(level * 100),
      @"state": @(state)
    });
    [[UIDevice currentDevice] setBatteryMonitoringEnabled:NO];
  });
}

@end





#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <sys/utsname.h>

@interface DeviceInfoTurboModule : NSObject <RCTBridgeModule>
@end

@implementation DeviceInfoTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getDeviceInfo:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  struct utsname systemInfo;
  uname(&systemInfo);
  NSString *machine = [NSString stringWithCString:systemInfo.machine encoding:NSUTF8StringEncoding];
  UIDevice *device = [UIDevice currentDevice];
  resolve(@{
    @"model": machine,
    @"systemName": device.systemName,
    @"systemVersion": device.systemVersion,
    @"name": device.name,
    @"identifierForVendor": device.identifierForVendor.UUIDString ?: @"unknown",
    @"isLowPowerMode": @([NSProcessInfo processInfo].isLowPowerModeEnabled)
  });
}

@end





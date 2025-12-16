#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface BrightnessTurboModule : NSObject <RCTBridgeModule>
@end

@implementation BrightnessTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(setBrightness:(double)level resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIScreen mainScreen].brightness = level;
    resolve(@{ @"success": @YES });
  });
}

@end





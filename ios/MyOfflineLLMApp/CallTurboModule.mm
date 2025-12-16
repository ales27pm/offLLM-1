#import <React/RCTBridgeModule.h>

@interface CallTurboModule : NSObject <RCTBridgeModule>
@end

@implementation CallTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getRecentCalls:(NSInteger)limit resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@[]);
}

@end





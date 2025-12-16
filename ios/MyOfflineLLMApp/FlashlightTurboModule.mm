#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>

@interface FlashlightTurboModule : NSObject <RCTBridgeModule>
@end

@implementation FlashlightTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(setTorchMode:(BOOL)on resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    if ([device hasTorch]) {
      NSError *error = nil;
      [device lockForConfiguration:&error];
      if (error) {
        reject(@"lock_error", error.localizedDescription, error);
        return;
      }
      device.torchMode = on ? AVCaptureTorchModeOn : AVCaptureTorchModeOff;
      [device unlockForConfiguration];
      resolve(@{ @"success": @YES });
    } else {
      reject(@"no_torch", @"Device has no flashlight", nil);
    }
  });
}

@end





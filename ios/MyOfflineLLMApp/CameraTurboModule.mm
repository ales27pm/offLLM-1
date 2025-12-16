#import <React/RCTBridgeModule.h>
#import "React/RCTUtils.h"
#import <UIKit/UIKit.h>

@interface CameraTurboModule : NSObject <RCTBridgeModule, UIImagePickerControllerDelegate, UINavigationControllerDelegate>
@property(nonatomic, strong) RCTPromiseResolveBlock resolver;
@property(nonatomic, strong) RCTPromiseRejectBlock rejecter;
@end

@implementation CameraTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(takePhoto:(double)quality resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  self.resolver = resolve;
  self.rejecter = reject;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = UIImagePickerControllerSourceTypeCamera;
    picker.cameraCaptureMode = UIImagePickerControllerCameraCaptureModePhoto;
    picker.delegate = self;
    UIViewController *root = RCTPresentedViewController();
    if (root) {
      [root presentViewController:picker animated:YES completion:nil];
    } else if (self.rejecter) {
      self.rejecter(@"no_view_controller", @"Unable to find root view controller", nil);
      self.resolver = nil;
      self.rejecter = nil;
    }
  });
}

- (void)imagePickerController:(UIImagePickerController *)picker didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey,id> *)info {
  NSURL *url = info[UIImagePickerControllerImageURL];
  if (self.resolver) self.resolver(@{ @"url": url.absoluteString ?: @"" });
  self.resolver = nil;
  self.rejecter = nil;
  [picker dismissViewControllerAnimated:YES completion:nil];
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker {
  if (self.rejecter) self.rejecter(@"capture_cancel", @"User cancelled camera", nil);
  self.resolver = nil;
  self.rejecter = nil;
  [picker dismissViewControllerAnimated:YES completion:nil];
}

@end





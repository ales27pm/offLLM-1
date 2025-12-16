#import <React/RCTBridgeModule.h>
#import "React/RCTUtils.h"
#import <MessageUI/MessageUI.h>

@interface MessagesTurboModule : NSObject <RCTBridgeModule, MFMessageComposeViewControllerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock resolve;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@end

@implementation MessagesTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(sendMessage:(NSString *)phoneNumber
                  body:(NSString *)body
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![MFMessageComposeViewController canSendText]) {
    reject(@"NOT_SUPPORTED", @"SMS not available", nil);
    return;
  }

  if (phoneNumber == nil || [phoneNumber length] == 0) {
    reject(@"INVALID_ARGUMENT", @"phoneNumber is required", nil);
    return;
  }

  if (body == nil || [body length] == 0) {
    reject(@"INVALID_ARGUMENT", @"body is required", nil);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    MFMessageComposeViewController *vc = [[MFMessageComposeViewController alloc] init];
    vc.messageComposeDelegate = self;
    vc.recipients = @[phoneNumber];
    vc.body = body;
    self.resolve = resolve;
    self.reject = reject;
    UIViewController *root = RCTPresentedViewController();
    if (!root) {
      if (self.reject) {
        self.reject(@"NO_VIEW_CONTROLLER", @"Unable to find root view controller", nil);
        self.resolve = nil;
        self.reject = nil;
      }
      return;
    }
    [root presentViewController:vc animated:YES completion:nil];
  });
}

- (void)messageComposeViewController:(MFMessageComposeViewController *)controller didFinishWithResult:(MessageComposeResult)result
{
  [controller dismissViewControllerAnimated:YES completion:nil];
  if (result == MessageComposeResultSent) {
    if (self.resolve) {
      self.resolve(@{ @"success": @YES });
    }
  } else if (result == MessageComposeResultFailed) {
    if (self.reject) {
      self.reject(@"DELIVERY_FAILED", @"SMS delivery failed", nil);
    }
  } else {
    if (self.reject) {
      self.reject(@"CANCELLED", @"User cancelled SMS", nil);
    }
  }
  self.resolve = nil;
  self.reject = nil;
}

@end




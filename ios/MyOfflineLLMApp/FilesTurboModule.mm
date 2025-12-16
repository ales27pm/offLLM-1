#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import "React/RCTUtils.h"
#import <TargetConditionals.h>
#import <UIKit/UIKit.h>

static NSString *const FilesTurboModuleBookmarkKey =
    @"com.mongars.filesTurboModule.recentBookmark";

@interface FilesTurboModule
    : NSObject <RCTBridgeModule, UIDocumentPickerDelegate, UIDocumentInteractionControllerDelegate>
@property(nonatomic, strong) RCTPromiseResolveBlock resolver;
@property(nonatomic, strong) RCTPromiseRejectBlock rejecter;
@property(nonatomic, strong) NSURL *lastFileURL;
@property(nonatomic, strong) UIDocumentInteractionController *interactionController;
@property(nonatomic, strong) NSURL *activeScopedURL;
@property(nonatomic, assign) BOOL hasActiveSecurityScope;
@end

@implementation FilesTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(pickFile:(NSString *)type resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  self.resolver = resolve;
  self.rejecter = reject;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:@[@"public.item"] inMode:UIDocumentPickerModeImport];
    picker.allowsMultipleSelection = NO;
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

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  if (self.resolver && urls.count > 0) {
    NSURL *url = urls[0];
    self.hasActiveSecurityScope = NO;
    BOOL hasAccess = [url startAccessingSecurityScopedResource];
    self.resolver(@{ @"url": url.absoluteString ?: @"" });
    self.lastFileURL = url;
    [self storeBookmarkForURL:url];
    if (hasAccess) {
      [url stopAccessingSecurityScopedResource];
    }
  } else if (self.rejecter) {
    self.rejecter(@"pick_error", @"No file selected", nil);
  }
  self.resolver = nil;
  self.rejecter = nil;
  [controller dismissViewControllerAnimated:YES completion:nil];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  if (self.rejecter) self.rejecter(@"pick_cancel", @"User cancelled file picker", nil);
  self.resolver = nil;
  self.rejecter = nil;
  [controller dismissViewControllerAnimated:YES completion:nil];
}

RCT_REMAP_METHOD(openRecent,
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSError *resolveError = nil;
    NSURL *url = [self resolveStoredURL:&resolveError];
    if (!url) {
      reject(@"no_recent_file", @"No recently selected file to open", resolveError);
      return;
    }

    UIViewController *root = RCTPresentedViewController();
    if (!root) {
      reject(@"no_view_controller", @"Unable to find root view controller", nil);
      return;
    }

    self.hasActiveSecurityScope = NO;
    BOOL hasAccess = [url startAccessingSecurityScopedResource];
#if TARGET_OS_MACCATALYST
    if (!hasAccess) {
      reject(@"access_denied", @"Unable to access the recent file", nil);
      return;
    }
#else
    if (!hasAccess) {
      NSError *reachabilityError = nil;
      if (![url checkResourceIsReachableAndReturnError:&reachabilityError]) {
        reject(@"access_denied", @"Unable to access the recent file", reachabilityError);
        return;
      }
    }
#endif

    self.activeScopedURL = url;
    self.hasActiveSecurityScope = hasAccess;
    self.interactionController = [UIDocumentInteractionController interactionControllerWithURL:url];
    self.interactionController.delegate = self;

    BOOL presented = [self.interactionController presentPreviewAnimated:YES];
    if (!presented) {
      CGRect sourceRect = root.view.bounds;
      if (![self.interactionController presentOpenInMenuFromRect:sourceRect inView:root.view animated:YES]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        presented = [self.interactionController presentOptionsMenuFromRect:sourceRect inView:root.view animated:YES];
#pragma clang diagnostic pop
      } else {
        presented = YES;
      }
    }

    if (!presented) {
      [self cleanupInteractionController];
      reject(@"open_failed", @"Unable to present the recent file", nil);
      return;
    }

    resolve(@{ @"success": @YES, @"url": url.absoluteString ?: @"" });
  });
}

#pragma mark - UIDocumentInteractionControllerDelegate

- (UIViewController *)documentInteractionControllerViewControllerForPreview:(UIDocumentInteractionController *)controller {
  return RCTPresentedViewController();
}

- (void)documentInteractionControllerDidEndPreview:(UIDocumentInteractionController *)controller {
  [self cleanupInteractionController];
}

- (void)documentInteractionControllerDidDismissOpenInMenu:(UIDocumentInteractionController *)controller {
  [self cleanupInteractionController];
}

- (void)documentInteractionControllerDidDismissOptionsMenu:(UIDocumentInteractionController *)controller {
  [self cleanupInteractionController];
}

- (void)documentInteractionController:(UIDocumentInteractionController *)controller didEndSendingToApplication:(nullable NSString *)application {
  [self cleanupInteractionController];
}

#pragma mark - Helpers

- (void)cleanupInteractionController {
  if (self.activeScopedURL && self.hasActiveSecurityScope) {
    [self.activeScopedURL stopAccessingSecurityScopedResource];
  }
  self.activeScopedURL = nil;
  self.hasActiveSecurityScope = NO;
  self.interactionController = nil;
}

- (void)storeBookmarkForURL:(NSURL *)url {
  NSError *bookmarkError = nil;
  NSURLBookmarkCreationOptions options = 0;
#if TARGET_OS_MACCATALYST
  options = NSURLBookmarkCreationWithSecurityScope;
#endif
  NSData *bookmark = [url bookmarkDataWithOptions:options
                      includingResourceValuesForKeys:nil
                                       relativeToURL:nil
                                               error:&bookmarkError];
  if (bookmark) {
    [[NSUserDefaults standardUserDefaults] setObject:bookmark forKey:FilesTurboModuleBookmarkKey];
  } else if (bookmarkError) {
    RCTLogWarn(@"Failed to create bookmark for recent file: %@", bookmarkError.localizedDescription);
  }
}

- (NSURL *)resolveStoredURL:(NSError **)error {
  if (self.lastFileURL) {
    return self.lastFileURL;
  }

  NSData *bookmark = [[NSUserDefaults standardUserDefaults] objectForKey:FilesTurboModuleBookmarkKey];
  if (!bookmark) {
    return nil;
  }

  BOOL stale = NO;
  NSURLBookmarkResolutionOptions options = 0;
#if TARGET_OS_MACCATALYST
  options = NSURLBookmarkResolutionWithSecurityScope;
#endif
  NSURL *url = [NSURL URLByResolvingBookmarkData:bookmark
                                         options:options
                                   relativeToURL:nil
                             bookmarkDataIsStale:&stale
                                           error:error];
  if (!url) {
    if (error && *error) {
      RCTLogWarn(@"Failed to resolve recent file bookmark: %@", (*error).localizedDescription);
    }
    return nil;
  }

  self.lastFileURL = url;

  if (stale) {
    NSError *refreshError = nil;
    NSURLBookmarkCreationOptions refreshOptions = 0;
#if TARGET_OS_MACCATALYST
    refreshOptions = NSURLBookmarkCreationWithSecurityScope;
#endif
    NSData *freshBookmark = [url bookmarkDataWithOptions:refreshOptions
                           includingResourceValuesForKeys:nil
                                            relativeToURL:nil
                                                    error:&refreshError];
    if (freshBookmark) {
      [[NSUserDefaults standardUserDefaults] setObject:freshBookmark forKey:FilesTurboModuleBookmarkKey];
    } else if (refreshError) {
      RCTLogWarn(@"Failed to refresh recent file bookmark: %@", refreshError.localizedDescription);
    }
  }

  return url;
}

@end





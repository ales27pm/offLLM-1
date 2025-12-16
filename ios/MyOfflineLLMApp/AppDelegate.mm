#import "AppDelegate.h"

#if __has_include(<React-RCTAppDelegate/RCTAppSetupUtils.h>)
#import <React-RCTAppDelegate/RCTAppSetupUtils.h>
#define CR_RCT_APPSETUPUTILS_AVAILABLE 1
#elif __has_include(<React/RCTAppSetupUtils.h>)
#import <React/RCTAppSetupUtils.h>
#define CR_RCT_APPSETUPUTILS_AVAILABLE 1
#elif __has_include("RCTAppSetupUtils.h")
#import "RCTAppSetupUtils.h"
#define CR_RCT_APPSETUPUTILS_AVAILABLE 1
#else
#define CR_RCT_APPSETUPUTILS_AVAILABLE 0
#endif

#if __has_include(<React-RCTAppDelegate/RCTReactNativeFactory.h>)
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#elif __has_include(<React/RCTReactNativeFactory.h>)
#import <React/RCTReactNativeFactory.h>
#elif __has_include("RCTReactNativeFactory.h")
#import "RCTReactNativeFactory.h"
#else
#error "RCTReactNativeFactory header not found. Run 'bundle exec pod install' to generate React-RCTAppDelegate"
#endif

#if __has_include(<React-RCTAppDelegate/RCTRootViewFactory.h>)
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#elif __has_include(<React/RCTRootViewFactory.h>)
#import <React/RCTRootViewFactory.h>
#elif __has_include("RCTRootViewFactory.h")
#import "RCTRootViewFactory.h"
#else
#error "RCTRootViewFactory header not found. Run 'bundle exec pod install' to generate React-RCTAppDelegate"
#endif

#if __has_include(<React/RCTBundleURLProvider.h>)
#import <React/RCTBundleURLProvider.h>
#elif __has_include("RCTBundleURLProvider.h")
#import "RCTBundleURLProvider.h"
#endif

#if __has_include(<React/RCTBridge.h>)
#import <React/RCTBridge.h>
#elif __has_include("RCTBridge.h")
#import "RCTBridge.h"
#endif

#if CR_RCT_APPSETUPUTILS_AVAILABLE

#if defined(__has_builtin)
#if __has_builtin(__builtin_types_compatible_p)
#define CR_RCT_APPSETUP_HAS_TURBO_PARAM                                                    \
  __builtin_types_compatible_p(__typeof__(&RCTAppSetupPrepareApp), void (*)(id, BOOL))
#endif
#endif

#ifndef CR_RCT_APPSETUP_HAS_TURBO_PARAM
#define CR_RCT_APPSETUP_HAS_TURBO_PARAM 1
#endif

#if CR_RCT_APPSETUP_HAS_TURBO_PARAM
#define CR_RCT_PREPARE_APP(APP, TURBO) RCTAppSetupPrepareApp(APP, TURBO)
#else
#define CR_RCT_PREPARE_APP(APP, TURBO) RCTAppSetupPrepareApp(APP)
#endif

#else
#warning \
    "RCTAppSetupUtils header not found. The app will skip RCTAppSetupPrepareApp; ensure Pods are installed if you rely on it."
static inline void RCTAppSetupPrepareApp(id application, BOOL turboModuleEnabled)
{
  (void)application;
  (void)turboModuleEnabled;
}
#define CR_RCT_PREPARE_APP(APP, TURBO) RCTAppSetupPrepareApp(APP, TURBO)
#endif

@interface AppDelegate ()
@property(nonatomic, strong) RCTReactNativeFactory *reactNativeFactory;
@property(nonatomic, copy) NSString *moduleName;
@property(nonatomic, copy, nullable) NSDictionary *initialProps;
@end

@implementation AppDelegate

- (instancetype)init
{
  self = [super init];
  if (self) {
    _moduleName = @"monGARS";
    _initialProps = nil;
  }
  return self;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  CR_RCT_PREPARE_APP(application, self.turboModuleEnabled);

  self.reactNativeFactory = [[RCTReactNativeFactory alloc] initWithDelegate:self];

  UIView *rootView = [self.reactNativeFactory.rootViewFactory viewWithModuleName:self.moduleName
                                                                initialProperties:self.initialProps
                                                                    launchOptions:launchOptions];

  UIViewController *rootViewController = [self createRootViewController];
  [self setRootView:rootView toRootViewController:rootViewController];

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];

  return YES;
}

- (NSURL *)bundleURL
{
  return [self sourceURLForBridge:nil];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index" fallbackResource:nil];
#else
  NSURL *bundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
  NSAssert(bundleURL != nil, @"Unable to locate main.jsbundle. Ensure the JS bundle is embedded in release builds.");
  return bundleURL;
#endif
}

@end




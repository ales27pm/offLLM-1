#import <UIKit/UIKit.h>

#if __has_include(<React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>)
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#elif __has_include(<React/RCTDefaultReactNativeFactoryDelegate.h>)
#import <React/RCTDefaultReactNativeFactoryDelegate.h>
#elif __has_include("RCTDefaultReactNativeFactoryDelegate.h")
#import "RCTDefaultReactNativeFactoryDelegate.h"
#else
#error "RCTDefaultReactNativeFactoryDelegate header not found. Run 'bundle exec pod install' to generate React-RCTAppDelegate"
#endif

@interface AppDelegate : RCTDefaultReactNativeFactoryDelegate <UIApplicationDelegate>

@property (nonatomic, strong) UIWindow *window;

@end




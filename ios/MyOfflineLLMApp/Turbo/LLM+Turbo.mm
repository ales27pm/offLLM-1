#import <ReactCommon/RCTTurboModule.h>
#import <React/RCTLog.h>
#import "monGARS-Swift.h"

// Robust TurboModule spec includes with multiple RN codegen fallbacks
#ifndef LLM_SPEC_HEADER
#define LLM_SPEC_HEADER "<missing>"
#endif

#if __has_include("AppSpec/LLMSpec.h")
  #import "AppSpec/LLMSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "AppSpec/LLMSpec.h"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include("AppSpecs/LLMSpec.h")
  #import "AppSpecs/LLMSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "AppSpecs/LLMSpec.h"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include("LLMSpec.h")
  #import "LLMSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "LLMSpec.h"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include(<FBReactNativeSpec/AppSpec.h>)
  #import <FBReactNativeSpec/AppSpec.h>
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "<FBReactNativeSpec/AppSpec.h>"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include("FBReactNativeSpec/AppSpec.h")
  #import "FBReactNativeSpec/AppSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "FBReactNativeSpec/AppSpec.h"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include("AppSpec.h")
  #import "AppSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "AppSpec.h"
  #define LLM_SPEC_CLASS NativeLLMSpecJSI
#elif __has_include(<FBReactNativeSpec/FBReactNativeSpec.h>)
  #import <FBReactNativeSpec/FBReactNativeSpec.h>
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "<FBReactNativeSpec/FBReactNativeSpec.h>"
#elif __has_include(<React-Codegen/FBReactNativeSpec/FBReactNativeSpec.h>)
  #import <React-Codegen/FBReactNativeSpec/FBReactNativeSpec.h>
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "<React-Codegen/FBReactNativeSpec/FBReactNativeSpec.h>"
#elif __has_include("FBReactNativeSpec/FBReactNativeSpec.h")
  #import "FBReactNativeSpec/FBReactNativeSpec.h"
  #undef LLM_SPEC_HEADER
  #define LLM_SPEC_HEADER "FBReactNativeSpec/FBReactNativeSpec.h"
#else
  #warning "LLM+Turbo.mm: No Codegen spec header found. Ensure RN codegen ran and Pods installed."
#endif

#ifdef LLM_SPEC_CLASS
#define LLM_SPEC_AVAILABLE 1
#else
#define LLM_SPEC_AVAILABLE 0
#endif

@class LLM;
using namespace facebook::react;

@interface LLM (Turbo) <RCTTurboModule>
@end

@implementation LLM (Turbo)
RCT_EXPORT_MODULE();
- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params {
#if LLM_SPEC_AVAILABLE
  return std::make_shared<LLM_SPEC_CLASS>(params);
#else
  RCTLogError(@"[LLM TurboModule] RN Codegen spec for LLM is missing. Run: yarn install && npx react-native codegen && (cd ios && pod install). Last attempted header: %s", LLM_SPEC_HEADER);
  return nullptr;
#endif
}
@end




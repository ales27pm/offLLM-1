//  MLXModuleBridge.m
//  monGARS

#import <React/RCTBridgeModule.h>
#import <React/RCTConvert.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(MLXModule, NSObject)

RCT_EXTERN_METHOD(load:(NSString * _Nullable)modelID
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generate:(NSString *)prompt
                  options:(NSDictionary * _Nullable)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startStream:(NSString *)prompt
                  options:(NSDictionary * _Nullable)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reset)
RCT_EXTERN_METHOD(unload)
RCT_EXTERN_METHOD(stop)

@end




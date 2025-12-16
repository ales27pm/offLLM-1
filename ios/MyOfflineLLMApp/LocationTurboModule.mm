#import <React/RCTBridgeModule.h>
#import "React/RCTEventEmitter.h"
#import <CoreLocation/CoreLocation.h>

@interface LocationTurboModule : RCTEventEmitter <RCTBridgeModule, CLLocationManagerDelegate>
@end

@implementation LocationTurboModule {
  CLLocationManager *_manager;
  RCTPromiseResolveBlock _resolve;
  RCTPromiseRejectBlock _reject;
}

RCT_EXPORT_MODULE();

- (NSArray *)supportedEvents {
  return @[@"locationUpdate"];
}

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(getCurrentLocation:(NSString *)accuracy resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  _resolve = resolve;
  _reject = reject;
  _manager = [[CLLocationManager alloc] init];
  _manager.delegate = self;
  if ([accuracy isEqualToString:@"high"]) {
    _manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation;
  } else if ([accuracy isEqualToString:@"medium"]) {
    _manager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
  } else {
    _manager.desiredAccuracy = kCLLocationAccuracyKilometer;
  }
  if ([CLLocationManager authorizationStatus] == kCLAuthorizationStatusNotDetermined) {
    [_manager requestWhenInUseAuthorization];
  } else if ([CLLocationManager authorizationStatus] != kCLAuthorizationStatusAuthorizedWhenInUse) {
    reject(@"permission_denied", @"Location permission denied", nil);
    return;
  }
  [_manager requestLocation];
}

RCT_EXPORT_METHOD(startUpdates:(NSInteger)interval) {
  _manager = [[CLLocationManager alloc] init];
  _manager.delegate = self;
  _manager.distanceFilter = 10.0;
  [_manager startUpdatingLocation];
}

RCT_EXPORT_METHOD(stopUpdates) {
  [_manager stopUpdatingLocation];
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray *)locations {
  CLLocation *location = locations.lastObject;
  NSDictionary *data = @{
    @"latitude": @(location.coordinate.latitude),
    @"longitude": @(location.coordinate.longitude),
    @"altitude": @(location.altitude),
    @"accuracy": @(location.horizontalAccuracy),
    @"speed": @(location.speed),
    @"course": @(location.course)
  };
  [self sendEventWithName:@"locationUpdate" body:data];
  if (_resolve) {
    _resolve(data);
    _resolve = nil;
  }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  if (_reject) {
    _reject(@"location_error", error.localizedDescription, error);
    _reject = nil;
  }
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  if (manager.authorizationStatus == kCLAuthorizationStatusAuthorizedWhenInUse) {
    [manager requestLocation];
  }
}

@end





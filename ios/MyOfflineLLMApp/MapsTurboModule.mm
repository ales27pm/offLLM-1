#import <React/RCTBridgeModule.h>
#import <MapKit/MapKit.h>
#import <CoreLocation/CoreLocation.h>

@interface MapsTurboModule : NSObject <RCTBridgeModule>
@end

@implementation MapsTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(showMap:(double)latitude longitude:(double)longitude title:(NSString *)title) {
  MKPlacemark *placemark = [[MKPlacemark alloc] initWithCoordinate:CLLocationCoordinate2DMake(latitude, longitude)];
  MKMapItem *mapItem = [[MKMapItem alloc] initWithPlacemark:placemark];
  mapItem.name = title;
  [mapItem openInMapsWithLaunchOptions:nil];
}

RCT_EXPORT_METHOD(getDirections:(NSString *)from to:(NSString *)to mode:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  CLGeocoder *geocoder = [[CLGeocoder alloc] init];

  CLLocationCoordinate2D (^parseCoordinate)(NSString *) = ^CLLocationCoordinate2D(NSString *str) {
    NSArray *components = [str componentsSeparatedByString:@","];
    if (components.count == 2) {
      double lat = [components[0] doubleValue];
      double lon = [components[1] doubleValue];
      return CLLocationCoordinate2DMake(lat, lon);
    }
    return kCLLocationCoordinate2DInvalid;
  };

  void (^geocodeString)(NSString *, void(^)(CLLocationCoordinate2D)) = ^(NSString *string, void(^completion)(CLLocationCoordinate2D)) {
    CLLocationCoordinate2D coord = parseCoordinate(string);
    if (CLLocationCoordinate2DIsValid(coord)) {
      completion(coord);
    } else {
      [geocoder geocodeAddressString:string completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
        if (error || placemarks.count == 0) {
          completion(kCLLocationCoordinate2DInvalid);
        } else {
          completion(placemarks.firstObject.location.coordinate);
        }
      }];
    }
  };

  geocodeString(from, ^(CLLocationCoordinate2D fromCoord) {
    if (!CLLocationCoordinate2DIsValid(fromCoord)) {
      reject(@"geocode_error", @"Unable to geocode 'from' address", nil);
      return;
    }
    geocodeString(to, ^(CLLocationCoordinate2D toCoord) {
      if (!CLLocationCoordinate2DIsValid(toCoord)) {
        reject(@"geocode_error", @"Unable to geocode 'to' address", nil);
        return;
      }
      MKDirectionsRequest *request = [[MKDirectionsRequest alloc] init];
      request.source = [[MKMapItem alloc] initWithPlacemark:[[MKPlacemark alloc] initWithCoordinate:fromCoord]];
      request.destination = [[MKMapItem alloc] initWithPlacemark:[[MKPlacemark alloc] initWithCoordinate:toCoord]];
      if ([mode isEqualToString:@"walking"]) request.transportType = MKDirectionsTransportTypeWalking;
      else if ([mode isEqualToString:@"transit"]) request.transportType = MKDirectionsTransportTypeTransit;
      else request.transportType = MKDirectionsTransportTypeAutomobile;
      MKDirections *directions = [[MKDirections alloc] initWithRequest:request];
      [directions calculateDirectionsWithCompletionHandler:^(MKDirectionsResponse *response, NSError *error) {
        if (error) {
          reject(@"directions_error", error.localizedDescription, error);
          return;
        }
        NSMutableArray *routes = [NSMutableArray array];
        for (MKRoute *route in response.routes) {
          [routes addObject:@{
            @"distance": @(route.distance),
            @"expectedTime": @(route.expectedTravelTime),
            @"steps": @[]
          }];
        }
        resolve(routes);
      }];
    });
  });
}

RCT_EXPORT_METHOD(searchPlaces:(NSString *)query near:(NSString *)near resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  MKLocalSearchRequest *request = [[MKLocalSearchRequest alloc] init];
  request.naturalLanguageQuery = query;

  void (^performSearch)(void) = ^{
    MKLocalSearch *search = [[MKLocalSearch alloc] initWithRequest:request];
    [search startWithCompletionHandler:^(MKLocalSearchResponse *response, NSError *error) {
      if (error) {
        reject(@"search_error", error.localizedDescription, error);
        return;
      }
      NSMutableArray *places = [NSMutableArray array];
      for (MKMapItem *item in response.mapItems) {
        [places addObject:@{
          @"name": item.name,
          @"latitude": @(item.placemark.coordinate.latitude),
          @"longitude": @(item.placemark.coordinate.longitude)
        }];
      }
      resolve(places);
    }];
  };

  if (near && near.length > 0) {
    NSArray *components = [near componentsSeparatedByString:@","];
    if (components.count == 2) {
      double lat = [components[0] doubleValue];
      double lon = [components[1] doubleValue];
      request.region = MKCoordinateRegionMake(CLLocationCoordinate2DMake(lat, lon), MKCoordinateSpanMake(0.1, 0.1));
      performSearch();
    } else {
      CLGeocoder *geocoder = [[CLGeocoder alloc] init];
      [geocoder geocodeAddressString:near completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
        if (error || placemarks.count == 0) {
          reject(@"geocode_error", @"Unable to geocode 'near' parameter", error);
          return;
        }
        CLLocationCoordinate2D coord = placemarks.firstObject.location.coordinate;
        request.region = MKCoordinateRegionMake(coord, MKCoordinateSpanMake(0.1, 0.1));
        performSearch();
      }];
    }
  } else {
    performSearch();
  }
}

@end





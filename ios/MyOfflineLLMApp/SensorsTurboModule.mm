#import <React/RCTBridgeModule.h>
#import "SensorsTurboModule.h"
#import "React/RCTUtils.h"
#import <CoreMotion/CoreMotion.h>

@implementation SensorsTurboModule {
  CMMotionManager *_motionManager;
}

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getSensorData:(NSString *)type duration:(NSInteger)duration resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  _motionManager = [[CMMotionManager alloc] init];
  if ([type isEqualToString:@"accelerometer"]) {
    _motionManager.accelerometerUpdateInterval = 0.1;
    [_motionManager startAccelerometerUpdates];
  } else if ([type isEqualToString:@"gyroscope"]) {
    _motionManager.gyroUpdateInterval = 0.1;
    [_motionManager startGyroUpdates];
  } else if ([type isEqualToString:@"magnetometer"]) {
    _motionManager.magnetometerUpdateInterval = 0.1;
    [_motionManager startMagnetometerUpdates];
  } else {
    reject(@"invalid_type", @"Unsupported sensor type", nil);
    return;
  }

  NSMutableArray *samples = [NSMutableArray array];
  NSTimeInterval sampleInterval = 0.1;
  __block NSTimeInterval elapsed = 0;
  NSTimeInterval totalDuration = duration / 1000.0;

  dispatch_queue_t queue = dispatch_get_main_queue();
  __block dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), (uint64_t)(sampleInterval * NSEC_PER_SEC), 0);

  dispatch_source_set_event_handler(timer, ^{
    if ([type isEqualToString:@"accelerometer"]) {
      CMAccelerometerData *accelData = self->_motionManager.accelerometerData;
      if (accelData) {
        [samples addObject:@{ @"x": @(accelData.acceleration.x), @"y": @(accelData.acceleration.y), @"z": @(accelData.acceleration.z) }];
      }
    } else if ([type isEqualToString:@"gyroscope"]) {
      CMGyroData *gyroData = self->_motionManager.gyroData;
      if (gyroData) {
        [samples addObject:@{ @"x": @(gyroData.rotationRate.x), @"y": @(gyroData.rotationRate.y), @"z": @(gyroData.rotationRate.z) }];
      }
    } else if ([type isEqualToString:@"magnetometer"]) {
      CMMagnetometerData *magData = self->_motionManager.magnetometerData;
      if (magData) {
        [samples addObject:@{ @"x": @(magData.magneticField.x), @"y": @(magData.magneticField.y), @"z": @(magData.magneticField.z) }];
      }
    }

    elapsed += sampleInterval;
    if (elapsed >= totalDuration) {
      dispatch_source_cancel(timer);

      double sumX = 0, sumY = 0, sumZ = 0;
      NSUInteger count = samples.count;
      for (NSDictionary *sample in samples) {
        sumX += [sample[@"x"] doubleValue];
        sumY += [sample[@"y"] doubleValue];
        sumZ += [sample[@"z"] doubleValue];
      }
      NSDictionary *avgData = @{
        @"x": @(count ? sumX / count : 0),
        @"y": @(count ? sumY / count : 0),
        @"z": @(count ? sumZ / count : 0)
      };

      if ([type isEqualToString:@"accelerometer"]) {
        [self->_motionManager stopAccelerometerUpdates];
      } else if ([type isEqualToString:@"gyroscope"]) {
        [self->_motionManager stopGyroUpdates];
      } else if ([type isEqualToString:@"magnetometer"]) {
        [self->_motionManager stopMagnetometerUpdates];
      }

      resolve(avgData);
    }
  });

  dispatch_resume(timer);
}

@end





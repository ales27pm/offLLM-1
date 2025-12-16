#import <React/RCTBridgeModule.h>
#import <EventKit/EventKit.h>

@interface CalendarTurboModule : NSObject <RCTBridgeModule>
@end

@implementation CalendarTurboModule {
  EKEventStore *_eventStore;
}

RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(createEvent,
                 title:(NSString *)title
                 startDate:(NSString *)isoDate
                 endDate:(NSString *)endIsoDate
                 durationSeconds:(NSNumber *)durationSeconds
                 location:(NSString *)location
                 notes:(NSString *)notes
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  _eventStore = [[EKEventStore alloc] init];
  [_eventStore requestAccessToEntityType:EKEntityTypeEvent completion:^(BOOL granted, NSError *error) {
    if (!granted || error) {
      reject(@"PERMISSION_DENIED", @"Access to calendar denied", error);
      return;
    }

    EKEvent *event = [EKEvent eventWithEventStore:self->_eventStore];
    event.title = title;

    NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
    NSDate *startDate = [formatter dateFromString:isoDate];
    if (!startDate) {
      reject(@"DATE_ERROR", @"Invalid ISO start date", nil);
      return;
    }

    NSDate *endDate = nil;
    if (endIsoDate != nil && [endIsoDate isKindOfClass:[NSString class]] && [endIsoDate length] > 0) {
      endDate = [formatter dateFromString:endIsoDate];
      if (!endDate) {
        reject(@"DATE_ERROR", @"Invalid ISO end date", nil);
        return;
      }
    }

    if (endDate == nil && durationSeconds != nil && [durationSeconds isKindOfClass:[NSNumber class]]) {
      endDate = [startDate dateByAddingTimeInterval:[durationSeconds doubleValue]];
    }

    if (endDate == nil) {
      endDate = [startDate dateByAddingTimeInterval:3600];
    }

    if ([endDate compare:startDate] != NSOrderedDescending) {
      reject(@"DATE_ERROR", @"End date must be after start date", nil);
      return;
    }

    event.startDate = startDate;
    event.endDate = endDate;
    event.location = location;
    event.notes = notes;
    event.calendar = [self->_eventStore defaultCalendarForNewEvents];

    NSError *saveError = nil;
    [self->_eventStore saveEvent:event span:EKSpanThisEvent commit:YES error:&saveError];
    if (saveError) {
      reject(@"SAVE_ERROR", saveError.localizedDescription, saveError);
    } else {
      resolve(@{ @"success": @YES, @"eventId": event.eventIdentifier ?: @"" });
    }
  }];
}

@end




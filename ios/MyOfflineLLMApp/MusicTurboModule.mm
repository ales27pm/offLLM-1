#import <React/RCTBridgeModule.h>
#import <MediaPlayer/MediaPlayer.h>

@interface MusicTurboModule : NSObject <RCTBridgeModule>
@end

@implementation MusicTurboModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(playMusic:(NSString *)query resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [MPMediaLibrary requestAuthorization:^(MPMediaLibraryAuthorizationStatus status) {
    if (status != MPMediaLibraryAuthorizationStatusAuthorized) {
      reject(@"permission_denied", @"Music access denied", nil);
      return;
    }
    MPMediaQuery *mediaQuery = [[MPMediaQuery alloc] init];
    [mediaQuery addFilterPredicate:[MPMediaPropertyPredicate predicateWithValue:query forProperty:MPMediaItemPropertyTitle comparisonType:MPMediaPredicateComparisonContains]];
    MPMusicPlayerController *player = [MPMusicPlayerController systemMusicPlayer];
    [player setQueueWithQuery:mediaQuery];
    [player play];
    resolve(@{ @"success": @YES });
  }];
}

RCT_EXPORT_METHOD(searchLibrary:(NSString *)query type:(NSString *)type resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [MPMediaLibrary requestAuthorization:^(MPMediaLibraryAuthorizationStatus status) {
    if (status != MPMediaLibraryAuthorizationStatusAuthorized) {
      reject(@"permission_denied", @"Music access denied", nil);
      return;
    }
    MPMediaQuery *mediaQuery;
    if ([type isEqualToString:@"songs"]) {
      mediaQuery = [MPMediaQuery songsQuery];
    } else if ([type isEqualToString:@"artists"]) {
      mediaQuery = [MPMediaQuery artistsQuery];
    } else if ([type isEqualToString:@"playlists"]) {
      mediaQuery = [MPMediaQuery playlistsQuery];
    } else {
      mediaQuery = [[MPMediaQuery alloc] init];
    }
    [mediaQuery addFilterPredicate:[MPMediaPropertyPredicate predicateWithValue:query forProperty:MPMediaItemPropertyTitle comparisonType:MPMediaPredicateComparisonContains]];
    NSArray *items = mediaQuery.items;
    NSMutableArray *result = [NSMutableArray array];
    for (MPMediaItem *item in items) {
      [result addObject:@{
        @"title": item.title ?: @"",
        @"artist": item.artist ?: @"",
        @"duration": @(item.playbackDuration)
      }];
    }
    resolve(result);
  }];
}

@end





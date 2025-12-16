#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <Contacts/Contacts.h>

static NSString *const ContactsTurboModuleErrorDomain = @"ContactsTurboModule";

static NSError *ContactsTurboModuleError(NSInteger code, NSString *message, NSError *underlyingError)
{
  NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
  if (message != nil && message.length > 0) {
    userInfo[NSLocalizedDescriptionKey] = message;
  }
  if (underlyingError != nil) {
    userInfo[NSUnderlyingErrorKey] = underlyingError;
  }
  return [NSError errorWithDomain:ContactsTurboModuleErrorDomain code:code userInfo:userInfo];
}

static void ContactsTurboResolveOnMain(RCTPromiseResolveBlock resolve, id value)
{
  if (!resolve) {
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(value);
  });
}

static void ContactsTurboRejectOnMain(RCTPromiseRejectBlock reject,
                                      NSString *code,
                                      NSString *message,
                                      NSError *error)
{
  if (!reject) {
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    reject(code, message, error);
  });
}

@interface ContactsTurboModule : NSObject <RCTBridgeModule>
- (void)handleAddContactWithPayload:(NSDictionary *)payload
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject;
@end

@implementation ContactsTurboModule

RCT_EXPORT_MODULE();

- (void)handleAddContactWithPayload:(NSDictionary *)payload
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject
{
  if (![payload isKindOfClass:[NSDictionary class]]) {
    NSError *error = ContactsTurboModuleError(2, @"Expected payload dictionary", nil);
    ContactsTurboRejectOnMain(reject, @"invalid_payload", error.localizedDescription, error);
    return;
  }

  NSString *rawName = [payload objectForKey:@"name"];
  if (![rawName isKindOfClass:[NSString class]]) {
    NSError *error = ContactsTurboModuleError(3, @"Missing contact name", nil);
    ContactsTurboRejectOnMain(reject, @"invalid_name", error.localizedDescription, error);
    return;
  }

  NSString *trimmedName = [rawName stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmedName.length == 0) {
    NSError *error = ContactsTurboModuleError(3, @"Missing contact name", nil);
    ContactsTurboRejectOnMain(reject, @"invalid_name", error.localizedDescription, error);
    return;
  }

  NSString *phoneValue = nil;
  id phoneCandidate = [payload objectForKey:@"phone"];
  if ([phoneCandidate isKindOfClass:[NSString class]]) {
    phoneValue = [phoneCandidate stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  }

  NSString *emailValue = nil;
  id emailCandidate = [payload objectForKey:@"email"];
  if ([emailCandidate isKindOfClass:[NSString class]]) {
    emailValue = [emailCandidate stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  }

  CNContactStore *store = [[CNContactStore alloc] init];
  [store requestAccessForEntityType:CNEntityTypeContacts completionHandler:^(BOOL granted, NSError *accessError) {
    if (!granted) {
      NSError *deniedError = accessError ?: ContactsTurboModuleError(4, @"Contacts access denied", nil);
      RCTLogError(@"ContactsTurboModule/addContact permission denied: %@", deniedError);
      ContactsTurboRejectOnMain(reject, @"permission_denied", @"Contacts access denied", deniedError);
      return;
    }

    NSArray<NSString *> *nameParts = [[trimmedName componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
      filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];

    CNMutableContact *contact = [[CNMutableContact alloc] init];
    if (nameParts.count > 0) {
      contact.givenName = nameParts.firstObject;
    }
    if (nameParts.count > 2) {
      NSRange middleRange = NSMakeRange(1, nameParts.count - 2);
      contact.middleName = [[nameParts subarrayWithRange:middleRange] componentsJoinedByString:@" "];
    }
    if (nameParts.count >= 2) {
      contact.familyName = nameParts.lastObject;
    }

    if (phoneValue.length > 0) {
      CNPhoneNumber *phoneNumber = [CNPhoneNumber phoneNumberWithStringValue:phoneValue];
      contact.phoneNumbers = @[[CNLabeledValue labeledValueWithLabel:CNLabelPhoneNumberMobile value:phoneNumber]];
    }

    if (emailValue.length > 0) {
      contact.emailAddresses = @[[CNLabeledValue labeledValueWithLabel:CNLabelHome value:emailValue]];
    }

    CNSaveRequest *request = [[CNSaveRequest alloc] init];
    [request addContact:contact toContainerWithIdentifier:nil];

    NSError *saveError = nil;
    if (![store executeSaveRequest:request error:&saveError]) {
      NSError *wrappedError = ContactsTurboModuleError(5, saveError.localizedDescription ?: @"Failed to save contact", saveError);
      RCTLogError(@"ContactsTurboModule/addContact failed: %@", wrappedError);
      ContactsTurboRejectOnMain(reject, @"save_error", wrappedError.localizedDescription, wrappedError);
      return;
    }

    NSDictionary *result = @{ @"success": @YES, @"identifier": contact.identifier ?: @"" };
    RCTLogInfo(@"ContactsTurboModule/addContact saved contact %@", contact.identifier ?: @"<unknown>");
    ContactsTurboResolveOnMain(resolve, result);
  }];
}

RCT_EXPORT_METHOD(findContact:(NSString *)query
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *trimmedQuery = [[query ?: @"" stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] copy];
  if (trimmedQuery.length == 0) {
    RCTLogInfo(@"ContactsTurboModule/findContact called with empty query; returning empty array.");
    ContactsTurboResolveOnMain(resolve, @[]);
    return;
  }

  CNContactStore *store = [[CNContactStore alloc] init];
  [store requestAccessForEntityType:CNEntityTypeContacts completionHandler:^(BOOL granted, NSError *accessError) {
    if (!granted) {
      NSError *deniedError = accessError ?: ContactsTurboModuleError(1, @"Contacts access denied", nil);
      RCTLogError(@"ContactsTurboModule/findContact permission denied: %@", deniedError);
      ContactsTurboRejectOnMain(reject, @"permission_denied", @"Contacts access denied", deniedError);
      return;
    }

    NSArray<id<CNKeyDescriptor>> *keys = @[CNContactGivenNameKey,
                                           CNContactMiddleNameKey,
                                           CNContactFamilyNameKey,
                                           CNContactOrganizationNameKey,
                                           CNContactPhoneNumbersKey,
                                           CNContactEmailAddressesKey];
    NSPredicate *predicate = [CNContact predicateForContactsMatchingName:trimmedQuery];
    NSError *fetchError = nil;
    NSArray<CNContact *> *contacts = [store unifiedContactsMatchingPredicate:predicate
                                                                keysToFetch:keys
                                                                      error:&fetchError];
    if (fetchError != nil) {
      RCTLogError(@"ContactsTurboModule/findContact failed: %@", fetchError);
      ContactsTurboRejectOnMain(reject,
                                @"search_error",
                                fetchError.localizedDescription ?: @"Failed to search contacts",
                                fetchError);
      return;
    }

    NSMutableArray<NSDictionary *> *results = [NSMutableArray arrayWithCapacity:contacts.count];
    NSPredicate *nonEmptyPredicate = [NSPredicate predicateWithFormat:@"length > 0"];

    for (CNContact *contact in contacts) {
      NSMutableArray<NSString *> *phones = [NSMutableArray arrayWithCapacity:contact.phoneNumbers.count];
      for (CNLabeledValue<CNPhoneNumber *> *phone in contact.phoneNumbers) {
        NSString *number = phone.value.stringValue;
        if (number.length > 0) {
          [phones addObject:number];
        }
      }

      NSMutableArray<NSString *> *emails = [NSMutableArray arrayWithCapacity:contact.emailAddresses.count];
      for (CNLabeledValue<NSString *> *emailValue in contact.emailAddresses) {
        NSString *emailAddress = emailValue.value;
        if (emailAddress.length > 0) {
          [emails addObject:emailAddress];
        }
      }

      NSArray<NSString *> *nameComponents = @[
        contact.givenName ?: @"",
        contact.middleName ?: @"",
        contact.familyName ?: @""
      ];
      NSString *composedName = [[nameComponents filteredArrayUsingPredicate:nonEmptyPredicate]
                                   componentsJoinedByString:@" "];

      NSMutableDictionary *entry = [NSMutableDictionary dictionary];
      entry[@"name"] = composedName.length > 0 ? composedName : (contact.organizationName ?: @"");
      entry[@"phones"] = phones;
      entry[@"emails"] = emails;
      entry[@"identifier"] = contact.identifier ?: @"";

      [results addObject:entry];
    }

    ContactsTurboResolveOnMain(resolve, results);
  }];
}

RCT_EXPORT_METHOD(addContact:(NSString *)name
                  phone:(NSString *)phone
                  email:(NSString *)email
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  if (name != nil) {
    [payload setObject:name forKey:@"name"];
  }
  if (phone != nil) {
    [payload setObject:phone forKey:@"phone"];
  }
  if (email != nil) {
    [payload setObject:email forKey:@"email"];
  }

  [self handleAddContactWithPayload:payload resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(addContactWithPayload:(NSDictionary *)payload
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self handleAddContactWithPayload:payload resolver:resolve rejecter:reject];
}

@end




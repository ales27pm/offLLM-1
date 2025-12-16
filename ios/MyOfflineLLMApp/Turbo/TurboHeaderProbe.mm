// Debug/CI-only probe to surface missing Turbo headers early.
#if DEBUG
# if __has_include(<ReactCommon/TurboModule.h>)
#   import <ReactCommon/TurboModule.h>
#   import <ReactCommon/CallInvoker.h>
# else
    // Force a readable compile-time error that shows up in CI logs.
#   error "Turbo headers not found: <ReactCommon/TurboModule.h>. Check HEADER_SEARCH_PATHS / Pods setup."
# endif

extern "C" void turbo_header_probe(void) {
  // no-op; just ensure we compile & link a TU including Turbo headers
}
#endif // DEBUG




monGARS export fix summary
==========================

Context
-------
The iOS signing workflow failed because the ExportOptions.plist recorded the
literal string "Error Reading File: /dev/stdin" as the provisioning profile
name, and the export attempted to use the deprecated `ad-hoc` method with only
an Apple Development certificate available.

Resolution
---------
* ExportOptions.plist is now generated using a temporary file instead of
  piping through /dev/stdin, eliminating the bogus profile name.
* The workflow defaults to the `development` export method and only uses
  `release-testing` or `app-store` when a Distribution identity is present,
  falling back automatically otherwise.
* The signing certificate hint is written explicitly (`Apple Development` or
  `Apple Distribution`) so `xcodebuild` can resolve the correct identity.

Operational notes
-----------------
* Re-run the workflow with `export_method=development` unless you have added a
  Distribution certificate and matching profile.
* To audit the available identities in the temporary keychain, run
  `security find-identity -p codesigning -v "$KEYCHAIN_PATH"` inside the macOS
  runner.

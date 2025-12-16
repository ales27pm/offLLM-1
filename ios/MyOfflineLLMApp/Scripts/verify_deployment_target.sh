#!/bin/sh
# Verify iOS deployment target is set correctly
if [ "$IPHONEOS_DEPLOYMENT_TARGET" != "18.0" ]; then
  echo "ERROR: iOS deployment target must be 18.0 for React Native 0.81.1"
  echo "Current value: $IPHONEOS_DEPLOYMENT_TARGET"
  exit 1
fi
echo "Verified iOS deployment target: $IPHONEOS_DEPLOYMENT_TARGET"
exit 0




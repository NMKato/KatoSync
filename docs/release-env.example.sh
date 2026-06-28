#!/usr/bin/env sh

# Copy this file outside the repo or source it in CI with real secret values.
# Do not commit filled-in secrets.

export APPLE_SIGNING_IDENTITY="Developer ID Application: Example Company (TEAMID)"
export APPLE_PROVIDER_SHORT_NAME="TEAMID_OR_PROVIDER"

# Option A: app-specific password based notarization.
export APPLE_ID="owner@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"

# Option B: App Store Connect API key based notarization.
export APPLE_API_KEY="AuthKey_KEYID.p8"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"

# Optional CI-only certificate import values.
export APPLE_CERTIFICATE="base64-encoded-p12"
export APPLE_CERTIFICATE_PASSWORD="p12-password"
export APPLE_KEYCHAIN_PASSWORD="temporary-keychain-password"

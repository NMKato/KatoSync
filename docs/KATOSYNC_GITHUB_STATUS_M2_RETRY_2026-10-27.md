# KatoSync GitHub App M2 status retry, 27.10.2026

## Read-only findings
- Both M2 and M3 isolated QA apps have a KATOOS account session in the OS Keychain.
- M3 has one KatoSync GitHub-App credential; M2 has none. No raw credentials, tokens, emails or private account identifiers were retrieved.
- Both machines have an independently working GitHub CLI login. GitHub CLI login is not an App Device Flow login.
- GitHub website/API and KATOOS Auth are reachable from both Macs. M2/M3 ICMP LAN checks succeeded.
- The screenshot reported unavailable GitHub App status in M2. The old frontend swallowed all native error messages and offered no retry in that state. Missing credentials by themselves should normally yield connected=false, so the *underlying status-read failure* is not yet identified as Keychain, session, or network.

## Fixed
- Recovery button for failed initial GitHub status in provider card.
- Client-side classification into safe categories: verified session, macOS Keychain, connectivity, GitHub App configuration, and unknown. No raw error or tokens appear in frontend or logs.
- Does not reset linked M3 GitHub credentials, read GitHub CLI tokens, automatically connect, elevate permissions, or bypass account verification. Only an explicit user click retries the status and starts optional App Device Flow.

## QA and remaining gates
- Static TypeScript, Node error category and interaction regression tests, Rust QA suite, native isolated QA build on M2.
- User checks in M2 Mesh QA > Provider > GitHub App > Retry status. After status recovers, user may voluntarily start GitHub App Device Flow.
- A real Mesh Stage1B/1C two-device handshake is still unverified. ICMP is network reachability, not authenticated encrypted TLS. No remote writers or read-only agents enabled.

# Security Policy

KatoSync is currently in active development. The QA Mesh features and
device-enrollment infrastructure are **not** a supported production release.

## Reporting a vulnerability

Please **do not** publish working exploits, authentication credentials,
private repository data, or sensitive logs in a public GitHub issue.

Use this repository's **Security → Report a vulnerability** entry when
private vulnerability reporting is enabled. Otherwise, contact the repository
maintainers through an existing *private* contact channel listed by the
maintainers; do not place confidential details in a public issue.

Include the affected commit or build, an impact summary, and a
reproduction using synthetic credentials or a disposable test account.
No secrets or production data are needed.

## Security guarantees and limitations

- Account sign-in is not peer trust; a discovered device is not an
  authenticated Mesh connection.
- Public signed invitations must be verified by native code, with
  explicit user approval and a trusted encrypted peer channel before any
  remote operation.
- Private keys and OAuth tokens belong in native OS credential storage,
  not logs, source files, cloud presence, or support tickets.
- The Mesh writer gate is **closed** until reviewed fencing, peer
  authorization, and authenticated transport are demonstrated.
- A passing frontend/Node suite does **not** replace native macOS/Windows
  security verification.

Supported released versions and coordinated disclosure timelines will
be documented before the project's first supported public release.

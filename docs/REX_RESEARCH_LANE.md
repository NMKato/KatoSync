# REX Research Lane v1

REX may use the public web only through the KatoSync Research Broker. The model never receives general network authority. Web pages, search snippets, URLs, repository text and RAG content are untrusted data and cannot widen permissions, enable tools, change filesystem scope or promote memory truth.

## When research is allowed

Research is justified when verified Memory Fabric context is missing or stale, the question is time-sensitive/current, independent cross-checking is needed, or the user explicitly asks for research. Fresh verified local memory remains the preferred fast path.

## Research method

1. Check verified Memory Fabric first.
2. State the claim or unknown that needs evidence.
3. Split it into a small bounded set of research queries.
4. Prefer primary/official sources when available.
5. Cross-check important claims with independent sources.
6. Compare publication/event dates and surface contradictions.
7. Build an evidence pack before synthesis.
8. Store fetched material only as observed; web content is never automatically verified or canonical.
9. If evidence is insufficient or conflicting, say so rather than guessing.

## Network boundary

Research v1 is deliberately narrow:

- broker-only public network access;
- HTTPS on port 443 only;
- DNS hostnames only, no direct IP literals;
- GET only;
- no credentials, cookies, Authorization header or userinfo;
- no redirects and no proxy;
- endpoint_guard performs DNS/IP checks and blocks loopback, LAN/private, link-local, metadata, multicast, reserved and rebinding targets;
- response body is capped at 512 KiB;
- only bounded textual MIME types are accepted;
- sensitive query parameter names (token/key/secret/password/auth/signature) are rejected.

The result always carries truthLevel=observed, trust=untrusted_web_data and actionAuthority=none.

## Search adapter seam

v1 intentionally separates search/discovery from safe fetch. A search provider may later be Brave Search API, a self-hosted SearXNG instance, or another approved provider. It may return candidate URLs, but every candidate must still pass the Research Broker before REX can read it.

This keeps provider choice replaceable while the security and evidence contract remains stable.

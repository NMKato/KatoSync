//! Provider-neutral research search discovery. SearXNG is adapter v1.
//!
//! Search only discovers candidate URLs. It never grants network/action authority and never
//! promotes search snippets to verified memory. Reading a candidate still requires
//! research_lane::research_fetch_observed, which re-validates the target through endpoint_guard.

use crate::endpoint_guard;
use chrono::Utc;
use reqwest::{header, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, net::IpAddr, time::Duration};

const SCHEMA: &str = "katosync.research-search/v1";
const PROVIDER: &str = "searxng";
const MAX_BASE_URL_CHARS: usize = 2048;
const MAX_QUERY_CHARS: usize = 500;
const MAX_LANGUAGE_CHARS: usize = 24;
const MAX_RESULTS: usize = 12;
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_TITLE_CHARS: usize = 320;
const MAX_SNIPPET_CHARS: usize = 1200;
const MAX_RESULT_URL_CHARS: usize = 4096;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "KatoSync-REX-Search/1.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchTimeRange {
    Day,
    Month,
    Year,
}

impl SearchTimeRange {
    fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearxngSearchRequest {
    pub base_url: String,
    pub query: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub time_range: Option<SearchTimeRange>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchCandidate {
    pub url: String,
    pub title: String,
    pub snippet: String,
    pub engine: Option<String>,
    pub score: Option<f64>,
    pub published_at: Option<String>,
    pub trust: &'static str,
    pub truth_level: &'static str,
    pub action_authority: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchSearchResult {
    pub schema_version: &'static str,
    pub provider: &'static str,
    pub query: String,
    pub searched_at: String,
    pub candidates: Vec<SearchCandidate>,
    pub trust: &'static str,
    pub action_authority: &'static str,
}

fn clean_bounded(value: &str, max_chars: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > max_chars
        || value
            .chars()
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(format!("Invalid or oversized search {label}."));
    }
    Ok(value.to_string())
}

fn clean_optional(
    value: Option<String>,
    max_chars: usize,
    label: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(value) if value.trim().is_empty() => Ok(None),
        Some(value) => clean_bounded(&value, max_chars, label).map(Some),
        None => Ok(None),
    }
}

fn validate_searxng_base(raw: &str) -> Result<(Url, endpoint_guard::ValidatedEndpoint), String> {
    let raw = raw.trim();
    if raw.is_empty()
        || raw.chars().count() > MAX_BASE_URL_CHARS
        || raw.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err("Invalid SearXNG base URL.".into());
    }

    let mut base = Url::parse(raw).map_err(|_| "Invalid SearXNG base URL.".to_string())?;
    if base.scheme() != "https"
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || base.port_or_known_default() != Some(443)
    {
        return Err("SearXNG v1 requires credential-free HTTPS on port 443.".into());
    }

    let host = base
        .host_str()
        .ok_or_else(|| "SearXNG base URL has no host.".to_string())?;
    if host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok() {
        return Err("SearXNG v1 requires a public DNS hostname.".into());
    }

    let endpoint =
        endpoint_guard::validate_endpoint(&base.origin().ascii_serialization(), false)
            .map_err(|_| "SearXNG target is not an allowed public HTTPS origin.".to_string())?;

    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());
        base.set_path(&path);
    }
    Ok((base, endpoint))
}

fn build_search_url(
    request: &SearxngSearchRequest,
) -> Result<(Url, endpoint_guard::ValidatedEndpoint, String), String> {
    let (base, endpoint) = validate_searxng_base(&request.base_url)?;
    let query = clean_bounded(&request.query, MAX_QUERY_CHARS, "query")?;
    let language = clean_optional(request.language.clone(), MAX_LANGUAGE_CHARS, "language")?;
    let mut url = base
        .join("search")
        .map_err(|_| "Could not construct SearXNG search URL.".to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("q", &query);
        pairs.append_pair("format", "json");
        pairs.append_pair("safesearch", "1");
        if let Some(language) = language.as_deref() {
            pairs.append_pair("language", language);
        }
        if let Some(range) = request.time_range {
            pairs.append_pair("time_range", range.as_str());
        }
    }
    Ok((url, endpoint, query))
}

fn bounded_plain(value: Option<&str>, max_chars: usize) -> String {
    value
        .unwrap_or_default()
        .replace('\0', "")
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn candidate_url(raw: &str) -> Option<String> {
    if raw.trim().is_empty() || raw.chars().count() > MAX_RESULT_URL_CHARS {
        return None;
    }
    let mut url = Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    Some(url.to_string())
}

fn first_engine(value: &Value) -> Option<String> {
    value
        .get("engine")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("engines")
                .and_then(Value::as_array)
                .and_then(|items| items.iter().find_map(Value::as_str))
                .map(str::to_string)
        })
        .map(|value| bounded_plain(Some(&value), 80))
        .filter(|value| !value.is_empty())
}

fn parse_searxng_results(body: &[u8], limit: usize) -> Result<Vec<SearchCandidate>, String> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err("SearXNG response exceeds the byte limit.".into());
    }
    let payload: Value =
        serde_json::from_slice(body).map_err(|_| "SearXNG returned invalid JSON.".to_string())?;
    let results = payload
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| "SearXNG JSON has no results array.".to_string())?;

    let limit = limit.clamp(1, MAX_RESULTS);
    let mut seen = BTreeSet::new();
    let mut candidates = Vec::new();
    for item in results {
        let Some(url) = item
            .get("url")
            .and_then(Value::as_str)
            .and_then(candidate_url)
        else {
            continue;
        };
        let key = url.to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let title = bounded_plain(item.get("title").and_then(Value::as_str), MAX_TITLE_CHARS);
        let snippet = bounded_plain(
            item.get("content").and_then(Value::as_str),
            MAX_SNIPPET_CHARS,
        );
        let published_at = item
            .get("publishedDate")
            .or_else(|| item.get("published_date"))
            .and_then(Value::as_str)
            .map(|value| bounded_plain(Some(value), 80))
            .filter(|value| !value.is_empty());
        let score = item
            .get("score")
            .and_then(Value::as_f64)
            .filter(|score| score.is_finite());

        candidates.push(SearchCandidate {
            url,
            title,
            snippet,
            engine: first_engine(item),
            score,
            published_at,
            trust: "untrusted_search_candidate",
            truth_level: "observed",
            action_authority: "none",
        });
        if candidates.len() == limit {
            break;
        }
    }
    Ok(candidates)
}

pub(crate) async fn search_searxng(
    request: SearxngSearchRequest,
) -> Result<ResearchSearchResult, String> {
    let limit = request.limit.unwrap_or(8).clamp(1, MAX_RESULTS);
    let (url, endpoint, query) = build_search_url(&request)?;
    let client = endpoint_guard::guarded_client(&endpoint, SEARCH_TIMEOUT)
        .ok_or_else(|| "Search client could not be created.".to_string())?;

    let mut response = client
        .get(url)
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            if endpoint_guard::is_blocked_target(&error) {
                "Search provider resolved to a blocked network.".to_string()
            } else {
                "Search provider request failed.".to_string()
            }
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "Search provider returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.starts_with("application/json") {
        return Err("Search provider did not return JSON.".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err("SearXNG response exceeds the byte limit.".into());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Search provider response body failed.".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("SearXNG response exceeds the byte limit.".into());
        }
        body.extend_from_slice(&chunk);
    }

    let candidates = parse_searxng_results(&body, limit)?;
    Ok(ResearchSearchResult {
        schema_version: SCHEMA,
        provider: PROVIDER,
        query,
        searched_at: Utc::now().to_rfc3339(),
        candidates,
        trust: "untrusted_search_candidates",
        action_authority: "none",
    })
}

#[tauri::command]
pub(crate) async fn research_search_searxng(
    request: SearxngSearchRequest,
) -> Result<ResearchSearchResult, String> {
    search_searxng(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_bounded_json_search_with_safe_defaults() {
        let request = SearxngSearchRequest {
            base_url: "https://search.example.org/".into(),
            query: "SearXNG current documentation".into(),
            language: Some("de-DE".into()),
            time_range: Some(SearchTimeRange::Month),
            limit: Some(5),
        };
        let (url, endpoint, query) = build_search_url(&request).unwrap();
        assert_eq!(query, "SearXNG current documentation");
        assert_eq!(endpoint.origin(), "https://search.example.org");
        assert_eq!(url.path(), "/search");
        let params = url
            .query_pairs()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect::<Vec<_>>();
        assert!(params.contains(&("format".into(), "json".into())));
        assert!(params.contains(&("safesearch".into(), "1".into())));
        assert!(params.contains(&("language".into(), "de-DE".into())));
        assert!(params.contains(&("time_range".into(), "month".into())));
    }

    #[test]
    fn provider_base_fails_closed_outside_public_https() {
        for value in [
            "http://search.example.org/",
            "https://localhost/",
            "https://127.0.0.1/",
            "https://169.254.169.254/",
            "https://router.local/",
            "https://user:pass@search.example.org/",
            "https://search.example.org:8443/",
            "https://search.example.org/?token=secret",
            "https://search.example.org/#frag",
        ] {
            assert!(validate_searxng_base(value).is_err(), "{value}");
        }
    }

    #[test]
    fn parser_bounds_deduplicates_and_marks_candidates_untrusted() {
        let payload = serde_json::json!({
            "results": [
                {
                    "url": "https://docs.example.org/page#section",
                    "title": "Official docs",
                    "content": "Primary source",
                    "engine": "example",
                    "score": 1.25,
                    "publishedDate": "2026-10-07"
                },
                {
                    "url": "https://docs.example.org/page",
                    "title": "duplicate",
                    "content": "duplicate"
                },
                {
                    "url": "javascript:alert(1)",
                    "title": "bad",
                    "content": "bad"
                },
                {
                    "url": "https://second.example.org/",
                    "title": "Second",
                    "content": "Independent source",
                    "engines": ["engine-a", "engine-b"]
                }
            ]
        });
        let body = serde_json::to_vec(&payload).unwrap();
        let results = parse_searxng_results(&body, 12).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://docs.example.org/page");
        assert_eq!(results[0].trust, "untrusted_search_candidate");
        assert_eq!(results[0].truth_level, "observed");
        assert_eq!(results[0].action_authority, "none");
        assert_eq!(results[1].engine.as_deref(), Some("engine-a"));
    }

    #[test]
    fn parser_rejects_non_json_shape_and_oversize() {
        assert!(parse_searxng_results(b"{}", 5).is_err());
        assert!(parse_searxng_results(b"not-json", 5).is_err());
        assert!(parse_searxng_results(&vec![b'x'; MAX_RESPONSE_BYTES + 1], 5).is_err());
    }

    #[tokio::test]
    #[ignore = "requires KATOSYNC_SEARXNG_URL and public HTTPS access"]
    async fn live_configured_searxng_returns_untrusted_candidates() {
        let base_url =
            std::env::var("KATOSYNC_SEARXNG_URL").expect("KATOSYNC_SEARXNG_URL is required");
        let result = search_searxng(SearxngSearchRequest {
            base_url,
            query: "SearXNG documentation".into(),
            language: Some("en".into()),
            time_range: None,
            limit: Some(3),
        })
        .await
        .unwrap();
        assert_eq!(result.provider, "searxng");
        assert_eq!(result.action_authority, "none");
        assert!(!result.candidates.is_empty());
        assert!(result.candidates.iter().all(|candidate| {
            candidate.truth_level == "observed"
                && candidate.trust == "untrusted_search_candidate"
                && candidate.action_authority == "none"
        }));
    }

    #[test]
    fn query_and_result_limits_are_bounded() {
        let oversized = SearxngSearchRequest {
            base_url: "https://search.example.org/".into(),
            query: "x".repeat(MAX_QUERY_CHARS + 1),
            language: None,
            time_range: None,
            limit: Some(999),
        };
        assert!(build_search_url(&oversized).is_err());

        let payload = serde_json::json!({
            "results": (0..20).map(|i| serde_json::json!({
                "url": format!("https://example.org/{i}"),
                "title": format!("Title {i}"),
                "content": "x"
            })).collect::<Vec<_>>()
        });
        let body = serde_json::to_vec(&payload).unwrap();
        assert_eq!(
            parse_searxng_results(&body, 999).unwrap().len(),
            MAX_RESULTS
        );
    }
}

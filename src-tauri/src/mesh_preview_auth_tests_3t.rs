//! Stage 3T – disposable Rust GoTrue loopback HTTP harness (synthetic credentials only).
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const OWNER: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const REF: &str = "abcdefghijklmnopqrst";
const PUBLIC_KEY: &str = "sb_publishable_synthetic_qa_key_12345";
fn grant() -> String {
    serde_json::json!({
        "access_token":"A".repeat(70),"refresh_token":"R".repeat(60),
        "token_type":"bearer","expires_in":3600
    })
    .to_string()
}
fn person(owner: &str, anonymous: bool) -> String {
    serde_json::json!({"id":owner,"email":"qa@example.invalid","is_anonymous":anonymous})
        .to_string()
}
async fn mock_server(
    replies: Vec<(u16, String)>,
) -> (PreviewConfig, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin: &'static str =
        Box::leak(format!("http://{}", listener.local_addr().unwrap()).into_boxed_str());
    let cfg = PreviewConfig {
        origin,
        project_ref: REF,
        api_key: PUBLIC_KEY,
    };
    let work = tokio::spawn(async move {
        let mut seen = Vec::new();
        for (status, body) in replies {
            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(4), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut buf = [0u8; 2048];
            let mut data = Vec::new();
            loop {
                let n = tokio::time::timeout(Duration::from_secs(4), socket.read(&mut buf))
                    .await
                    .unwrap()
                    .unwrap();
                assert!(n > 0, "early close");
                data.extend_from_slice(&buf[..n]);
                assert!(data.len() <= 8192, "unexpected large request");
                if let Some(head) = data.windows(4).position(|x| x == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&data[..head]);
                    let content_len = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if data.len() >= head + 4 + content_len {
                        break;
                    }
                }
            }
            let raw = String::from_utf8_lossy(&data);
            let first = raw.lines().next().unwrap_or("");
            seen.push(first.to_owned());
            assert!(raw.to_ascii_lowercase().contains("apikey: "));
            let response=format!(
                "HTTP/1.1 {status} TEST\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        seen
    });
    (cfg, work)
}
#[tokio::test]
async fn rust_http_gotrue_password_grant_and_online_user_match_in_one_issuer() {
    let (cfg, server) = mock_server(vec![(200, grant()), (200, person(OWNER, false))]).await;
    let c = client().unwrap();
    let issued = token_grant(
        &c,
        &cfg,
        "password",
        serde_json::json!({
            "email":"qa@example.invalid","password":"synthetic-test-only"
        }),
    )
    .await
    .unwrap();
    assert!(safe_tokens(&issued));
    let verified = verified_identity(&c, &cfg, &issued.access_token)
        .await
        .unwrap();
    assert_eq!(verified.id, OWNER);
    assert_eq!(verified.email.as_deref(), Some("qa@example.invalid"));
    let calls = server.await.unwrap();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].starts_with("POST /auth/v1/token?grant_type=password "));
    assert!(calls[1].starts_with("GET /auth/v1/user "));
}
#[tokio::test]
async fn rust_http_gotrue_refresh_grant_uses_same_preview_issuer() {
    let (cfg, server) = mock_server(vec![(200, grant()), (200, person(OWNER, false))]).await;
    let c = client().unwrap();
    let issued = token_grant(
        &c,
        &cfg,
        "refresh_token",
        serde_json::json!({
            "refresh_token":"synthetic-refresh-only"
        }),
    )
    .await
    .unwrap();
    let verified = verified_identity(&c, &cfg, &issued.access_token)
        .await
        .unwrap();
    assert_eq!(verified.id, OWNER);
    assert!(server.await.unwrap()[0].contains("grant_type=refresh_token"));
}
#[tokio::test]
async fn anonymous_or_malformed_online_user_never_verified() {
    for data in [
        person(OWNER, true),
        person("not-a-uuid", false),
        serde_json::json!({"id":OTHER,"email":null,"is_anonymous":false}).to_string(),
    ] {
        let (cfg, server) = mock_server(vec![(200, data)]).await;
        let error = verified_identity(&client().unwrap(), &cfg, &"A".repeat(70))
            .await
            .err()
            .unwrap();
        assert_eq!(error, "PREVIEW_IDENTITY_REJECTED");
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
#[tokio::test]
async fn malformed_or_oversized_gotrue_reply_denied_before_auth() {
    for reply in [
        "not-json".into(),
        serde_json::json!({
            "access_token":"too-short","refresh_token":"X".repeat(45),
            "token_type":"bearer","expires_in":3600
        })
        .to_string(),
        "X".repeat(MAX_RESPONSE + 20),
    ] {
        let (cfg, server) = mock_server(vec![(200, reply)]).await;
        let error = token_grant(
            &client().unwrap(),
            &cfg,
            "password",
            serde_json::json!({
                "email":"qa@example.invalid","password":"synthetic"
            }),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error, "PREVIEW_INVALID_RESPONSE");
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
#[tokio::test]
async fn gotrue_issuer_http_redirect_and_forbidden_fail_closed() {
    for status in [302, 401, 403] {
        let (cfg, server) = mock_server(vec![(status, grant())]).await;
        let error = token_grant(
            &client().unwrap(),
            &cfg,
            "password",
            serde_json::json!({
                "email":"qa@example.invalid","password":"synthetic"
            }),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error, "PREVIEW_LOGIN_REJECTED");
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
#[test]
fn two_preview_projects_have_distinct_keychain_account_names() {
    let a = PreviewConfig {
        origin: "https://abcdefghijklmnopqrst.supabase.co",
        project_ref: "abcdefghijklmnopqrst",
        api_key: PUBLIC_KEY,
    };
    let b = PreviewConfig {
        origin: "https://uvwxyzabcdefghijklmn.supabase.co",
        project_ref: "uvwxyzabcdefghijklmn",
        api_key: PUBLIC_KEY,
    };
    assert_ne!(preview_account(&a), preview_account(&b));
    assert!(preview_account(&a).starts_with(ACCOUNT));
    assert!(!preview_account(&a).contains("xbnnlyyxiilklsygxcof"));
    let saved = StoredPreviewSession {
        issuer_origin: a.origin.to_owned(),
        owner_id: OWNER.into(),
        refresh_token: "synthetic-private-test-refresh".into(),
    };
    assert_eq!(saved.issuer_origin, a.origin);
    assert_ne!(saved.issuer_origin, b.origin);
    assert!(!status(true, None).session_verified);
}

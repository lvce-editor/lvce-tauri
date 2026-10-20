pub fn validate_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid external URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("External browser URLs must use HTTP or HTTPS without credentials".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_web_authorization_urls() {
        assert!(validate_url("https://example.com/oidc/auth?state=example").is_ok());
        assert!(validate_url("http://localhost:43123/callback").is_ok());
    }

    #[test]
    fn rejects_non_web_schemes_and_credentials() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "mailto:a@example.com",
            "https://user:pass@example.com",
            "not a url",
        ] {
            assert!(validate_url(url).is_err(), "accepted {url}");
        }
    }
}

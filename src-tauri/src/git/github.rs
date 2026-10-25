use std::io::Write;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use super::settings::{clean_account, read_git_settings, redact_secrets};

const PAGE_SIZE: usize = 100;
const MAX_PAGES: u32 = 10;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    pub name: String,
    pub url: String,
    pub description: String,
    pub private: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepos {
    pub accounts: Vec<String>,
    pub account: String,
    pub repos: Vec<GithubRepo>,
    pub truncated: bool,
    pub notice: Option<String>,
}

pub(crate) struct PreparedGithubRepos {
    pub accounts: Vec<String>,
    pub account: String,
    pub token: Option<String>,
    pub notice: Option<String>,
}

#[derive(Deserialize)]
struct ApiRepo {
    full_name: String,
    clone_url: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    private: bool,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
}

struct RepoPage {
    repos: Vec<GithubRepo>,
    len: usize,
}

pub(crate) fn prepare_github_repos(account: &str) -> Result<PreparedGithubRepos, String> {
    let settings = read_git_settings()?;
    if !settings.git_available {
        return Ok(empty(
            "git was not found on PATH. Paste a repository URL to clone.",
        ));
    }
    if let Some(error) = settings.accounts_error {
        return Err(error);
    }
    if !settings.credential_manager {
        return Ok(empty(
            "Git Credential Manager was not found. Paste a repository URL to clone.",
        ));
    }
    if settings.accounts.is_empty() {
        return Ok(empty(
            "No GitHub account is signed in. Paste a URL, or sign in from Settings.",
        ));
    }

    let account = resolve_account(&settings.accounts, account)?;
    let account = clean_account(&account)?;
    let token = github_token(&account)?;
    Ok(PreparedGithubRepos {
        accounts: settings.accounts,
        account,
        token: Some(token),
        notice: None,
    })
}

pub(crate) async fn fetch_github_repos(token: &str) -> Result<(Vec<GithubRepo>, bool), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;

    let mut repos = Vec::new();
    let mut truncated = false;
    for page in 1..=MAX_PAGES {
        let url = format!(
            "https://api.github.com/user/repos?per_page={PAGE_SIZE}&page={page}&sort=pushed&direction=desc&type=all"
        );
        let response = client
            .get(&url)
            .header("User-Agent", "ce-git")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("Could not reach GitHub: {error}"))?;

        if response.status().is_redirection() {
            return Err("GitHub redirected the repository list.".into());
        }
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(api_error(status.as_u16(), &body));
        }
        let body = response
            .text()
            .await
            .map_err(|error| format!("Could not read the GitHub repository list: {error}"))?;
        let parsed = parse_repo_page(&body)?;
        let full = parsed.len >= PAGE_SIZE;
        repos.extend(parsed.repos);
        if !full {
            break;
        }
        if page == MAX_PAGES {
            truncated = true;
        }
    }
    Ok((repos, truncated))
}

fn empty(notice: &str) -> PreparedGithubRepos {
    PreparedGithubRepos {
        accounts: Vec::new(),
        account: String::new(),
        token: None,
        notice: Some(notice.to_string()),
    }
}

fn resolve_account(accounts: &[String], requested: &str) -> Result<String, String> {
    let requested = requested.trim();
    if requested.is_empty() {
        return accounts
            .first()
            .cloned()
            .ok_or_else(|| "No GitHub account is signed in.".to_string());
    }
    if let Some(account) = accounts
        .iter()
        .find(|account| account.as_str() == requested)
    {
        return Ok(account.clone());
    }
    if let Some(account) = accounts
        .iter()
        .find(|account| account.eq_ignore_ascii_case(requested))
    {
        return Ok(account.clone());
    }
    Err("That GitHub account is not signed in.".into())
}

fn github_token(account: &str) -> Result<String, String> {
    let dir = std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir());
    let mut command = Command::new("git");
    command
        .args(["-c", "credential.interactive=never", "credential", "fill"])
        .current_dir(&dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "git was not found on PATH".to_string()
        } else {
            format!("Failed to start git: {error}")
        }
    })?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not ask Git for the saved GitHub sign-in.".to_string())?;
        let request = format!("protocol=https\nhost=github.com\nusername={account}\n\n");
        stdin
            .write_all(request.as_bytes())
            .map_err(|error| format!("Could not ask Git for the saved GitHub sign-in: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Reading GitHub credentials failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Reading GitHub credentials failed: {}",
            redact_credential_text(stderr.trim())
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_password(&stdout).ok_or_else(|| {
        format!("No GitHub credentials are stored for {account}. Sign in from Settings.")
    })
}

fn parse_password(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let Some(value) = line.trim().strip_prefix("password=") else {
            continue;
        };
        if value.is_empty()
            || value
                .chars()
                .any(|character| character.is_whitespace() || character.is_control())
        {
            return None;
        }
        if !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

fn parse_repo_page(body: &str) -> Result<RepoPage, String> {
    let values: Vec<serde_json::Value> = serde_json::from_str(body)
        .map_err(|_| "GitHub returned an unexpected repository list.".to_string())?;
    let len = values.len();
    let repos = values
        .into_iter()
        .filter_map(|value| serde_json::from_value::<ApiRepo>(value).ok())
        .filter_map(accept_repo)
        .collect();
    Ok(RepoPage { repos, len })
}

fn accept_repo(repo: ApiRepo) -> Option<GithubRepo> {
    let name = repo.full_name.trim();
    let url = repo.clone_url.trim();
    if !valid_full_name(name) || !is_clone_url(url, name) {
        return None;
    }
    let description = repo
        .description
        .unwrap_or_default()
        .trim()
        .chars()
        .take(300)
        .collect();
    Some(GithubRepo {
        name: name.to_string(),
        url: url.to_string(),
        description,
        private: repo.private,
    })
}

fn valid_full_name(name: &str) -> bool {
    let mut parts = name.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(repo) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && !owner.is_empty()
        && !repo.is_empty()
        && owner != "."
        && owner != ".."
        && repo != "."
        && repo != ".."
        && !owner.starts_with('-')
        && !repo.starts_with('-')
        && name.len() <= 200
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/')
        })
}

fn is_clone_url(url: &str, full_name: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://github.com/") else {
        return false;
    };
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    rest == full_name
        && !url.contains(['@', '?', '#', ' ', '\\'])
        && !url.chars().any(char::is_control)
}

fn api_error(status: u16, body: &str) -> String {
    if status == 401 {
        return "GitHub rejected the saved sign-in. Sign in again from Settings.".into();
    }
    let message = serde_json::from_str::<ApiError>(body)
        .ok()
        .map(|error| error.message.trim().to_string())
        .filter(|message| !message.is_empty());
    let detail = message.unwrap_or_else(|| format!("HTTP {status}"));
    format!(
        "Could not list GitHub repositories: {}",
        redact_credential_text(&detail)
    )
}

fn redact_credential_text(value: &str) -> String {
    let without_passwords = value
        .lines()
        .map(|line| {
            if line.trim().starts_with("password=") {
                "password=[redacted]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let redacted = redact_secrets(&without_passwords);
    if redacted.trim().is_empty() {
        "git did not exit cleanly".to_string()
    } else {
        redacted
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ApiRepo, accept_repo, api_error, parse_password, parse_repo_page, redact_credential_text,
        resolve_account,
    };

    #[test]
    fn reads_a_github_token_from_credential_fill() {
        let stdout =
            "protocol=https\nhost=github.com\nusername=octocat\npassword=gho_secretvalue\n";
        assert_eq!(parse_password(stdout).as_deref(), Some("gho_secretvalue"));
        assert!(parse_password("password=\n").is_none());
        assert!(parse_password("password=has spaces\n").is_none());
        assert!(parse_password("password=gho_secret\nmore\n").is_some());
    }

    #[test]
    fn keeps_only_github_clone_urls() {
        let body = r#"[
            {"full_name":"octocat/hello","clone_url":"https://github.com/octocat/hello.git","description":"Hi","private":true},
            {"full_name":"octocat/hello","clone_url":"https://user:gho_secret@github.com/octocat/hello.git","description":null,"private":false},
            {"full_name":"bad","clone_url":"https://evil.example/octocat/hello.git"},
            {"not":"a repo"}
        ]"#;
        let page = parse_repo_page(body).unwrap();
        assert_eq!(page.len, 4);
        assert_eq!(page.repos.len(), 1);
        assert_eq!(page.repos[0].name, "octocat/hello");
        assert_eq!(page.repos[0].url, "https://github.com/octocat/hello.git");
        assert_eq!(page.repos[0].description, "Hi");
        assert!(page.repos[0].private);
    }

    #[test]
    fn rejects_clone_urls_that_do_not_match_the_repo() {
        let mismatched = ApiRepo {
            full_name: "octocat/hello".into(),
            clone_url: "https://github.com/other/hello.git".into(),
            description: None,
            private: false,
        };
        assert!(accept_repo(mismatched).is_none());
    }

    #[test]
    fn resolve_account_uses_the_signed_in_spelling() {
        let accounts = vec!["CHE-11".to_string(), "other".to_string()];
        assert_eq!(resolve_account(&accounts, "").unwrap(), "CHE-11");
        assert_eq!(resolve_account(&accounts, "che-11").unwrap(), "CHE-11");
        assert!(resolve_account(&accounts, "missing").is_err());
        assert!(resolve_account(&[], "").is_err());
    }

    #[test]
    fn github_errors_do_not_keep_tokens() {
        let message = api_error(
            403,
            r#"{"message":"bad ghp_abcdefghijklmnopqrstuvwxyz token"}"#,
        );
        assert!(!message.contains("ghp_"));
        assert!(message.contains("[redacted]"));
        assert_eq!(
            api_error(401, r#"{"message":"Bad credentials"}"#),
            "GitHub rejected the saved sign-in. Sign in again from Settings."
        );
        assert_eq!(
            redact_credential_text("password=gho_secretvalue\nfailed"),
            "password=[redacted] failed"
        );
    }
}

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubGist {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: String,
    pub public: bool,
    pub folder: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubGists {
    pub accounts: Vec<String>,
    pub account: String,
    pub gists: Vec<GithubGist>,
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

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not reach GitHub: {error}"))
}

pub(crate) async fn fetch_github_repos(token: &str) -> Result<(Vec<GithubRepo>, bool), String> {
    let client = github_client()?;

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

pub(crate) async fn fetch_github_gists(token: &str) -> Result<(Vec<GithubGist>, bool), String> {
    let client = github_client()?;
    let mut gists = Vec::new();
    let mut truncated = false;
    for page in 1..=MAX_PAGES {
        let url = format!("https://api.github.com/gists?per_page={PAGE_SIZE}&page={page}");
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
            return Err("GitHub redirected the gist list.".into());
        }
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(gist_api_error(
                "Could not list GitHub gists",
                status.as_u16(),
                &body,
            ));
        }
        let body = response
            .text()
            .await
            .map_err(|error| format!("Could not read the GitHub gist list: {error}"))?;
        let parsed = parse_gist_page(&body)?;
        let full = parsed.len >= PAGE_SIZE;
        gists.extend(parsed.gists);
        if !full {
            break;
        }
        if page == MAX_PAGES {
            truncated = true;
        }
    }
    Ok((gists, truncated))
}

pub(crate) async fn publish_gist(
    path: &std::path::Path,
    options: &super::sync::GistPublishOptions,
) -> super::sync::Outcome {
    use super::sync::Outcome;

    let path_buf = path.to_path_buf();
    let options = options.clone();
    let ready = match spawn_blocking(move || prepare_gist_publish(&path_buf, &options)).await {
        Ok(ready) => ready,
        Err(error) => return Outcome::Failed(error),
    };
    let prepared = match ready {
        Ok(prepared) => prepared,
        Err(error) => return Outcome::Failed(error),
    };
    let Some(token) = prepared.token else {
        return Outcome::Failed(
            prepared
                .notice
                .unwrap_or_else(|| "No GitHub account is signed in. Sign in from Settings.".into()),
        );
    };

    let created = match create_github_gist(&token, &prepared.description, prepared.secret).await {
        Ok(created) => created,
        Err(error) => return Outcome::Failed(error),
    };
    let url = clone_url_for_account(&created.url, &prepared.account);
    let path_buf = path.to_path_buf();
    let pushed = match spawn_blocking(move || super::sync::push_new_gist(&path_buf, &url)).await {
        Ok(pushed) => pushed,
        Err(error) => Err(error),
    };
    if let Err(error) = pushed {
        let deleted = delete_github_gist(&token, &created.id).await;
        let path_buf = path.to_path_buf();
        let _ = spawn_blocking(move || super::command::git(&path_buf, &["remote", "remove", "origin"])).await;
        return Outcome::Failed(match deleted {
            Ok(()) => error,
            Err(delete_error) => {
                format!("{error} The new gist could not be deleted: {delete_error}")
            }
        });
    }

    let visibility = if prepared.secret { "secret" } else { "public" };
    Outcome::Ok(format!(
        "Created {visibility} gist and pushed {}",
        prepared.branch
    ))
}

struct PreparedGistPublish {
    branch: String,
    account: String,
    token: Option<String>,
    notice: Option<String>,
    description: String,
    secret: bool,
}

fn prepare_gist_publish(
    path: &std::path::Path,
    options: &super::sync::GistPublishOptions,
) -> Result<PreparedGistPublish, String> {
    let branch = super::sync::prepare_gist_publish(path, options)?;
    let prepared = prepare_github_repos("")?;
    Ok(PreparedGistPublish {
        branch,
        account: prepared.account,
        token: prepared.token,
        notice: prepared.notice,
        description: options.description.trim().to_string(),
        secret: options.secret,
    })
}

async fn spawn_blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

struct CreatedGist {
    id: String,
    url: String,
}

async fn create_github_gist(
    token: &str,
    description: &str,
    secret: bool,
) -> Result<CreatedGist, String> {
    let client = github_client()?;
    let body = serde_json::json!({
        "description": description,
        "public": !secret,
        "files": {
            "ce-git.txt": {
                "content": "Published from ce-git.\n"
            }
        }
    });
    let response = client
        .post("https://api.github.com/gists")
        .header("User-Agent", "ce-git")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if response.status().is_redirection() {
        return Err("GitHub redirected gist creation.".into());
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(gist_api_error(
            "Could not create the GitHub gist",
            status.as_u16(),
            &body,
        ));
    }
    accept_created_gist(&body)
}

async fn delete_github_gist(token: &str, id: &str) -> Result<(), String> {
    if !is_gist_id(id) {
        return Err("GitHub returned an unexpected gist.".into());
    }
    let client = github_client()?;
    let response = client
        .delete(format!("https://api.github.com/gists/{id}"))
        .header("User-Agent", "ce-git")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if response.status().is_redirection() {
        return Err("GitHub redirected gist deletion.".into());
    }
    let status = response.status();
    if status.is_success() || status.as_u16() == 404 {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(gist_api_error(
        "Could not delete the GitHub gist",
        status.as_u16(),
        &body,
    ))
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
    credential_for_account(&stdout, account)
}

fn credential_for_account(stdout: &str, account: &str) -> Result<String, String> {
    let mut username = None;
    let mut password = None;
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("username=") {
            if username.is_none() && !value.is_empty() {
                username = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("password=") {
            if password.is_some() {
                continue;
            }
            if !valid_token(value) {
                return Err(missing_credential(account));
            }
            password = Some(value.to_string());
        }
    }
    let Some(password) = password else {
        return Err(missing_credential(account));
    };
    let Some(username) = username else {
        return Err("Git did not say which GitHub account this credential belongs to.".into());
    };
    if !username.eq_ignore_ascii_case(account) {
        return Err(format!(
            "Git saved a credential for {username}, not {account}."
        ));
    }
    Ok(password)
}

fn missing_credential(account: &str) -> String {
    format!("No GitHub credentials are stored for {account}. Sign in from Settings.")
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

pub(crate) fn clone_url_for_account(url: &str, account: &str) -> String {
    let account = account.trim();
    if account.is_empty() {
        return url.to_string();
    }
    if let Some(rest) = url.strip_prefix("https://github.com/") {
        if rest.is_empty() || rest.contains(['@', '?', '#', ' ', '\\']) {
            return url.to_string();
        }
        return format!("https://{}@github.com/{rest}", encode_account(account));
    }
    if let Some(rest) = url.strip_prefix("https://gist.github.com/") {
        if rest.is_empty() || rest.contains(['@', '?', '#', ' ', '\\', '/']) {
            return url.to_string();
        }
        return format!(
            "https://{}@gist.github.com/{rest}",
            encode_account(account)
        );
    }
    url.to_string()
}

fn encode_account(account: &str) -> String {
    let mut encoded = String::new();
    for byte in account.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
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

struct GistPage {
    gists: Vec<GithubGist>,
    len: usize,
}

fn parse_gist_page(body: &str) -> Result<GistPage, String> {
    let values: Vec<serde_json::Value> = serde_json::from_str(body)
        .map_err(|_| "GitHub returned an unexpected gist list.".to_string())?;
    let len = values.len();
    let gists = values
        .into_iter()
        .filter_map(|value| serde_json::from_value::<ApiGist>(value).ok())
        .filter_map(accept_gist)
        .collect();
    Ok(GistPage { gists, len })
}

#[derive(Deserialize)]
struct ApiGist {
    id: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    public: bool,
    git_pull_url: String,
    #[serde(default)]
    files: serde_json::Map<String, serde_json::Value>,
}

fn accept_gist(gist: ApiGist) -> Option<GithubGist> {
    let id = gist.id.trim();
    let url = gist.git_pull_url.trim();
    if !is_gist_id(id) || !is_gist_clone_url(url, id) {
        return None;
    }
    let description = gist
        .description
        .unwrap_or_default()
        .trim()
        .chars()
        .take(300)
        .collect::<String>();
    let file = gist.files.keys().next().map(String::as_str);
    let name = gist_label(&description, file, id);
    let folder = gist_folder_name(&name, id);
    Some(GithubGist {
        id: id.to_string(),
        name,
        url: url.to_string(),
        description,
        public: gist.public,
        folder,
    })
}

fn accept_created_gist(body: &str) -> Result<CreatedGist, String> {
    #[derive(Deserialize)]
    struct ApiCreated {
        id: String,
        git_push_url: String,
    }
    let created: ApiCreated = serde_json::from_str(body)
        .map_err(|_| "GitHub returned an unexpected gist.".to_string())?;
    let id = created.id.trim();
    let url = created.git_push_url.trim();
    if !is_gist_id(id) || !is_gist_clone_url(url, id) {
        return Err("GitHub returned an unexpected gist URL.".into());
    }
    Ok(CreatedGist {
        id: id.to_string(),
        url: url.to_string(),
    })
}

pub(crate) fn is_gist_id(id: &str) -> bool {
    let length = id.len();
    (20..=64).contains(&length) && id.chars().all(|character| character.is_ascii_hexdigit())
}

fn is_gist_clone_url(url: &str, id: &str) -> bool {
    url == format!("https://gist.github.com/{id}.git")
        && !url.contains(['@', '?', '#', ' ', '\\'])
        && !url.chars().any(char::is_control)
}

fn gist_label(description: &str, file: Option<&str>, id: &str) -> String {
    if !description.is_empty() {
        return description.to_string();
    }
    if let Some(file) = file.map(str::trim).filter(|file| !file.is_empty()) {
        return file.chars().take(300).collect();
    }
    id.to_string()
}

pub(crate) fn gist_folder_name(title: &str, id: &str) -> String {
    let mut cleaned = String::new();
    let mut previous_dash = false;
    for character in title.chars() {
        if character.is_alphanumeric() || character == '.' || character == '_' {
            cleaned.push(character);
            previous_dash = false;
        } else if !previous_dash && !cleaned.is_empty() {
            cleaned.push('-');
            previous_dash = true;
        }
        if cleaned.chars().count() >= 80 {
            break;
        }
    }
    let cleaned = cleaned.trim_matches(['-', '.', '_']).to_string();
    if cleaned.is_empty()
        || cleaned == "."
        || cleaned == ".."
        || cleaned.starts_with('-')
        || reserved_windows_name(&cleaned)
    {
        id.to_string()
    } else {
        cleaned
    }
}

fn reserved_windows_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn gist_api_error(action: &str, status: u16, body: &str) -> String {
    if status == 401 || missing_gist_scope(status, body) {
        return "GitHub rejected the saved sign-in. Sign in again from Settings.".into();
    }
    let message = serde_json::from_str::<ApiError>(body)
        .ok()
        .map(|error| error.message.trim().to_string())
        .filter(|message| !message.is_empty());
    let detail = message.unwrap_or_else(|| format!("HTTP {status}"));
    format!("{action}: {}", redact_credential_text(&detail))
}

fn missing_gist_scope(status: u16, body: &str) -> bool {
    if status != 403 {
        return false;
    }
    let lower = body.to_ascii_lowercase();
    lower.contains("scope")
        || lower.contains("resource not accessible")
        || lower.contains("gist")
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
        ApiGist, ApiRepo, accept_created_gist, accept_gist, accept_repo, api_error,
        clone_url_for_account, credential_for_account, gist_api_error, gist_folder_name,
        parse_gist_page, parse_repo_page, redact_credential_text, resolve_account,
    };

    #[test]
    fn reads_a_github_token_from_credential_fill() {
        let stdout =
            "protocol=https\nhost=github.com\nusername=octocat\npassword=gho_secretvalue\n";
        assert_eq!(
            credential_for_account(stdout, "octocat").as_deref(),
            Ok("gho_secretvalue")
        );
        assert_eq!(
            credential_for_account(stdout, "Octocat").as_deref(),
            Ok("gho_secretvalue")
        );
        let mismatch = credential_for_account(stdout, "other").unwrap_err();
        assert!(mismatch.contains("octocat"));
        assert!(mismatch.contains("not other"));
        assert!(!mismatch.contains("gho_"));
        assert!(credential_for_account("password=\n", "octocat").is_err());
        assert!(credential_for_account("password=has spaces\n", "octocat").is_err());
        assert!(credential_for_account("password=gho_secret\nmore\n", "octocat").is_err());
        assert!(
            credential_for_account("username=octocat\npassword=gho_secret\nmore\n", "octocat")
                .is_ok()
        );
    }

    #[test]
    fn clone_url_names_the_selected_account() {
        assert_eq!(
            clone_url_for_account("https://github.com/octocat/hello.git", "alice"),
            "https://alice@github.com/octocat/hello.git"
        );
        assert_eq!(
            clone_url_for_account("https://github.com/octocat/hello.git", "alice@contoso"),
            "https://alice%40contoso@github.com/octocat/hello.git"
        );
        assert_eq!(
            clone_url_for_account("https://github.com/octocat/hello.git", "  "),
            "https://github.com/octocat/hello.git"
        );
        assert_eq!(
            clone_url_for_account(
                "https://gist.github.com/aaaaaaaaaaaaaaaaaaaa.git",
                "alice"
            ),
            "https://alice@gist.github.com/aaaaaaaaaaaaaaaaaaaa.git"
        );
        assert_eq!(
            clone_url_for_account(
                "https://gist.github.com/octocat/aaaaaaaaaaaaaaaaaaaa.git",
                "alice"
            ),
            "https://gist.github.com/octocat/aaaaaaaaaaaaaaaaaaaa.git"
        );
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
    fn keeps_only_gist_clone_urls() {
        let id = "aaaaaaaaaaaaaaaaaaaa";
        let body = format!(
            r#"[
                {{"id":"{id}","description":"Hello World","public":false,"git_pull_url":"https://gist.github.com/{id}.git","files":{{"notes.txt":{{}}}}}},
                {{"id":"{id}","description":null,"public":true,"git_pull_url":"https://user:gho_secret@gist.github.com/{id}.git","files":{{}}}},
                {{"id":"short","description":"nope","public":true,"git_pull_url":"https://gist.github.com/short.git","files":{{}}}},
                {{"not":"a gist"}}
            ]"#
        );
        let page = parse_gist_page(&body).unwrap();
        assert_eq!(page.len, 4);
        assert_eq!(page.gists.len(), 1);
        assert_eq!(page.gists[0].id, id);
        assert_eq!(page.gists[0].name, "Hello World");
        assert_eq!(page.gists[0].folder, "Hello-World");
        assert!(!page.gists[0].public);
        assert_eq!(
            page.gists[0].url,
            format!("https://gist.github.com/{id}.git")
        );
    }

    #[test]
    fn gist_names_fall_back_to_a_file_then_the_id() {
        let id = "bbbbbbbbbbbbbbbbbbbb";
        let from_file = accept_gist(ApiGist {
            id: id.into(),
            description: Some("  ".into()),
            public: true,
            git_pull_url: format!("https://gist.github.com/{id}.git"),
            files: serde_json::from_str(r#"{"README.md":{}}"#).unwrap(),
        })
        .unwrap();
        assert_eq!(from_file.name, "README.md");
        assert_eq!(from_file.folder, "README.md");

        let from_id = accept_gist(ApiGist {
            id: id.into(),
            description: None,
            public: false,
            git_pull_url: format!("https://gist.github.com/{id}.git"),
            files: serde_json::Map::new(),
        })
        .unwrap();
        assert_eq!(from_id.folder, id);
        assert_eq!(gist_folder_name("CON", id), id);
        assert_eq!(gist_folder_name("***", id), id);

        let created = accept_created_gist(&format!(
            r#"{{"id":"{id}","git_push_url":"https://gist.github.com/{id}.git"}}"#
        ))
        .unwrap();
        assert_eq!(created.id, id);
        assert!(
            accept_created_gist(&format!(
                r#"{{"id":"{id}","git_push_url":"https://evil.example/{id}.git"}}"#
            ))
            .is_err()
        );
    }

    #[test]
    fn gist_scope_errors_ask_for_settings_sign_in() {
        assert_eq!(
            gist_api_error(
                "Could not create the GitHub gist",
                403,
                r#"{"message":"Resource not accessible by integration"}"#,
            ),
            "GitHub rejected the saved sign-in. Sign in again from Settings."
        );
        let message = gist_api_error(
            "Could not list GitHub gists",
            403,
            r#"{"message":"bad ghp_abcdefghijklmnopqrstuvwxyz token"}"#,
        );
        assert!(!message.contains("ghp_"));
        assert!(message.contains("Could not list GitHub gists"));
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

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use super::command::{GitOutput, git_available, spawn_git, stop_process};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    pub git_available: bool,
    pub credential_manager: bool,
    pub helper_configured: bool,
    pub name: String,
    pub email: String,
    pub default_branch: String,
    pub autocrlf: String,
    pub accounts: Vec<String>,
    pub accounts_error: Option<String>,
}

struct SignInState {
    pid: Option<u32>,
    cancelled: bool,
}

static SIGN_IN: Mutex<Option<SignInState>> = Mutex::new(None);

pub fn read_git_settings() -> Result<GitSettings, String> {
    if !git_available() {
        return Ok(GitSettings::unavailable());
    }

    let credential_manager = gcm_available();
    let (accounts, accounts_error) = if credential_manager {
        match github_accounts() {
            Ok(accounts) => (accounts, None),
            Err(error) => (Vec::new(), Some(error)),
        }
    } else {
        (Vec::new(), None)
    };

    Ok(GitSettings {
        git_available: true,
        credential_manager,
        helper_configured: helper_configured()?,
        name: global_get("user.name")?,
        email: global_get("user.email")?,
        default_branch: global_get("init.defaultBranch")?,
        autocrlf: normalize_autocrlf(&global_get("core.autocrlf")?),
        accounts,
        accounts_error,
    })
}

pub fn save_git_settings(
    name: String,
    email: String,
    default_branch: String,
    autocrlf: String,
) -> Result<(), String> {
    if !git_available() {
        return Err("git was not found on PATH.".into());
    }

    let name = clean_name(&name)?;
    let email = clean_email(&email)?;
    let default_branch = clean_branch(&default_branch)?;
    let autocrlf = clean_autocrlf(&autocrlf)?;

    global_set("user.name", &name)?;
    global_set("user.email", &email)?;
    global_set("init.defaultBranch", &default_branch)?;
    global_set("core.autocrlf", &autocrlf)?;
    Ok(())
}

pub fn git_sign_in(username: String) -> Result<GitSettings, String> {
    if !git_available() {
        return Err("git was not found on PATH.".into());
    }
    if !gcm_available() {
        return Err(
            "Git Credential Manager was not found. Install Git for Windows, then restart ce-git."
                .into(),
        );
    }
    let requested = match username.trim() {
        "" => None,
        value => Some(clean_account(value)?),
    };
    if !begin_sign_in() {
        return Err("Sign-in is already in progress.".into());
    }

    let before = github_accounts().unwrap_or_default();
    let result = run_sign_in(requested.as_deref());
    let cancelled = finish_sign_in();
    match result {
        Ok(()) => confirm_sign_in(requested.as_deref(), &before),
        Err(_) if cancelled => Err("Sign-in was cancelled.".into()),
        Err(error) => Err(error),
    }
}

fn confirm_sign_in(requested: Option<&str>, before: &[String]) -> Result<GitSettings, String> {
    let settings = read_git_settings()?;
    let Some(requested) = requested else {
        return Ok(settings);
    };
    if let Some(error) = settings.accounts_error.clone() {
        return Err(error);
    }
    if stored_account(&settings.accounts, requested).is_none() {
        return Err(sign_in_failure(requested, before, &settings.accounts));
    }
    Ok(settings)
}

fn run_sign_in(username: Option<&str>) -> Result<(), String> {
    ensure_helper()?;
    if sign_in_cancelled() {
        return Err("Sign-in was cancelled.".into());
    }

    let dir = work_dir()?;
    let args = login_args(username);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut child = spawn_git(&dir, &arg_refs, true)?;
    if !set_sign_in_pid(child.id()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Sign-in was cancelled.".into());
    }

    let output = GitOutput::from_output(
        child
            .wait_with_output()
            .map_err(|error| format!("Sign-in failed: {error}"))?,
    );
    if output.success() {
        return Ok(());
    }
    Err(failure("Sign-in", &output))
}

fn login_args(username: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "credential-manager".to_string(),
        "github".to_string(),
        "login".to_string(),
        "--browser".to_string(),
    ];
    if let Some(username) = username.filter(|value| !value.is_empty()) {
        args.push("--username".to_string());
        args.push(username.to_string());
    }
    args
}

fn stored_account<'a>(accounts: &'a [String], requested: &str) -> Option<&'a str> {
    accounts
        .iter()
        .find(|account| account.eq_ignore_ascii_case(requested))
        .map(String::as_str)
}

fn sign_in_failure(requested: &str, before: &[String], after: &[String]) -> String {
    let newcomers: Vec<&str> = after
        .iter()
        .filter(|account| {
            !before
                .iter()
                .any(|known| known.eq_ignore_ascii_case(account))
        })
        .map(String::as_str)
        .collect();
    if newcomers.is_empty() {
        format!(
            "GitHub did not sign in as {requested}. Switch to that account in the browser and authorize Git Credential Manager."
        )
    } else if newcomers.len() == 1 {
        format!(
            "GitHub signed in as {}, not {requested}. Switch to {requested} in the browser and try again.",
            newcomers[0]
        )
    } else {
        format!(
            "GitHub signed in as {}, not {requested}. Switch to {requested} in the browser and try again.",
            newcomers.join(", ")
        )
    }
}

pub fn git_sign_out(account: String) -> Result<GitSettings, String> {
    if !gcm_available() {
        return Err(
            "Git Credential Manager was not found. Install Git for Windows, then restart ce-git."
                .into(),
        );
    }
    let account = clean_account(&account)?;
    let output = run(&[
        "credential-manager",
        "github",
        "--no-ui",
        "logout",
        &account,
    ])?;
    if !output.success() {
        return Err(failure("Sign-out", &output));
    }
    read_git_settings()
}

pub fn git_cancel_sign_in() {
    let pid = {
        let mut guard = sign_in_lock();
        let Some(state) = guard.as_mut() else {
            return;
        };
        state.cancelled = true;
        state.pid
    };
    if let Some(pid) = pid {
        stop_process(pid);
    }
}

impl GitSettings {
    fn unavailable() -> Self {
        Self {
            git_available: false,
            credential_manager: false,
            helper_configured: false,
            name: String::new(),
            email: String::new(),
            default_branch: String::new(),
            autocrlf: String::new(),
            accounts: Vec::new(),
            accounts_error: None,
        }
    }
}

fn sign_in_lock() -> std::sync::MutexGuard<'static, Option<SignInState>> {
    SIGN_IN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn begin_sign_in() -> bool {
    let mut guard = sign_in_lock();
    if guard.is_some() {
        return false;
    }
    *guard = Some(SignInState {
        pid: None,
        cancelled: false,
    });
    true
}

fn set_sign_in_pid(pid: u32) -> bool {
    let mut guard = sign_in_lock();
    let Some(state) = guard.as_mut() else {
        return false;
    };
    state.pid = Some(pid);
    !state.cancelled
}

fn sign_in_cancelled() -> bool {
    sign_in_lock().as_ref().is_some_and(|state| state.cancelled)
}

fn finish_sign_in() -> bool {
    sign_in_lock().take().is_some_and(|state| state.cancelled)
}

fn ensure_helper() -> Result<(), String> {
    if helper_configured()? {
        return Ok(());
    }
    let output = run(&["credential-manager", "configure", "--no-ui"])?;
    if output.success() {
        return Ok(());
    }
    Err(failure("Enabling Git Credential Manager", &output))
}

fn work_dir() -> Result<PathBuf, String> {
    let current = std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir());
    if current.is_dir() {
        return Ok(current);
    }
    let temp = std::env::temp_dir();
    if temp.is_dir() {
        return Ok(temp);
    }
    Err("No working directory is available for git.".into())
}

fn run(args: &[&str]) -> Result<GitOutput, String> {
    let dir = work_dir()?;
    run_in(&dir, args)
}

fn run_in(dir: &Path, args: &[&str]) -> Result<GitOutput, String> {
    let child = spawn_git(dir, args, false)?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to run git: {error}"))?;
    Ok(GitOutput::from_output(output))
}

fn gcm_available() -> bool {
    run(&["credential-manager", "--version"])
        .map(|output| output.success())
        .unwrap_or(false)
}

fn github_accounts() -> Result<Vec<String>, String> {
    let output = run(&["credential-manager", "github", "--no-ui", "list"])?;
    if !output.success() {
        return Err(failure("Listing GitHub accounts", &output));
    }
    Ok(parse_accounts(&output.stdout))
}

fn helper_configured() -> Result<bool, String> {
    let output = run(&["config", "--get-regexp", "^credential\\.helper$"])?;
    if output.status == Some(1) {
        return Ok(false);
    }
    if !output.success() {
        return Err(failure("Reading the credential helper", &output));
    }
    Ok(output.stdout.lines().any(helper_line_uses_manager))
}

fn global_get(key: &str) -> Result<String, String> {
    let output = run(&["config", "--global", "--get", key])?;
    if output.success() {
        return Ok(output.stdout.trim().to_string());
    }
    if output.status == Some(1) && output.stderr.trim().is_empty() {
        return Ok(String::new());
    }
    Err(failure(&format!("Reading {key}"), &output))
}

fn global_set(key: &str, value: &str) -> Result<(), String> {
    let output = if value.is_empty() {
        run(&["config", "--global", "--unset-all", key])?
    } else {
        run(&["config", "--global", "--replace-all", key, value])?
    };
    if output.success() || (value.is_empty() && output.status == Some(5)) {
        return Ok(());
    }
    Err(failure(&format!("Saving {key}"), &output))
}

fn normalize_autocrlf(value: &str) -> String {
    let lower = value.trim().to_ascii_lowercase();
    match lower.as_str() {
        "true" | "false" | "input" => lower,
        _ => value.trim().to_string(),
    }
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter the name that should appear on commits.".into());
    }
    if name.len() > 200 || name.starts_with('-') || name.chars().any(char::is_control) {
        return Err("Enter a name without a leading dash or line break.".into());
    }
    Ok(name.to_string())
}

fn clean_email(email: &str) -> Result<String, String> {
    let email = email.trim();
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    let extra = parts.next();
    let ok = extra.is_none()
        && !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && email.len() <= 254
        && !email.starts_with('-')
        && email
            .chars()
            .all(|character| !character.is_whitespace() && !character.is_control());
    if !ok {
        return Err("Enter an email address.".into());
    }
    Ok(email.to_string())
}

fn clean_branch(branch: &str) -> Result<String, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Ok(String::new());
    }
    let ok = branch.len() <= 100
        && !branch.starts_with('-')
        && !branch.starts_with('/')
        && !branch.ends_with('/')
        && !branch.ends_with('.')
        && !branch.ends_with(".lock")
        && !branch.contains("//")
        && !branch.contains("..")
        && !branch.contains("@{")
        && branch.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/')
        });
    if !ok {
        return Err("Enter a branch name such as main.".into());
    }
    Ok(branch.to_string())
}

fn clean_autocrlf(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || matches!(value, "true" | "false" | "input") {
        return Ok(value.to_string());
    }
    let safe = value.len() <= 32
        && !value.starts_with('-')
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        });
    if safe {
        return Ok(value.to_string());
    }
    Err("Choose a line ending setting.".into())
}

pub(crate) fn clean_account(account: &str) -> Result<String, String> {
    let account = account.trim();
    if !is_account_line(account) {
        return Err("That GitHub account name is not valid.".into());
    }
    Ok(account.to_string())
}

fn parse_accounts(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| is_account_line(line))
        .map(str::to_string)
        .collect()
}

fn is_account_line(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('-')
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '@' | '+')
        })
}

fn helper_line_uses_manager(line: &str) -> bool {
    let mut parts = line.split_whitespace();
    let Some(key) = parts.next() else {
        return false;
    };
    if key != "credential.helper" {
        return false;
    }
    parts.any(|value| value == "manager" || value.starts_with("manager-"))
}

fn failure(action: &str, output: &GitOutput) -> String {
    format!("{action} failed: {}", detail_of(output))
}

fn detail_of(output: &GitOutput) -> String {
    let stderr = output.stderr.trim();
    let stdout = output.stdout.trim();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        return match output.status {
            Some(code) => format!("exit {code}"),
            None => "git did not exit cleanly".to_string(),
        };
    };
    redact_secrets(detail)
}

pub(crate) fn redact_secrets(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let bare = word.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '_'
            });
            if is_token(bare) { "[redacted]" } else { word }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_token(value: &str) -> bool {
    const PREFIXES: [&str; 6] = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"];
    PREFIXES.iter().any(|prefix| value.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::{
        clean_autocrlf, clean_branch, clean_email, clean_name, helper_line_uses_manager,
        login_args, parse_accounts, redact_secrets, sign_in_failure, stored_account,
    };

    #[test]
    fn login_targets_the_requested_github_user() {
        assert_eq!(
            login_args(None),
            vec![
                "credential-manager".to_string(),
                "github".to_string(),
                "login".to_string(),
                "--browser".to_string(),
            ]
        );
        assert_eq!(
            login_args(Some("alice")),
            vec![
                "credential-manager".to_string(),
                "github".to_string(),
                "login".to_string(),
                "--browser".to_string(),
                "--username".to_string(),
                "alice".to_string(),
            ]
        );
        assert_eq!(login_args(Some("")), login_args(None));
    }

    #[test]
    fn requested_account_must_be_stored() {
        let accounts = vec!["CHE-11".to_string(), "other".to_string()];
        assert_eq!(stored_account(&accounts, "che-11"), Some("CHE-11"));
        assert_eq!(stored_account(&accounts, "CHE-11"), Some("CHE-11"));
        assert_eq!(stored_account(&accounts, "missing"), None);

        let before = vec!["CHE-11".to_string()];
        let same = sign_in_failure("other", &before, &before);
        assert!(same.contains("did not sign in as other"));
        let replaced =
            sign_in_failure("other", &before, &["CHE-11".to_string(), "bob".to_string()]);
        assert!(replaced.contains("signed in as bob"));
        assert!(replaced.contains("not other"));
    }

    #[test]
    fn parses_github_account_names() {
        assert_eq!(parse_accounts("CHE-11\n\n"), vec!["CHE-11".to_string()]);
        assert_eq!(
            parse_accounts("one\ntwo\nwarning: something happened\n"),
            vec!["one".to_string(), "two".to_string()]
        );
    }

    #[test]
    fn accepts_commit_identity() {
        assert_eq!(clean_name("  Connor E  ").unwrap(), "Connor E");
        assert_eq!(
            clean_email("id+name@users.noreply.github.com").unwrap(),
            "id+name@users.noreply.github.com"
        );
        assert!(clean_name("").is_err());
        assert!(clean_name("-nope").is_err());
        assert!(clean_email("not-an-email").is_err());
        assert!(clean_branch("").unwrap().is_empty());
        assert_eq!(clean_branch("main").unwrap(), "main");
        assert!(clean_branch("-main").is_err());
        assert_eq!(clean_autocrlf("true").unwrap(), "true");
        assert!(clean_autocrlf("true\nfalse").is_err());
    }

    #[test]
    fn detects_credential_manager_helper() {
        assert!(helper_line_uses_manager("credential.helper manager"));
        assert!(helper_line_uses_manager("credential.helper manager-core"));
        assert!(!helper_line_uses_manager("credential.helper"));
        assert!(!helper_line_uses_manager(
            "credential.https://github.com.helper manager"
        ));
    }

    #[test]
    fn redacts_github_tokens() {
        assert_eq!(
            redact_secrets("token ghp_abcdefghijklmnopqrstuvwxyz rejected"),
            "token [redacted] rejected"
        );
    }

    #[test]
    fn reads_current_settings() {
        if !crate::git::git_available() {
            return;
        }
        let settings = super::read_git_settings().expect("git settings should load");
        assert!(settings.git_available);
        assert!(
            settings.accounts_error.is_none(),
            "{}",
            settings.accounts_error.unwrap_or_default()
        );
    }
}

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde::Deserialize;

use super::command::{dir_name, git};
use super::status::{
    CurrentBranch, ahead_behind, current_branch, is_dirty, is_github_url, origin_url,
    resolve_default_branch,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOptions {
    pub name: String,
    pub description: String,
    pub visibility: String,
    pub homepage: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Ok(String),
    Skipped(String),
    Failed(String),
    /// A merge is in progress and conflicted files still need a resolution.
    Conflict(String),
}

enum LocalUpdate {
    Updated,
    Unchanged,
    Diverged,
}

#[derive(Clone, Copy)]
enum LocalRelation {
    Missing,
    Unchanged,
    Diverged,
    Behind,
}

pub fn pull_default(path: &Path) -> Outcome {
    if let Err(error) = require_repo(path) {
        return Outcome::Failed(error);
    }

    // A pull that already stopped on conflicts should come back to the same choice
    // instead of being reported as an ordinary dirty tree.
    if merge_in_progress(path) {
        let branch = resolve_default_branch(path).unwrap_or_else(|_| "main".into());
        let head = current_branch(path)
            .map(|current| current.name)
            .unwrap_or_else(|_| "HEAD".into());
        return conflict_outcome(path, &head, &branch);
    }

    match is_dirty(path) {
        Ok(true) => return Outcome::Skipped("Dirty working tree".into()),
        Ok(false) => {}
        Err(error) => return Outcome::Failed(error),
    }

    let branch = match resolve_default_branch(path) {
        Ok(branch) => branch,
        Err(error) => return Outcome::Failed(error),
    };
    let head = match current_branch(path) {
        Ok(current) => current,
        Err(error) => return Outcome::Failed(error),
    };

    if let Err(error) = git(path, &["fetch", "origin", &branch]) {
        return Outcome::Failed(error);
    }
    let remote = format!("origin/{branch}");

    if !head.detached && head.name == branch {
        return integrate_remote(path, &head.name, &branch, &remote);
    }

    let relation = match local_relation(path, &branch, &remote) {
        Ok(relation) => relation,
        Err(error) => return Outcome::Failed(error),
    };

    // The checked-out branch has its own commits and main also moved.
    // Merge main in place so the local commits are kept. Local main moves only
    // after that merge commits, so aborting a conflict restores the pull.
    if !head.detached {
        match divergence(path, "HEAD", &remote) {
            Ok((ahead, behind)) if ahead > 0 && behind > 0 => {
                let merged = merge_remote(path, &head.name, &branch, &remote, ahead, behind);
                if !matches!(merged, Outcome::Ok(_)) {
                    return if matches!(relation, LocalRelation::Diverged) {
                        note_local_default(merged, &branch, LocalUpdate::Diverged)
                    } else {
                        merged
                    };
                }
                if let Err(error) = apply_local_update(path, &branch, &remote, relation) {
                    return Outcome::Failed(error);
                }
                return note_local_default(merged, &branch, relation_as_update(relation));
            }
            Ok(_) => {}
            Err(error) => return Outcome::Failed(error),
        }
    }

    let before = tip(path, &branch);
    if let Err(error) = apply_local_update(path, &branch, &remote, relation) {
        return Outcome::Failed(error);
    }
    match relation_as_update(relation) {
        LocalUpdate::Updated => pull_outcome(path, &branch, &head, before),
        LocalUpdate::Diverged => Outcome::Skipped(format!(
            "{branch} has local commits and is not checked out, so it was left unchanged"
        )),
        LocalUpdate::Unchanged => Outcome::Skipped(format!("{branch} is already up to date")),
    }
}

fn integrate_remote(path: &Path, head: &str, branch: &str, remote: &str) -> Outcome {
    let before = tip(path, branch);
    let (ahead, behind) = match divergence(path, "HEAD", remote) {
        Ok(counts) => counts,
        Err(error) => return Outcome::Failed(error),
    };
    if behind == 0 {
        return Outcome::Skipped(format!("{branch} is already up to date"));
    }
    if ahead == 0 {
        return match git(path, &["merge", "--ff-only", "--no-edit", remote]) {
            Ok(_) => pull_outcome(
                path,
                branch,
                &CurrentBranch {
                    name: head.to_string(),
                    detached: false,
                    has_commits: true,
                },
                before,
            ),
            Err(error) => Outcome::Failed(error),
        };
    }
    merge_remote(path, head, branch, remote, ahead, behind)
}

fn merge_remote(
    path: &Path,
    head: &str,
    branch: &str,
    remote: &str,
    ahead: u32,
    behind: u32,
) -> Outcome {
    // `--ff` overrides merge.ff=only so a branch that is ahead can still take the remote commits.
    match git(path, &["merge", "--ff", "--no-edit", remote]) {
        Ok(_) => Outcome::Ok(format!(
            "Merged {behind} commit(s) from {remote} into {head} ({ahead} local commit(s) kept)"
        )),
        Err(error) => {
            if !unmerged_files(path).is_empty() {
                return conflict_outcome(path, head, branch);
            }
            if merge_in_progress(path) {
                return Outcome::Failed(format!(
                    "{error} The merge is ready to finish once Git can create the commit."
                ));
            }
            Outcome::Failed(error)
        }
    }
}

fn note_local_default(outcome: Outcome, branch: &str, updated: LocalUpdate) -> Outcome {
    let note = match updated {
        LocalUpdate::Updated => format!("Updated {branch}. "),
        LocalUpdate::Diverged => format!("{branch} has local commits and was left unchanged. "),
        LocalUpdate::Unchanged => String::new(),
    };
    if note.is_empty() {
        return outcome;
    }
    match outcome {
        Outcome::Ok(message) => Outcome::Ok(format!("{note}{message}")),
        Outcome::Conflict(message) => Outcome::Conflict(format!("{note}{message}")),
        Outcome::Skipped(message) => Outcome::Skipped(format!("{note}{message}")),
        Outcome::Failed(message) => Outcome::Failed(format!("{note}{message}")),
    }
}

fn local_relation(path: &Path, branch: &str, remote: &str) -> Result<LocalRelation, String> {
    let local = format!("refs/heads/{branch}");
    if git(path, &["show-ref", "--verify", "--quiet", &local]).is_err() {
        return Ok(LocalRelation::Missing);
    }
    let (ahead, behind) = divergence(path, branch, remote)?;
    if behind == 0 {
        return Ok(LocalRelation::Unchanged);
    }
    if ahead > 0 {
        return Ok(LocalRelation::Diverged);
    }
    Ok(LocalRelation::Behind)
}

fn apply_local_update(
    path: &Path,
    branch: &str,
    remote: &str,
    relation: LocalRelation,
) -> Result<(), String> {
    match relation {
        LocalRelation::Missing => git(path, &["branch", branch, remote]).map(|_| ()),
        LocalRelation::Behind => git(path, &["branch", "-f", branch, remote]).map(|_| ()),
        LocalRelation::Unchanged | LocalRelation::Diverged => Ok(()),
    }
}

fn relation_as_update(relation: LocalRelation) -> LocalUpdate {
    match relation {
        LocalRelation::Missing | LocalRelation::Behind => LocalUpdate::Updated,
        LocalRelation::Unchanged => LocalUpdate::Unchanged,
        LocalRelation::Diverged => LocalUpdate::Diverged,
    }
}

fn divergence(path: &Path, left: &str, right: &str) -> Result<(u32, u32), String> {
    let range = format!("{left}...{right}");
    let output = git(path, &["rev-list", "--left-right", "--count", &range])?;
    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Ok((ahead, behind))
}

pub fn conflict_files(path: &Path) -> Vec<String> {
    unmerged_files(path)
}

pub fn continue_merge(path: &Path) -> Result<String, String> {
    if let Err(error) = require_repo(path) {
        return Err(error);
    }
    if !merge_in_progress(path) {
        return Err("No merge is in progress.".into());
    }

    let mut markers = Vec::new();
    let mut binary = Vec::new();
    for file in unmerged_files(path) {
        match file_resolution(path, &file) {
            FileResolution::Clean | FileResolution::Missing => {
                git(path, &["add", "--", &file])?;
            }
            FileResolution::Markers => markers.push(file),
            FileResolution::Binary => binary.push(file),
        }
    }
    if !markers.is_empty() || !binary.is_empty() {
        return Err(unresolved_message(&markers, &binary));
    }
    if !unmerged_files(path).is_empty() {
        return Err("Merge is not finished. Some files are still unmerged.".into());
    }

    git(path, &["commit", "--no-edit"])?;
    let subject =
        git(path, &["log", "-1", "--pretty=%s"]).unwrap_or_else(|_| "Merge committed".into());
    Ok(format!("Committed: {}", subject.trim()))
}

pub fn abort_merge(path: &Path) -> Result<String, String> {
    if let Err(error) = require_repo(path) {
        return Err(error);
    }
    if !merge_in_progress(path) {
        return Err("No merge is in progress.".into());
    }
    git(path, &["merge", "--abort"])?;
    Ok("Merge aborted".into())
}

enum FileResolution {
    Clean,
    Markers,
    Binary,
    Missing,
}

fn file_resolution(repo: &Path, relative: &str) -> FileResolution {
    let full = repo.join(relative);
    if !full.exists() {
        return FileResolution::Missing;
    }
    let Ok(bytes) = std::fs::read(&full) else {
        return FileResolution::Binary;
    };
    if bytes.contains(&0) {
        return FileResolution::Binary;
    }
    let text = String::from_utf8_lossy(&bytes);
    if text.lines().any(|line| line.starts_with("<<<<<<<")) {
        FileResolution::Markers
    } else {
        FileResolution::Clean
    }
}

fn unresolved_message(markers: &[String], binary: &[String]) -> String {
    let mut parts = Vec::new();
    if !markers.is_empty() {
        parts.push(format!(
            "still have conflict markers: {}",
            summarize_files(markers)
        ));
    }
    if !binary.is_empty() {
        parts.push(format!(
            "binary conflicts need a choice: {}",
            summarize_files(binary)
        ));
    }
    format!("Merge is not finished. {}", parts.join(" "))
}

fn conflict_outcome(path: &Path, head: &str, branch: &str) -> Outcome {
    let files = unmerged_files(path);
    if files.is_empty() {
        return Outcome::Conflict(format!(
            "A merge into {head} from origin/{branch} is ready to finish."
        ));
    }
    Outcome::Conflict(format!(
        "Merge conflicts in {head} from origin/{branch}: {}. Resolve them, then finish the merge.",
        summarize_files(&files)
    ))
}

fn summarize_files(files: &[String]) -> String {
    if files.is_empty() {
        return "unmerged files".into();
    }
    const MAX: usize = 4;
    if files.len() <= MAX {
        return files.join(", ");
    }
    format!("{} and {} more", files[..MAX].join(", "), files.len() - MAX)
}

fn unmerged_files(path: &Path) -> Vec<String> {
    git(path, &["diff", "--name-only", "--diff-filter=U"])
        .unwrap_or_default()
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

fn merge_in_progress(path: &Path) -> bool {
    git(path, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
}

fn pull_outcome(
    path: &Path,
    branch: &str,
    head: &CurrentBranch,
    before: Option<String>,
) -> Outcome {
    let after = tip(path, branch);
    if before.is_some() && before == after {
        return Outcome::Skipped(format!("{branch} is already up to date"));
    }

    let commits = match before.as_deref() {
        Some(from) => commit_count(path, from, branch),
        None => None,
    };
    let summary = match commits {
        Some(1) => format!("Pulled 1 commit into {branch}"),
        Some(count) => format!("Pulled {count} commits into {branch}"),
        None => format!("Updated {branch}"),
    };

    if !head.detached && head.name == branch {
        Outcome::Ok(summary)
    } else {
        Outcome::Ok(format!(
            "{summary} while staying on {}",
            if head.detached {
                "detached HEAD"
            } else {
                head.name.as_str()
            }
        ))
    }
}

fn tip(path: &Path, rev: &str) -> Option<String> {
    git(path, &["rev-parse", "--verify", "--quiet", rev])
        .ok()
        .map(|sha| sha.trim().to_string())
        .filter(|sha| !sha.is_empty())
}

fn commit_count(path: &Path, from: &str, to: &str) -> Option<u32> {
    let range = format!("{from}..{to}");
    git(path, &["rev-list", "--count", &range])
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .filter(|count| *count > 0)
}

pub fn push_repo(path: &Path) -> Outcome {
    if let Err(error) = require_repo(path) {
        return Outcome::Failed(error);
    }

    let head = match current_branch(path) {
        Ok(current) => current,
        Err(error) => return Outcome::Failed(error),
    };
    if !head.has_commits {
        return Outcome::Skipped("No commits to push".into());
    }
    if head.detached {
        return Outcome::Skipped("Detached HEAD".into());
    }

    let upstream = git(
        path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

    match origin_url(path) {
        Some(url) if !is_github_url(&url) => {
            return Outcome::Skipped("Remote is not GitHub".into());
        }
        Some(_) => {}
        None => {
            return publish_repo(
                path,
                &PublishOptions {
                    name: github_name_from_folder(&dir_name(path)),
                    description: String::new(),
                    visibility: "private".into(),
                    homepage: String::new(),
                },
            );
        }
    }

    match upstream {
        Some(upstream) => {
            let (ahead, _) = ahead_behind(path);
            if ahead == 0 {
                return Outcome::Skipped(format!("Nothing to push to {upstream}"));
            }
            match git(path, &["push"]) {
                Ok(_) => Outcome::Ok(format!("Pushed {ahead} commit(s) to {upstream}")),
                Err(error) => Outcome::Failed(error),
            }
        }
        None => match git(path, &["push", "-u", "origin", "HEAD"]) {
            Ok(_) => Outcome::Ok(format!("Pushed {} and set upstream", head.name)),
            Err(error) => Outcome::Failed(error),
        },
    }
}

pub fn publish_repo(path: &Path, options: &PublishOptions) -> Outcome {
    if let Err(error) = require_repo(path) {
        return Outcome::Failed(error);
    }
    if origin_url(path).is_some() {
        return Outcome::Failed("This repository already has an origin remote".into());
    }

    let head = match current_branch(path) {
        Ok(current) => current,
        Err(error) => return Outcome::Failed(error),
    };
    if !head.has_commits {
        return Outcome::Failed("Commit something before publishing".into());
    }
    if head.detached {
        return Outcome::Failed("Detached HEAD".into());
    }

    let name = options.name.trim();
    if let Err(error) = validate_repo_name(name) {
        return Outcome::Failed(error);
    }
    let visibility = match options.visibility.trim() {
        "public" => "public",
        "private" => "private",
        "internal" => "internal",
        _ => return Outcome::Failed("Visibility must be public, private, or internal".into()),
    };
    let description = options.description.trim();
    if description.chars().count() > 350 {
        return Outcome::Failed("Description must be 350 characters or fewer".into());
    }
    let homepage = options.homepage.trim();
    if !homepage.is_empty() && !is_http_url(homepage) {
        return Outcome::Failed("Homepage must be an http or https URL".into());
    }

    let source = path.to_string_lossy().into_owned();
    let mut args = vec![
        "repo".to_string(),
        "create".to_string(),
        name.to_string(),
        "--source".to_string(),
        source,
        "--remote".to_string(),
        "origin".to_string(),
        "--push".to_string(),
        format!("--{visibility}"),
    ];
    if !description.is_empty() {
        args.push("--description".into());
        args.push(description.to_string());
    }
    if !homepage.is_empty() {
        args.push("--homepage".into());
        args.push(homepage.to_string());
    }

    match run_gh(path, &args) {
        Ok(()) => Outcome::Ok(format!(
            "Created {visibility} GitHub repo {name} and pushed {}",
            head.name
        )),
        Err(error) => Outcome::Failed(error),
    }
}

fn github_name_from_folder(name: &str) -> String {
    let mut cleaned = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        let mapped = if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' {
            ch
        } else if ch == '-' || ch.is_whitespace() {
            '-'
        } else {
            continue;
        };
        if mapped == '-' {
            if cleaned.is_empty() || prev_dash {
                continue;
            }
            prev_dash = true;
            cleaned.push('-');
        } else {
            if cleaned.is_empty() && (mapped == '.' || mapped == '_') {
                continue;
            }
            prev_dash = false;
            cleaned.push(mapped);
        }
        if cleaned.len() >= 100 {
            break;
        }
    }
    let cleaned = cleaned
        .trim_matches(|ch| ch == '-' || ch == '.' || ch == '_')
        .to_string();
    if cleaned.is_empty() {
        "repository".into()
    } else {
        cleaned
    }
}

fn validate_repo_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 100 {
        return Err("Repository name must be 1–100 characters.".into());
    }
    let parts: Vec<&str> = name.split('/').collect();
    if parts.len() > 2 || parts.iter().any(|part| part.is_empty()) {
        return Err("Repository name must be a name or owner/name.".into());
    }
    for part in parts {
        let ok = part
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
            && !part.starts_with('.')
            && !part.ends_with('.')
            && part != "."
            && part != "..";
        if !ok {
            return Err(
                "Repository name can only contain letters, numbers, dots, hyphens, and underscores."
                    .into(),
            );
        }
    }
    Ok(())
}

fn is_http_url(value: &str) -> bool {
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    match rest {
        Some(rest) => !rest.is_empty() && !rest.contains(char::is_whitespace),
        None => false,
    }
}

fn run_gh(path: &Path, args: &[String]) -> Result<(), String> {
    let program = gh_executable().ok_or_else(|| {
        "GitHub CLI (gh) was not found. Install it from https://cli.github.com and try again."
            .to_string()
    })?;
    let mut command = Command::new(&program);
    command
        .args(args)
        .current_dir(path)
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    match command.output() {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(gh_failure(&output)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(format!("GitHub CLI was not found at {}", program.display()))
        }
        Err(error) => Err(format!("Failed to start GitHub CLI: {error}")),
    }
}

fn gh_executable() -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    // ce-git keeps the PATH from when it started. GitHub CLI is often installed
    // after that, so also search the user and machine PATH stored in the registry.
    #[cfg(windows)]
    {
        dirs.extend(registry_path_dirs());
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("GitHub CLI"));
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
            dirs.push(PathBuf::from(program_files).join("GitHub CLI"));
        }
    }
    find_gh_in(dirs)
}

fn find_gh_in(dirs: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    const NAMES: &[&str] = if cfg!(windows) {
        &["gh.exe", "gh.cmd", "gh.bat"]
    } else {
        &["gh"]
    };
    for dir in dirs {
        for name in NAMES {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn registry_path_dirs() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let sources = [
        (HKEY_CURRENT_USER, "Environment"),
        (
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
    ];
    let mut dirs = Vec::new();
    for (hive, subkey) in sources {
        let Ok(key) = RegKey::predef(hive).open_subkey(subkey) else {
            continue;
        };
        let Ok(value) = key.get_value::<String, _>("Path") else {
            continue;
        };
        dirs.extend(std::env::split_paths(&expand_percent_env(&value)));
    }
    dirs
}

fn expand_percent_env(value: &str) -> String {
    let mut expanded = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        expanded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if name.is_empty() {
                expanded.push('%');
            } else if let Some(replacement) = std::env::var_os(name) {
                expanded.push_str(&replacement.to_string_lossy());
            } else {
                expanded.push('%');
                expanded.push_str(name);
                expanded.push('%');
            }
            rest = &after[end + 1..];
        } else {
            expanded.push('%');
            expanded.push_str(after);
            break;
        }
    }
    expanded.push_str(rest);
    expanded
}

fn gh_failure(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        "GitHub CLI could not create the repository".to_string()
    } else {
        detail.lines().next().unwrap_or(detail).to_string()
    }
}

fn require_repo(path: &Path) -> Result<(), String> {
    if super::discover::is_repository(path) {
        Ok(())
    } else {
        Err(format!("{} is not a git repository", dir_name(path)))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{find_gh_in, gh_executable};

    #[test]
    fn find_gh_in_prefers_an_executable_in_the_given_directories() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-gh-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(if cfg!(windows) { "gh.exe" } else { "gh" });
        fs::write(&exe, b"").unwrap();

        let found = find_gh_in([dir.clone()]);
        assert_eq!(found.as_deref(), Some(exe.as_path()));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolves_github_cli_installed_outside_the_process_path() {
        let default = std::path::PathBuf::from(r"C:\Program Files\GitHub CLI\gh.exe");
        if !default.is_file() {
            return;
        }
        let found = gh_executable();
        assert!(
            found.is_some(),
            "gh.exe is installed but ce-git could not resolve it"
        );
    }
}

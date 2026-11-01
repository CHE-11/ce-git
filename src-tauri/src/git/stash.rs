use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use super::changes::checked_relative;
use super::command::git;
use super::diff::{UI_DIFF_LIMIT, ensure_repo, truncate_text};

const PULL_STASH_MARK: &str = "ce-git pull";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub id: String,
    pub message: String,
    pub committed_at: i64,
    pub pull: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPatch {
    pub id: String,
    pub message: String,
    pub patch: String,
    pub truncated: bool,
}

pub fn list_stashes(repo: &Path) -> Result<Vec<StashEntry>, String> {
    ensure_repo(repo)?;
    let output = git(repo, &["stash", "list", "-z", "--format=%gd%x1f%gs%x1f%ct"])?;
    Ok(parse_stash_list(&output))
}

pub fn stash_paths(repo: &Path, paths: &[String], message: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let message = clean_message(message)?;
    if paths.is_empty() {
        return Err("Choose a file to stash.".into());
    }
    let mut seen = HashSet::new();
    let mut clean = Vec::new();
    for path in paths {
        let relative = checked_relative(repo, path)?;
        if seen.insert(relative.clone()) {
            clean.push(relative);
        }
    }
    let mut args = vec![
        "stash".to_string(),
        "push".to_string(),
        "--include-untracked".to_string(),
        "-m".to_string(),
        message,
        "--".to_string(),
    ];
    args.extend(clean);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git(repo, &refs)?;
    Ok(())
}

pub fn show_stash(repo: &Path, id: &str) -> Result<StashPatch, String> {
    ensure_repo(repo)?;
    let id = stash_id(id)?;
    let message = stash_message(repo, &id)?;
    let patch = match git(
        repo,
        &[
            "stash",
            "show",
            "-p",
            "--include-untracked",
            "--no-color",
            "--no-ext-diff",
            &id,
        ],
    ) {
        Ok(patch) => patch,
        Err(error) if include_untracked_unsupported(&error) => git(
            repo,
            &["stash", "show", "-p", "--no-color", "--no-ext-diff", &id],
        )?,
        Err(error) => return Err(error),
    };
    let (patch, truncated) = truncate_text(&patch, UI_DIFF_LIMIT);
    Ok(StashPatch {
        id,
        message,
        patch,
        truncated,
    })
}

pub fn apply_stash(repo: &Path, id: &str, pop: bool) -> Result<(), String> {
    ensure_repo(repo)?;
    let id = require_user_stash(repo, id)?;
    let action = if pop { "pop" } else { "apply" };
    git(repo, &["stash", action, &id])?;
    Ok(())
}

pub fn drop_stash(repo: &Path, id: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let id = require_user_stash(repo, id)?;
    git(repo, &["stash", "drop", &id])?;
    Ok(())
}

fn require_user_stash(repo: &Path, id: &str) -> Result<String, String> {
    let id = stash_id(id)?;
    let entries = list_stashes(repo)?;
    match entries.iter().find(|entry| entry.id == id) {
        Some(entry) if entry.pull => Err("That stash belongs to a pull in progress.".into()),
        Some(_) => Ok(id),
        None => Err("Stash not found.".into()),
    }
}

fn stash_message(repo: &Path, id: &str) -> Result<String, String> {
    let entries = list_stashes(repo)?;
    entries
        .into_iter()
        .find(|entry| entry.id == id)
        .map(|entry| entry.message)
        .ok_or_else(|| "Stash not found.".to_string())
}

fn clean_message(message: &str) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Stash message is empty.".into());
    }
    if message.contains(PULL_STASH_MARK) {
        return Err("That message is reserved for an in-progress pull.".into());
    }
    if message.chars().any(|ch| ch == '\0' || ch == '\u{1f}') {
        return Err("Stash message cannot contain control characters.".into());
    }
    Ok(message.to_string())
}

fn stash_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    let Some(rest) = value.strip_prefix("stash@{") else {
        return Err("Not a stash.".into());
    };
    let Some(index) = rest.strip_suffix('}') else {
        return Err("Not a stash.".into());
    };
    if index.is_empty() || !index.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Not a stash.".into());
    }
    Ok(format!("stash@{{{index}}}"))
}

fn include_untracked_unsupported(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("include-untracked")
        && (error.contains("unknown")
            || error.contains("unrecognized")
            || error.contains("invalid option"))
}

fn parse_stash_list(output: &str) -> Vec<StashEntry> {
    let mut entries = Vec::new();
    for record in output.split('\0') {
        if record.is_empty() {
            continue;
        }
        let mut parts = record.split('\u{1f}');
        let id = parts.next().unwrap_or("").trim();
        let message = parts.next().unwrap_or("").trim().to_string();
        let stamp = parts.next().unwrap_or("").trim();
        if stash_id(id).is_err() {
            continue;
        }
        let committed_at = stamp.parse::<i64>().unwrap_or(0);
        entries.push(StashEntry {
            id: id.to_string(),
            message: message.clone(),
            committed_at,
            pull: message.contains(PULL_STASH_MARK),
        });
    }
    entries
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::command::git;
    use super::{apply_stash, drop_stash, list_stashes, parse_stash_list, show_stash, stash_paths};

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let result = git(dir, args);
        assert!(
            result.is_ok(),
            "git {args:?} in {} failed: {result:?}",
            dir.display()
        );
    }

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run_git(path, &["init", "-b", "main"]);
        run_git(path, &["config", "user.email", "ce-git@example.com"]);
        run_git(path, &["config", "user.name", "ce-git"]);
        run_git(path, &["config", "commit.gpgsign", "false"]);
        run_git(path, &["config", "core.autocrlf", "false"]);
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap().replace("\r\n", "\n")
    }

    #[test]
    fn parse_stash_list_reads_nul_records() {
        let output = "stash@{0}\u{1f}On main: notes\u{1f}1700000000\0stash@{1}\u{1f}On main: ce-git pull\u{1f}1690000000\0";
        let entries = parse_stash_list(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "stash@{0}");
        assert_eq!(entries[0].message, "On main: notes");
        assert_eq!(entries[0].committed_at, 1_700_000_000);
        assert!(!entries[0].pull);
        assert!(entries[1].pull);
    }

    #[test]
    fn stash_paths_round_trip_and_rejects_a_bad_id() {
        let root = scratch("stash");
        init_repo(&root);
        fs::write(root.join("old.txt"), "one\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("old.txt"), "two\n").unwrap();

        stash_paths(&root, &["old.txt".to_string()], "notes").unwrap();
        assert_eq!(read(&root.join("old.txt")), "one\n");

        let listed = list_stashes(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "stash@{0}");
        assert!(!listed[0].pull);
        assert!(listed[0].message.contains("notes"), "{}", listed[0].message);

        let patch = show_stash(&root, "stash@{0}").unwrap();
        assert!(patch.patch.contains("two"), "{}", patch.patch);
        assert!(!patch.truncated);

        apply_stash(&root, "stash@{0}", false).unwrap();
        assert_eq!(read(&root.join("old.txt")), "two\n");
        assert_eq!(list_stashes(&root).unwrap().len(), 1);

        drop_stash(&root, "stash@{0}").unwrap();
        assert!(list_stashes(&root).unwrap().is_empty());

        assert!(stash_paths(&root, &["old.txt".to_string()], "ce-git pull").is_err());
        assert!(show_stash(&root, "HEAD").is_err());
        assert!(show_stash(&root, "stash@{n}").is_err());
        assert!(apply_stash(&root, "stash@{0};drop", false).is_err());

        fs::write(root.join("old.txt"), "three\n").unwrap();
        run_git(
            &root,
            &[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                "ce-git pull",
                "--",
                "old.txt",
            ],
        );
        let pull = list_stashes(&root).unwrap();
        assert!(pull[0].pull, "{}", pull[0].message);
        assert!(apply_stash(&root, "stash@{0}", true).is_err());
        assert!(drop_stash(&root, "stash@{0}").is_err());

        let _ = fs::remove_dir_all(root);
    }
}

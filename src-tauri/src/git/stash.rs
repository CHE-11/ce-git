use std::collections::HashSet;
use std::fs;
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
    let mut entries = parse_stash_list(&output);
    // The message marks a stash a pull created. Lock it only while that merge is still open.
    // A leftover stash after the pull finished can be restored or dropped.
    if !merge_in_progress(repo) {
        for entry in &mut entries {
            entry.pull = false;
        }
    }
    Ok(entries)
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
    let entry = require_user_stash(repo, id)?;
    let action = if pop { "pop" } else { "apply" };
    git(repo, &["stash", action, &entry.id])?;
    if pop && entry.message.contains(PULL_STASH_MARK) {
        clear_pull_start(repo);
    }
    Ok(())
}

pub fn drop_stash(repo: &Path, id: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let entry = require_user_stash(repo, id)?;
    git(repo, &["stash", "drop", &entry.id])?;
    if entry.message.contains(PULL_STASH_MARK) {
        clear_pull_start(repo);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFileView {
    pub path: String,
    pub remote_ref: String,
    pub on_remote: bool,
    pub remote_text: String,
    pub remote_missing: bool,
    pub remote_truncated: bool,
    pub remote_binary: bool,
    pub stash_text: String,
    pub stash_missing: bool,
    pub stash_truncated: bool,
    pub stash_binary: bool,
}

pub fn stash_files(repo: &Path, id: &str) -> Result<Vec<StashFile>, String> {
    ensure_repo(repo)?;
    let id = require_listed_stash(repo, id)?;
    files_in_stash(repo, &id)
}

pub fn stash_file_sides(repo: &Path, id: &str, path: &str) -> Result<StashFileView, String> {
    ensure_repo(repo)?;
    let id = require_listed_stash(repo, id)?;
    let path = checked_relative(repo, path)?;
    let files = files_in_stash(repo, &id)?;
    let previous = files
        .into_iter()
        .find(|file| file.path == path)
        .and_then(|file| file.previous_path);
    let base = compare_base(repo)?;
    let remote = read_blob(repo, &base.rev, &path, previous.as_deref());
    let stash = read_stash_blob(repo, &id, &path);
    Ok(StashFileView {
        path,
        remote_ref: base.label,
        on_remote: base.on_remote,
        remote_text: remote.text,
        remote_missing: remote.missing,
        remote_truncated: remote.truncated,
        remote_binary: remote.binary,
        stash_text: stash.text,
        stash_missing: stash.missing,
        stash_truncated: stash.truncated,
        stash_binary: stash.binary,
    })
}

pub fn keep_stash_file(repo: &Path, id: &str, path: &str, source: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let entry = require_user_stash(repo, id)?;
    let path = checked_relative(repo, path)?;
    let files = files_in_stash(repo, &entry.id)?;
    let previous = files
        .iter()
        .find(|file| file.path == path)
        .and_then(|file| file.previous_path.clone());
    match source {
        "remote" => {
            let base = compare_base(repo)?;
            if blob_exists(repo, &format!("{}:{path}", base.rev)) {
                restore_worktree(repo, &base.rev, &path)
            } else if let Some(previous) = previous.as_deref() {
                if blob_exists(repo, &format!("{}:{previous}", base.rev)) {
                    restore_worktree(repo, &base.rev, previous)?;
                }
                remove_worktree_file(repo, &path)
            } else {
                remove_worktree_file(repo, &path)
            }
        }
        "stash" => {
            if blob_exists(repo, &format!("{}:{path}", entry.id)) {
                restore_worktree(repo, &entry.id, &path)?;
            } else if let Some(parent) = untracked_parent(repo, &entry.id) {
                if blob_exists(repo, &format!("{parent}:{path}")) {
                    restore_worktree(repo, &parent, &path)?;
                } else {
                    remove_worktree_file(repo, &path)?;
                }
            } else {
                remove_worktree_file(repo, &path)?;
            }
            if let Some(previous) = previous.as_deref() {
                if !blob_exists(repo, &format!("{}:{previous}", entry.id)) {
                    remove_worktree_file(repo, previous)?;
                }
            }
            Ok(())
        }
        _ => Err("Choose the remote or stashed copy.".into()),
    }
}

fn require_listed_stash(repo: &Path, id: &str) -> Result<String, String> {
    let id = stash_id(id)?;
    let entries = list_stashes(repo)?;
    if entries.iter().any(|entry| entry.id == id) {
        Ok(id)
    } else {
        Err("Stash not found.".into())
    }
}

struct CompareBase {
    rev: String,
    label: String,
    on_remote: bool,
}

fn compare_base(repo: &Path) -> Result<CompareBase, String> {
    if let Ok(upstream) = git(
        repo,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    ) {
        let label = upstream.trim().to_string();
        if !label.is_empty() && label != "@{upstream}" {
            return Ok(CompareBase {
                rev: label.clone(),
                label,
                on_remote: true,
            });
        }
    }
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let label = branch.trim().to_string();
    Ok(CompareBase {
        rev: "HEAD".to_string(),
        label: if label.is_empty() {
            "HEAD".to_string()
        } else {
            label
        },
        on_remote: false,
    })
}

fn files_in_stash(repo: &Path, id: &str) -> Result<Vec<StashFile>, String> {
    let base = compare_base(repo)?;
    let mut files = parse_name_status(&git(
        repo,
        &["diff", "-z", "--name-status", "-M", &base.rev, id],
    )?);
    let mut seen: HashSet<String> = files.iter().map(|file| file.path.clone()).collect();
    if let Some(parent) = untracked_parent(repo, id) {
        let extra = parse_name_status(&git(
            repo,
            &["diff", "-z", "--name-status", "-M", &base.rev, &parent],
        )?);
        for mut file in extra {
            if seen.insert(file.path.clone()) {
                file.status = "untracked".to_string();
                file.previous_path = None;
                files.push(file);
            }
        }
    }
    Ok(files)
}

fn parse_name_status(output: &str) -> Vec<StashFile> {
    let mut files = Vec::new();
    let mut tokens = output.split('\0').filter(|token| !token.is_empty());
    while let Some(status) = tokens.next() {
        let code = status.chars().next().unwrap_or('M');
        if code == 'R' || code == 'C' {
            let previous = tokens.next().unwrap_or("").to_string();
            let path = tokens.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            files.push(StashFile {
                path,
                previous_path: if previous.is_empty() {
                    None
                } else {
                    Some(previous)
                },
                status: if code == 'C' { "copied" } else { "renamed" }.to_string(),
            });
            continue;
        }
        let path = tokens.next().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        files.push(StashFile {
            path,
            previous_path: None,
            status: match code {
                'A' => "added",
                'D' => "deleted",
                'T' => "typechange",
                'U' => "unmerged",
                _ => "modified",
            }
            .to_string(),
        });
    }
    files
}

struct BlobText {
    text: String,
    missing: bool,
    truncated: bool,
    binary: bool,
}

fn read_blob(repo: &Path, rev: &str, path: &str, previous: Option<&str>) -> BlobText {
    if let Some(text) = cat_blob(repo, &format!("{rev}:{path}")) {
        return text;
    }
    if let Some(previous) = previous {
        if let Some(text) = cat_blob(repo, &format!("{rev}:{previous}")) {
            return text;
        }
    }
    BlobText {
        text: String::new(),
        missing: true,
        truncated: false,
        binary: false,
    }
}

fn read_stash_blob(repo: &Path, id: &str, path: &str) -> BlobText {
    if let Some(text) = cat_blob(repo, &format!("{id}:{path}")) {
        return text;
    }
    if let Some(parent) = untracked_parent(repo, id) {
        if let Some(text) = cat_blob(repo, &format!("{parent}:{path}")) {
            return text;
        }
    }
    BlobText {
        text: String::new(),
        missing: true,
        truncated: false,
        binary: false,
    }
}

fn cat_blob(repo: &Path, spec: &str) -> Option<BlobText> {
    let text = git(repo, &["cat-file", "-p", spec]).ok()?;
    if text.contains('\0') {
        return Some(BlobText {
            text: String::new(),
            missing: false,
            truncated: false,
            binary: true,
        });
    }
    let (text, truncated) = truncate_text(&text, UI_DIFF_LIMIT);
    Some(BlobText {
        text,
        missing: false,
        truncated,
        binary: false,
    })
}

fn blob_exists(repo: &Path, spec: &str) -> bool {
    git(repo, &["cat-file", "-e", spec]).is_ok()
}

fn untracked_parent(repo: &Path, id: &str) -> Option<String> {
    let spec = format!("{id}^3");
    git(repo, &["rev-parse", "-q", "--verify", &spec])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn restore_worktree(repo: &Path, source: &str, path: &str) -> Result<(), String> {
    git(
        repo,
        &["restore", "--source", source, "--worktree", "--", path],
    )?;
    Ok(())
}

fn remove_worktree_file(repo: &Path, path: &str) -> Result<(), String> {
    let full = super::changes::contained_path(repo, path)?;
    if full.is_file() {
        fs::remove_file(&full)
            .map_err(|error| format!("Could not remove {}: {error}", full.display()))?;
    }
    Ok(())
}

fn require_user_stash(repo: &Path, id: &str) -> Result<StashEntry, String> {
    let id = stash_id(id)?;
    let entries = list_stashes(repo)?;
    match entries.into_iter().find(|entry| entry.id == id) {
        Some(entry) if entry.pull => Err("That stash belongs to a pull in progress.".into()),
        Some(entry) => Ok(entry),
        None => Err("Stash not found.".into()),
    }
}

fn merge_in_progress(repo: &Path) -> bool {
    git(repo, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
}

fn clear_pull_start(repo: &Path) {
    let _ = git(repo, &["update-ref", "-d", "refs/ce-git/pull-start"]);
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
    use super::{
        apply_stash, drop_stash, keep_stash_file, list_stashes, parse_stash_list, show_stash,
        stash_file_sides, stash_files, stash_paths,
    };

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
        assert!(!pull[0].pull, "{}", pull[0].message);
        drop_stash(&root, "stash@{0}").unwrap();
        assert!(list_stashes(&root).unwrap().is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pull_stash_stays_locked_only_while_a_merge_is_open() {
        let root = scratch("stash-merge");
        init_repo(&root);
        fs::write(root.join("old.txt"), "one\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);
        run_git(&root, &["checkout", "-b", "side"]);
        fs::write(root.join("old.txt"), "side\n").unwrap();
        run_git(&root, &["commit", "-am", "side"]);
        run_git(&root, &["checkout", "main"]);
        fs::write(root.join("old.txt"), "main\n").unwrap();
        run_git(&root, &["commit", "-am", "main"]);
        fs::write(root.join("notes.txt"), "keep\n").unwrap();
        run_git(&root, &["add", "notes.txt"]);
        run_git(
            &root,
            &["stash", "push", "-m", "ce-git pull", "--", "notes.txt"],
        );

        let before = list_stashes(&root).unwrap();
        assert!(!before[0].pull, "{}", before[0].message);

        assert!(git(&root, &["merge", "side"]).is_err());
        let during = list_stashes(&root).unwrap();
        assert!(during.iter().any(|entry| entry.pull), "{during:?}");
        assert!(drop_stash(&root, &during[0].id).is_err());

        run_git(&root, &["merge", "--abort"]);
        let after = list_stashes(&root).unwrap();
        assert!(after.iter().all(|entry| !entry.pull));
        drop_stash(&root, &after[0].id).unwrap();

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stash_file_sides_and_keep_one_side() {
        let root = scratch("stash-file");
        init_repo(&root);
        fs::write(root.join("old.txt"), "one\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("old.txt"), "two\n").unwrap();
        run_git(&root, &["stash", "push", "-m", "notes", "--", "old.txt"]);

        let files = stash_files(&root, "stash@{0}").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "old.txt");
        assert_eq!(files[0].status, "modified");

        let sides = stash_file_sides(&root, "stash@{0}", "old.txt").unwrap();
        assert!(!sides.on_remote);
        assert_eq!(sides.remote_ref, "main");
        assert!(sides.remote_text.contains("one"), "{}", sides.remote_text);
        assert!(sides.stash_text.contains("two"), "{}", sides.stash_text);
        assert!(!sides.remote_missing);
        assert!(!sides.stash_missing);

        keep_stash_file(&root, "stash@{0}", "old.txt", "stash").unwrap();
        assert_eq!(read(&root.join("old.txt")), "two\n");
        assert_eq!(list_stashes(&root).unwrap().len(), 1);

        keep_stash_file(&root, "stash@{0}", "old.txt", "remote").unwrap();
        assert_eq!(read(&root.join("old.txt")), "one\n");
        assert_eq!(list_stashes(&root).unwrap().len(), 1);

        assert!(stash_files(&root, "stash@{n}").is_err());
        assert!(keep_stash_file(&root, "HEAD", "old.txt", "stash").is_err());

        let _ = fs::remove_dir_all(root);
    }
}

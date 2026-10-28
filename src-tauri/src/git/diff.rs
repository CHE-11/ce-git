use std::fs;
use std::path::Path;

use serde::Serialize;

use super::command::git;

pub const UI_DIFF_LIMIT: usize = 200_000;
pub const AI_DIFF_LIMIT: usize = 12_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDiff {
    pub files: Vec<FileChange>,
    pub patch: String,
    pub truncated: bool,
}

pub fn repo_diff(path: &Path) -> Result<RepoDiff, String> {
    ensure_repo(path)?;
    let (files, patch, truncated) = change_summary(path, UI_DIFF_LIMIT)?;
    Ok(RepoDiff {
        files,
        patch,
        truncated,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub hash: String,
    pub message: String,
    pub files: Vec<FileChange>,
    pub patch: String,
    pub truncated: bool,
}

pub fn commit_diff(path: &Path, hash: &str) -> Result<CommitDiff, String> {
    ensure_repo(path)?;
    let hash = hash.trim();
    if !is_commit_id(hash) {
        return Err("Not a commit hash".into());
    }
    let spec = format!("{hash}^{{commit}}");
    let hash = git(path, &["rev-parse", "--verify", "--quiet", &spec])
        .map_err(|_| format!("Commit {hash} not found"))?
        .trim()
        .to_string();
    let message = git(path, &["show", "-s", "--format=%B", &hash])?
        .trim_end()
        .to_string();
    let parents = git(path, &["rev-list", "--parents", "-n", "1", &hash])?;
    let first_parent = parents.split_whitespace().nth(1).map(str::to_string);

    let (names, patch) = match first_parent {
        Some(parent) => (
            git(
                path,
                &[
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "-M",
                    "--name-status",
                    "-z",
                    &parent,
                    &hash,
                ],
            )?,
            git(
                path,
                &["diff", "--no-color", "--no-ext-diff", "-M", &parent, &hash],
            )?,
        ),
        None => (
            git(
                path,
                &[
                    "show",
                    "--no-color",
                    "--no-ext-diff",
                    "--format=",
                    "-M",
                    "--name-status",
                    "-z",
                    &hash,
                ],
            )?,
            git(
                path,
                &[
                    "show",
                    "--no-color",
                    "--no-ext-diff",
                    "--format=",
                    "-M",
                    &hash,
                ],
            )?,
        ),
    };
    let (patch, truncated) = truncate_text(&patch, UI_DIFF_LIMIT);
    Ok(CommitDiff {
        hash,
        message,
        files: parse_name_status(&names),
        patch,
        truncated,
    })
}

fn is_commit_id(value: &str) -> bool {
    (4..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_name_status(output: &str) -> Vec<FileChange> {
    let mut tokens = output.split('\0').filter(|token| !token.is_empty());
    let mut files = Vec::new();
    while let Some(code) = tokens.next() {
        let code = code.trim();
        let Some(letter) = code.chars().next() else {
            continue;
        };
        let paired = letter == 'R' || letter == 'C';
        let previous_path = if paired {
            tokens.next().map(str::to_string)
        } else {
            None
        };
        let Some(path) = tokens.next() else {
            break;
        };
        let status = match letter {
            'A' => "added",
            'D' => "deleted",
            'R' => "renamed",
            'C' => "copied",
            'T' => "typechange",
            'U' => "unmerged",
            _ => "modified",
        };
        files.push(FileChange {
            path: path.to_string(),
            previous_path: previous_path.filter(|previous| !previous.is_empty()),
            status: status.to_string(),
            staged: false,
        });
    }
    files
}

pub fn collect_ai_context(path: &Path) -> Result<String, String> {
    ensure_repo(path)?;
    let (files, patch, _) = change_summary(path, AI_DIFF_LIMIT)?;
    if files.is_empty() {
        return Err("Nothing to commit".into());
    }
    if patch.trim().is_empty() {
        return Err("Nothing to commit".into());
    }
    Ok(patch)
}

fn change_summary(path: &Path, limit: usize) -> Result<(Vec<FileChange>, String, bool), String> {
    let porcelain = git(path, &["status", "--porcelain=v1", "-uall"])?;
    let files = parse_porcelain(&porcelain);
    let mut patch = working_diff(path);
    append_untracked(path, &porcelain, &mut patch);
    if patch.trim().is_empty() {
        patch = porcelain;
    }
    let (patch, truncated) = truncate_text(&patch, limit);
    Ok((files, patch, truncated))
}

fn working_diff(path: &Path) -> String {
    match git(path, &["diff", "HEAD"]) {
        Ok(diff) => diff,
        Err(_) => {
            let staged = git(path, &["diff", "--cached"]).unwrap_or_default();
            let unstaged = git(path, &["diff"]).unwrap_or_default();
            format!("{staged}{unstaged}")
        }
    }
}

fn append_untracked(repo: &Path, porcelain: &str, patch: &mut String) {
    for line in porcelain.lines() {
        if !line.starts_with("?? ") {
            continue;
        }
        let relative = unquote(&line[3..]);
        if relative.is_empty() {
            continue;
        }
        patch.push_str("\n\n# untracked ");
        patch.push_str(&relative);
        patch.push('\n');
        if let Some(preview) = preview_file(&repo.join(&relative)) {
            patch.push_str(&preview);
        }
    }
}

fn preview_file(path: &Path) -> Option<String> {
    if path.is_dir() {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) || bytes.len() > 64 * 1024 {
        return Some("[binary or large file omitted]\n".into());
    }
    let text = String::from_utf8_lossy(&bytes);
    let preview = text.lines().take(200).collect::<Vec<_>>().join("\n");
    Some(format!("{preview}\n"))
}

pub fn parse_porcelain(porcelain: &str) -> Vec<FileChange> {
    porcelain.lines().filter_map(parse_status_line).collect()
}

fn parse_status_line(line: &str) -> Option<FileChange> {
    if line.len() < 4 {
        return None;
    }
    let xy = &line[..2];
    let remainder = line[3..].trim();
    let renamed = xy.contains('R') || xy.contains('C');
    let (mut previous_path, path) = if renamed {
        match split_rename_pair(remainder) {
            Some((previous, next)) => (Some(unquote(previous)), unquote(next)),
            None => (None, unquote(remainder)),
        }
    } else {
        (None, unquote(remainder))
    };
    if previous_path.as_deref().is_some_and(str::is_empty) {
        previous_path = None;
    }
    if path.is_empty() {
        return None;
    }

    let staged = !xy.starts_with(' ') && !xy.starts_with('?');
    Some(FileChange {
        path,
        previous_path,
        status: change_kind(xy).to_string(),
        staged,
    })
}

fn split_rename_pair(remainder: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    let mut escaped = false;
    for (index, ch) in remainder.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quoted && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
            continue;
        }
        if !quoted && remainder[index..].starts_with(" -> ") {
            let previous = remainder[..index].trim();
            let next = remainder[index + 4..].trim();
            if !previous.is_empty() && !next.is_empty() {
                return Some((previous, next));
            }
        }
    }
    None
}

fn change_kind(xy: &str) -> &'static str {
    if xy == "??" {
        return "untracked";
    }
    let code = xy
        .chars()
        .find(|char| *char != ' ' && *char != '?')
        .unwrap_or('M');
    match code {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'U' => "unmerged",
        'T' => "typechange",
        _ => "modified",
    }
}

fn unquote(path: &str) -> String {
    let path = path.trim();
    if path.len() >= 2 && path.starts_with('"') && path.ends_with('"') {
        path[1..path.len() - 1].replace("\\\"", "\"")
    } else {
        path.to_string()
    }
}

pub fn truncate_text(value: &str, limit: usize) -> (String, bool) {
    if value.chars().count() <= limit {
        return (value.to_string(), false);
    }
    let truncated: String = value.chars().take(limit).collect();
    (format!("{truncated}\n\n[diff truncated]"), true)
}

pub fn ensure_repo(path: &Path) -> Result<(), String> {
    if super::discover::is_repository(path) {
        Ok(())
    } else {
        Err("Not a git repository".into())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::command::git;
    use super::{commit_diff, parse_name_status, parse_porcelain};

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run(dir: &Path, args: &[&str]) -> String {
        let result = git(dir, args);
        assert!(
            result.is_ok(),
            "git {args:?} in {} failed: {result:?}",
            dir.display()
        );
        result.unwrap()
    }

    fn init_repo(path: &Path) {
        run(path, &["init", "-b", "main"]);
        run(path, &["config", "user.email", "ce-git@example.com"]);
        run(path, &["config", "user.name", "ce-git"]);
        run(path, &["config", "core.autocrlf", "false"]);
    }

    fn head(path: &Path) -> String {
        run(path, &["rev-parse", "HEAD"]).trim().to_string()
    }

    #[test]
    fn name_status_reads_renames_and_plain_records() {
        let files =
            parse_name_status("M\0src/a.ts\0R087\0old name.ts\0new name.ts\0A\0b.ts\0D\0c.ts\0");
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].path, "src/a.ts");
        assert_eq!(files[1].status, "renamed");
        assert_eq!(files[1].path, "new name.ts");
        assert_eq!(files[1].previous_path.as_deref(), Some("old name.ts"));
        assert_eq!(files[2].status, "added");
        assert_eq!(files[3].status, "deleted");
        assert!(parse_name_status("").is_empty());
    }

    #[test]
    fn commit_diff_covers_root_modify_rename_and_merge() {
        let root = scratch("commit-diff");
        init_repo(&root);
        fs::write(root.join("README.md"), "one\n").unwrap();
        fs::write(root.join("notes.txt"), "alpha\nbeta\ngamma\ndelta\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial", "-m", "Body line."]);
        let initial = head(&root);

        let first = commit_diff(&root, &initial).unwrap();
        assert_eq!(first.hash, initial);
        assert!(first.message.starts_with("initial"), "{}", first.message);
        assert!(first.message.contains("Body line."), "{}", first.message);
        assert_eq!(first.files.len(), 2);
        assert!(first.files.iter().all(|file| file.status == "added"));
        assert!(first.patch.contains("+one"), "{}", first.patch);

        fs::write(root.join("README.md"), "two\n").unwrap();
        run(&root, &["commit", "-am", "edit"]);
        let edit = commit_diff(&root, &head(&root)).unwrap();
        assert_eq!(edit.files.len(), 1);
        assert_eq!(edit.files[0].path, "README.md");
        assert_eq!(edit.files[0].status, "modified");
        assert!(
            edit.patch.contains("-one") && edit.patch.contains("+two"),
            "{}",
            edit.patch
        );

        run(&root, &["mv", "notes.txt", "moved.txt"]);
        run(&root, &["commit", "-m", "rename"]);
        let rename = commit_diff(&root, &head(&root)).unwrap();
        assert_eq!(rename.files.len(), 1);
        assert_eq!(rename.files[0].status, "renamed");
        assert_eq!(rename.files[0].path, "moved.txt");
        assert_eq!(rename.files[0].previous_path.as_deref(), Some("notes.txt"));

        run(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("feature.txt"), "feature\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "feature work"]);
        run(&root, &["checkout", "main"]);
        fs::write(root.join("main.txt"), "main\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "main work"]);
        run(
            &root,
            &[
                "merge",
                "--no-ff",
                "--no-edit",
                "-m",
                "merge feature",
                "feature",
            ],
        );
        let merge = commit_diff(&root, &head(&root)).unwrap();
        assert_eq!(merge.files.len(), 1, "{:?}", merge.files);
        assert_eq!(merge.files[0].path, "feature.txt");
        assert_eq!(merge.files[0].status, "added");

        let short = commit_diff(&root, &initial[..7]).unwrap();
        assert_eq!(short.hash, initial);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn commit_diff_rejects_options_and_unknown_hashes() {
        let root = scratch("commit-diff-bad");
        init_repo(&root);
        fs::write(root.join("README.md"), "one\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);

        assert!(commit_diff(&root, "--output=x").is_err());
        assert!(commit_diff(&root, "HEAD").is_err());
        assert!(commit_diff(&root, "").is_err());
        assert!(commit_diff(&root, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef").is_err());
        assert!(!root.join("x").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn porcelain_keeps_rename_source() {
        let files = parse_porcelain(
            " M src/lib/tree.ts\n?? new.ts\nR  docs/old.ts -> docs/new.ts\nRM \"docs/my old.ts\" -> \"docs/my new.ts\"\n",
        );
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].path, "src/lib/tree.ts");
        assert_eq!(files[0].status, "modified");
        assert!(files[0].previous_path.is_none());
        assert!(!files[0].staged);

        assert_eq!(files[1].path, "new.ts");
        assert_eq!(files[1].status, "untracked");
        assert!(files[1].previous_path.is_none());

        assert_eq!(files[2].path, "docs/new.ts");
        assert_eq!(files[2].previous_path.as_deref(), Some("docs/old.ts"));
        assert_eq!(files[2].status, "renamed");
        assert!(files[2].staged);

        assert_eq!(files[3].path, "docs/my new.ts");
        assert_eq!(files[3].previous_path.as_deref(), Some("docs/my old.ts"));
        assert_eq!(files[3].status, "renamed");
    }

    #[test]
    fn porcelain_does_not_split_arrows_in_ordinary_paths() {
        let files = parse_porcelain(" M \"notes/a -> b.md\"\n");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "notes/a -> b.md");
        assert!(files[0].previous_path.is_none());
    }
}

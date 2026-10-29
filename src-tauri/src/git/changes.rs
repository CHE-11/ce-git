use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::command::git;
use super::diff::{ensure_repo, parse_porcelain};

struct RelativePath {
    git: String,
    path: PathBuf,
}

pub fn contained_path(repo: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_repo(repo)?;
    let relative = safe_relative(relative)?;
    join_inside(repo, &relative)
}

pub fn discard_change(repo: &Path, relative: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let current = safe_relative(relative)?;
    let full = join_inside(repo, &current)?;
    if let Some(previous) = rename_source(repo, &current.git)? {
        let old = safe_relative(&previous)?;
        git(
            repo,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                &old.git,
            ],
        )?;
        git(
            repo,
            &["rm", "--cached", "--ignore-unmatch", "--", &current.git],
        )?;
        if full.is_file() {
            fs::remove_file(&full)
                .map_err(|error| format!("Could not delete {}: {error}", full.display()))?;
        }
        return Ok(());
    }

    if exists_in_head(repo, &current.git)? {
        git(
            repo,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                &current.git,
            ],
        )?;
        return Ok(());
    }

    // Untracked files are not in the index, so unstaging fails and the file is removed below.
    let _ = git(repo, &["restore", "--staged", "--", &current.git]);
    if full.is_dir() {
        return Err("Cannot discard a directory.".into());
    }
    if full.is_file() {
        fs::remove_file(&full)
            .map_err(|error| format!("Could not delete {}: {error}", full.display()))?;
    }
    Ok(())
}

/// Make the index and worktree match `hash`.
///
/// `paths` restores those files and leaves everything else alone. A file that
/// does not exist in the commit is removed. `None` matches the whole tracked
/// tree. The branch stays where it is, so the result shows up as changes.
pub fn restore_commit(repo: &Path, hash: &str, paths: Option<&[String]>) -> Result<(), String> {
    ensure_repo(repo)?;
    ensure_history_idle(repo)?;
    let hash = verified_commit(repo, hash)?;
    match paths {
        None => restore_tree(repo, &hash),
        Some(paths) if paths.is_empty() => Err("Choose a file to restore.".into()),
        Some(paths) => {
            let mut seen = HashSet::new();
            for path in paths {
                if seen.insert(path) {
                    restore_path(repo, &hash, path)?;
                }
            }
            Ok(())
        }
    }
}

/// Point the current branch at `hash` and make the index and worktree match it.
pub fn reset_to_commit(repo: &Path, hash: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    if git_path_exists(repo, "rebase-merge") || git_path_exists(repo, "rebase-apply") {
        return Err("Abort the rebase before moving the branch.".into());
    }
    let hash = verified_commit(repo, hash)?;
    git(repo, &["reset", "--hard", &hash])?;
    Ok(())
}

fn restore_tree(repo: &Path, hash: &str) -> Result<(), String> {
    let source = format!("--source={hash}");
    match git(
        repo,
        &["restore", &source, "--staged", "--worktree", "--", "."],
    ) {
        Ok(_) => {}
        Err(error)
            if error
                .to_ascii_lowercase()
                .contains("did not match any file") => {}
        Err(error) => return Err(error),
    }

    let target = tree_paths(repo, hash)?;
    let extra: Vec<String> = index_paths(repo)?
        .into_iter()
        .filter(|path| !target.contains(path))
        .collect();
    remove_tracked(repo, &extra)
}

fn restore_path(repo: &Path, hash: &str, path: &str) -> Result<(), String> {
    let relative = safe_relative(path)?;
    let _ = join_inside(repo, &relative)?;
    if blob_in_commit(repo, hash, &relative.git)? {
        let source = format!("--source={hash}");
        git(
            repo,
            &[
                "restore",
                &source,
                "--staged",
                "--worktree",
                "--",
                &relative.git,
            ],
        )?;
        return Ok(());
    }
    remove_tracked(repo, &[relative.git.clone()])?;
    let full = join_inside(repo, &relative)?;
    if full.is_file() {
        fs::remove_file(&full)
            .map_err(|error| format!("Could not delete {}: {error}", relative.git))?;
    } else if full.is_dir() {
        return Err(format!("{} is a folder.", relative.git));
    }
    Ok(())
}

fn blob_in_commit(repo: &Path, hash: &str, path: &str) -> Result<bool, String> {
    let spec = format!("{hash}:{path}");
    match git(repo, &["cat-file", "-t", &spec]) {
        Ok(kind) => {
            if kind.trim() == "blob" {
                Ok(true)
            } else {
                Err(format!("{path} is not a file in that commit."))
            }
        }
        Err(error) => {
            let lower = error.to_ascii_lowercase();
            if lower.contains("not in") || lower.contains("does not exist") {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

fn tree_paths(repo: &Path, hash: &str) -> Result<HashSet<String>, String> {
    Ok(
        split_z(&git(repo, &["ls-tree", "-r", "-z", "--name-only", hash])?)
            .into_iter()
            .collect(),
    )
}

fn index_paths(repo: &Path) -> Result<Vec<String>, String> {
    Ok(split_z(&git(repo, &["ls-files", "-z"])?))
}

fn remove_tracked(repo: &Path, paths: &[String]) -> Result<(), String> {
    for chunk in paths.chunks(40) {
        if chunk.is_empty() {
            continue;
        }
        let mut args = vec!["rm", "-f", "--ignore-unmatch", "--"];
        args.extend(chunk.iter().map(String::as_str));
        git(repo, &args)?;
    }
    Ok(())
}

fn split_z(output: &str) -> Vec<String> {
    output
        .split('\0')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn verified_commit(repo: &Path, hash: &str) -> Result<String, String> {
    let hash = hash.trim();
    if !(4..=64).contains(&hash.len()) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Not a commit hash".into());
    }
    let spec = format!("{hash}^{{commit}}");
    git(repo, &["rev-parse", "--verify", "--quiet", &spec])
        .map_err(|_| format!("Commit {hash} not found"))
        .map(|output| output.trim().to_string())
}

fn ensure_history_idle(repo: &Path) -> Result<(), String> {
    let merging = git(repo, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
        || git(repo, &["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"]).is_ok()
        || git(repo, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_ok()
        || git_path_exists(repo, "rebase-merge")
        || git_path_exists(repo, "rebase-apply");
    if merging {
        return Err(
            "Finish or abort the merge, rebase, cherry-pick, or revert before restoring files."
                .into(),
        );
    }
    Ok(())
}

fn git_path_exists(repo: &Path, name: &str) -> bool {
    let Ok(relative) = git(repo, &["rev-parse", "--git-path", name]) else {
        return false;
    };
    let relative = relative.trim();
    if relative.is_empty() {
        return false;
    }
    repo.join(relative).exists()
}

pub fn ignore_change(repo: &Path, kind: &str, target: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let pattern = match kind {
        "file" => {
            let relative = safe_relative(target)?;
            let _ = join_inside(repo, &relative)?;
            gitignore_escape(&relative.git)
        }
        "folder" => {
            let relative = safe_relative(target)?;
            let _ = join_inside(repo, &relative)?;
            format!("{}/", gitignore_escape(&relative.git))
        }
        "extension" => extension_pattern(target)?,
        _ => return Err("Unknown ignore action.".into()),
    };
    append_pattern(repo, &pattern)
}

fn rename_source(repo: &Path, relative: &str) -> Result<Option<String>, String> {
    // A path-limited status turns `R old -> new` into `A new`, which hides the source.
    let porcelain = git(repo, &["status", "--porcelain=v1", "-uall"])?;
    for change in parse_porcelain(&porcelain) {
        if change.path == relative {
            if change.previous_path.is_some() {
                return Ok(change.previous_path);
            }
        }
    }
    Ok(None)
}

fn exists_in_head(repo: &Path, relative: &str) -> Result<bool, String> {
    match git(
        repo,
        &["ls-tree", "-r", "--name-only", "HEAD", "--", relative],
    ) {
        Ok(output) => Ok(output.lines().any(|line| !line.trim().is_empty())),
        Err(error) => {
            let lower = error.to_ascii_lowercase();
            if lower.contains("not a valid object")
                || lower.contains("needed a single revision")
                || lower.contains("bad revision")
                || lower.contains("ambiguous argument")
            {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

fn append_pattern(repo: &Path, pattern: &str) -> Result<(), String> {
    if pattern.is_empty()
        || pattern
            .chars()
            .any(|ch| ch == '\n' || ch == '\r' || ch == '\0')
    {
        return Err("Invalid gitignore pattern.".into());
    }
    let ignore_path = repo.join(".gitignore");
    let existing = if ignore_path.is_file() {
        fs::read_to_string(&ignore_path)
            .map_err(|error| format!("Could not read .gitignore: {error}"))?
    } else if ignore_path.exists() {
        return Err(".gitignore is not a file.".into());
    } else {
        String::new()
    };
    if existing.lines().any(|line| line.trim() == pattern) {
        return Ok(());
    }
    let newline = if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push_str(newline);
    }
    next.push_str(pattern);
    next.push_str(newline);
    fs::write(&ignore_path, next).map_err(|error| format!("Could not write .gitignore: {error}"))
}

fn extension_pattern(extension: &str) -> Result<String, String> {
    let extension = extension.trim();
    let Some(rest) = extension.strip_prefix('.') else {
        return Err("That file has no extension to ignore.".into());
    };
    if rest.is_empty()
        || rest.len() > 32
        || !rest
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '+' | '.'))
    {
        return Err("That file extension cannot be ignored.".into());
    }
    Ok(format!("*.{rest}"))
}

fn gitignore_escape(path: &str) -> String {
    let mut escaped = String::with_capacity(path.len());
    for ch in path.chars() {
        if matches!(ch, ' ' | '#' | '!' | '*' | '?' | '[' | ']' | '\\') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn safe_relative(value: &str) -> Result<RelativePath, String> {
    let git = value.trim().replace('\\', "/");
    if git.is_empty()
        || git.starts_with('/')
        || git.starts_with('~')
        || git.chars().any(|ch| ch == '\0' || ch == ':')
        || git
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("That path is outside the repository.".into());
    }
    let lower = git.to_ascii_lowercase();
    if lower == ".git" || lower.starts_with(".git/") {
        return Err("That path is outside the repository.".into());
    }
    Ok(RelativePath {
        path: PathBuf::from(&git),
        git,
    })
}

fn join_inside(repo: &Path, relative: &RelativePath) -> Result<PathBuf, String> {
    let root = repo
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", repo.display()))?;
    let full = root.join(&relative.path);
    if !full.starts_with(&root) {
        return Err("That path is outside the repository.".into());
    }
    match full.canonicalize() {
        Ok(canonical) => {
            if canonical == root || !canonical.starts_with(&root) {
                return Err("That path is outside the repository.".into());
            }
            Ok(crate::files::display_path(&canonical))
        }
        Err(_) => Ok(crate::files::display_path(&full)),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::command::git;
    use super::{contained_path, discard_change, ignore_change, reset_to_commit, restore_commit};

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
        run_git(path, &["config", "core.autocrlf", "false"]);
    }

    fn normalized(path: &Path) -> String {
        fs::read_to_string(path).unwrap().replace("\r\n", "\n")
    }

    #[test]
    fn contained_path_stays_inside_the_repo() {
        let root = scratch("contain");
        fs::create_dir_all(root.join(".git")).unwrap();

        let path = contained_path(&root, "src/gone.ts").unwrap();
        assert!(path.ends_with("gone.ts"), "{}", path.display());
        assert!(contained_path(&root, "../gone.ts").is_err());
        assert!(contained_path(&root, "/etc/passwd").is_err());
        assert!(contained_path(&root, ".git/config").is_err());
        assert!(contained_path(&root, r"C:\Windows\notepad.exe").is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignore_change_appends_each_pattern_once() {
        let root = scratch("ignore");
        fs::create_dir_all(root.join(".git")).unwrap();

        ignore_change(&root, "file", "src/my lib/file.ts").unwrap();
        ignore_change(&root, "folder", "src/my lib").unwrap();
        ignore_change(&root, "extension", ".ts").unwrap();
        ignore_change(&root, "file", "src/my lib/file.ts").unwrap();

        assert_eq!(
            normalized(&root.join(".gitignore")),
            "src/my\\ lib/file.ts\nsrc/my\\ lib/\n*.ts\n"
        );
        assert!(ignore_change(&root, "extension", "ts").is_err());
        assert!(ignore_change(&root, "file", "src/../secret").is_err());
        assert!(ignore_change(&root, "other", "src/file.ts").is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discard_change_reverts_the_worktree() {
        let root = scratch("discard");
        init_repo(&root);
        fs::write(root.join("old.txt"), "one\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);

        fs::write(root.join("old.txt"), "two\n").unwrap();
        run_git(&root, &["add", "old.txt"]);
        discard_change(&root, "old.txt").unwrap();
        assert_eq!(normalized(&root.join("old.txt")), "one\n");

        fs::write(root.join("extra.txt"), "temp\n").unwrap();
        discard_change(&root, "extra.txt").unwrap();
        assert!(!root.join("extra.txt").exists());

        run_git(&root, &["mv", "old.txt", "new.txt"]);
        discard_change(&root, "new.txt").unwrap();
        assert_eq!(normalized(&root.join("old.txt")), "one\n");
        assert!(!root.join("new.txt").exists());
        let status = git(&root, &["status", "--porcelain"]).unwrap();
        assert!(status.trim().is_empty(), "{status}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_commit_puts_files_and_the_branch_back() {
        let root = scratch("restore-commit");
        init_repo(&root);
        fs::write(root.join("keep.txt"), "keep-1\n").unwrap();
        fs::write(root.join("gone.txt"), "gone-1\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "first"]);
        let first = git(&root, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();

        fs::write(root.join("keep.txt"), "keep-2\n").unwrap();
        fs::write(root.join("other.txt"), "other-2\n").unwrap();
        fs::write(root.join("added.txt"), "added\n").unwrap();
        fs::remove_file(root.join("gone.txt")).unwrap();
        run_git(&root, &["add", "-A"]);
        run_git(&root, &["commit", "-m", "second"]);
        let second = git(&root, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();

        fs::write(root.join("keep.txt"), "dirty-keep\n").unwrap();
        fs::write(root.join("other.txt"), "dirty-other\n").unwrap();

        assert!(restore_commit(&root, "not a hash", None).is_err());
        assert!(restore_commit(&root, &first, Some(&["../outside.txt".into()])).is_err());

        restore_commit(&root, &first[..7], Some(&["keep.txt".into()])).unwrap();
        assert_eq!(normalized(&root.join("keep.txt")), "keep-1\n");
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");
        assert!(root.join("added.txt").is_file());
        assert!(!root.join("gone.txt").exists());

        restore_commit(&root, &first, Some(&["gone.txt".into()])).unwrap();
        assert_eq!(normalized(&root.join("gone.txt")), "gone-1\n");
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");

        restore_commit(&root, &first, Some(&["added.txt".into()])).unwrap();
        assert!(!root.join("added.txt").exists());
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");
        assert_eq!(git(&root, &["rev-parse", "HEAD"]).unwrap().trim(), second);

        restore_commit(&root, &first, None).unwrap();
        assert_eq!(normalized(&root.join("keep.txt")), "keep-1\n");
        assert_eq!(normalized(&root.join("gone.txt")), "gone-1\n");
        assert!(!root.join("added.txt").exists());
        assert!(!root.join("other.txt").exists());
        assert_eq!(git(&root, &["rev-parse", "HEAD"]).unwrap().trim(), second);

        fs::write(root.join("scratch.txt"), "note\n").unwrap();
        restore_commit(&root, &first, None).unwrap();
        assert_eq!(normalized(&root.join("scratch.txt")), "note\n");

        fs::write(root.join("keep.txt"), "dirty-again\n").unwrap();
        reset_to_commit(&root, &first).unwrap();
        assert_eq!(git(&root, &["rev-parse", "HEAD"]).unwrap().trim(), first);
        assert_eq!(normalized(&root.join("keep.txt")), "keep-1\n");
        assert_eq!(normalized(&root.join("gone.txt")), "gone-1\n");
        assert_eq!(normalized(&root.join("scratch.txt")), "note\n");
        let status = git(&root, &["status", "--porcelain"]).unwrap();
        assert_eq!(status.trim(), "?? scratch.txt");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_commit_refuses_an_in_progress_merge() {
        let root = scratch("restore-merge");
        init_repo(&root);
        fs::write(root.join("a.txt"), "base\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "base"]);
        let base = git(&root, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();

        run_git(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("a.txt"), "feature\n").unwrap();
        run_git(&root, &["commit", "-am", "feature"]);
        run_git(&root, &["checkout", "main"]);
        fs::write(root.join("a.txt"), "main\n").unwrap();
        run_git(&root, &["commit", "-am", "main"]);

        assert!(git(&root, &["merge", "feature"]).is_err());
        assert!(restore_commit(&root, &base, None).is_err());
        assert!(git(&root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok());

        reset_to_commit(&root, &base).unwrap();
        assert!(git(&root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
        assert_eq!(normalized(&root.join("a.txt")), "base\n");

        let _ = fs::remove_dir_all(root);
    }
}

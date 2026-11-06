use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::command::{git, git_stdout};
use super::diff::{ensure_repo, parse_porcelain};

/// Well-known hash of an empty tree. A root commit is diffed against it.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

struct RelativePath {
    git: String,
    path: PathBuf,
}

pub fn contained_path(repo: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_repo(repo)?;
    let relative = safe_relative(relative)?;
    join_inside(repo, &relative)
}

/// Repo-relative git path after the same containment checks as [`contained_path`].
pub fn checked_relative(repo: &Path, value: &str) -> Result<String, String> {
    ensure_repo(repo)?;
    let relative = safe_relative(value)?;
    let _ = join_inside(repo, &relative)?;
    Ok(relative.git)
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

/// Undo the changes `hash` introduced and leave the result unstaged.
///
/// The branch stays where it is, so the undone changes show up in the working
/// tree. `paths` undoes those files and leaves every other file alone. `None`
/// undoes the whole commit. Lines changed again since that commit can make the
/// undo fail; the worktree is left as it was.
pub fn restore_commit(repo: &Path, hash: &str, paths: Option<&[String]>) -> Result<(), String> {
    ensure_repo(repo)?;
    ensure_history_idle(repo)?;
    let hash = verified_commit(repo, hash)?;
    let parents = parent_hashes(repo, &hash)?;
    match paths {
        None => undo_commit(repo, &hash, &parents),
        Some(paths) if paths.is_empty() => Err("Choose a file to restore.".into()),
        Some(paths) => undo_paths(repo, &hash, &parents, paths),
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

struct CommitTouch {
    path: String,
    previous: Option<String>,
}

struct WorktreeBackup {
    relative: String,
    bytes: Option<Vec<u8>>,
}

fn undo_commit(repo: &Path, hash: &str, parents: &[String]) -> Result<(), String> {
    if parents.is_empty() {
        let touched = name_status_paths(repo, None, hash)?;
        let patch = commit_patch(repo, None, hash, None)?;
        return apply_reverse(repo, &patch, &touched);
    }

    let mut args = vec!["revert", "--no-commit", "--no-edit"];
    if parents.len() > 1 {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    if let Err(error) = git(repo, &args) {
        abort_revert(repo);
        return Err(undo_error(error));
    }

    let changed = cached_paths(repo)?;
    if changed.is_empty() {
        end_revert(repo);
        return Err("That commit's changes are already gone.".into());
    }
    let unstaged = unstage(repo, &changed);
    end_revert(repo);
    unstaged
}

fn undo_paths(
    repo: &Path,
    hash: &str,
    parents: &[String],
    requested: &[String],
) -> Result<(), String> {
    let parent = parents.first().map(String::as_str);
    let touches = name_status(repo, parent, hash)?;
    let touched = affected_paths(repo, &touches, requested)?;
    let patch = commit_patch(repo, parent, hash, Some(&touched))?;
    apply_reverse(repo, &patch, &touched)
}

fn affected_paths(
    repo: &Path,
    touches: &[CommitTouch],
    requested: &[String],
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut touched = Vec::new();
    for path in requested {
        let relative = safe_relative(path)?;
        let _ = join_inside(repo, &relative)?;
        let mut hit = false;
        for change in touches {
            let matches = change.path == relative.git
                || change.previous.as_deref() == Some(relative.git.as_str());
            if !matches {
                continue;
            }
            hit = true;
            for side in [&change.path].into_iter().chain(change.previous.as_ref()) {
                if seen.insert(side.clone()) {
                    touched.push(side.clone());
                }
            }
        }
        if !hit {
            return Err(format!("{} was not changed in that commit.", relative.git));
        }
    }
    Ok(touched)
}

fn parent_hashes(repo: &Path, hash: &str) -> Result<Vec<String>, String> {
    let line = git(repo, &["rev-list", "--parents", "-n", "1", hash])?;
    Ok(line
        .split_whitespace()
        .skip(1)
        .map(str::to_string)
        .collect())
}

fn name_status(repo: &Path, parent: Option<&str>, hash: &str) -> Result<Vec<CommitTouch>, String> {
    let output = if let Some(parent) = parent {
        git(repo, &["diff", "--name-status", "-z", "-M", parent, hash])?
    } else {
        git(
            repo,
            &["diff", "--name-status", "-z", "-M", EMPTY_TREE, hash],
        )?
    };
    Ok(parse_name_status_z(&output))
}

fn name_status_paths(repo: &Path, parent: Option<&str>, hash: &str) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    for touch in name_status(repo, parent, hash)? {
        paths.push(touch.path);
        if let Some(previous) = touch.previous {
            paths.push(previous);
        }
    }
    Ok(paths)
}

fn parse_name_status_z(output: &str) -> Vec<CommitTouch> {
    let mut tokens = output.split('\0').filter(|token| !token.is_empty());
    let mut touches = Vec::new();
    while let Some(code) = tokens.next() {
        let Some(letter) = code.chars().next() else {
            continue;
        };
        let paired = letter == 'R' || letter == 'C';
        let previous = if paired {
            tokens.next().map(str::to_string)
        } else {
            None
        };
        let Some(path) = tokens.next() else {
            break;
        };
        if path.is_empty() {
            continue;
        }
        touches.push(CommitTouch {
            path: path.to_string(),
            previous: previous.filter(|previous| !previous.is_empty()),
        });
    }
    touches
}

fn cached_paths(repo: &Path) -> Result<Vec<String>, String> {
    let output = git(repo, &["diff", "--name-status", "-z", "-M", "--cached"])?;
    let mut paths = Vec::new();
    for touch in parse_name_status_z(&output) {
        paths.push(touch.path);
        if let Some(previous) = touch.previous {
            paths.push(previous);
        }
    }
    Ok(paths)
}

fn commit_patch(
    repo: &Path,
    parent: Option<&str>,
    hash: &str,
    paths: Option<&[String]>,
) -> Result<Vec<u8>, String> {
    let from = parent.unwrap_or(EMPTY_TREE);
    let mut args = vec![
        "diff",
        "--full-index",
        "--binary",
        "--no-color",
        "--no-ext-diff",
        "-M",
        from,
        hash,
    ];
    if let Some(paths) = paths {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    let patch = git_stdout(repo, &args)?;
    if patch.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Err("That commit's changes are already gone.".into());
    }
    Ok(patch)
}

fn apply_reverse(repo: &Path, patch: &[u8], touched: &[String]) -> Result<(), String> {
    if touched.is_empty() {
        return Err("That commit didn't change any files.".into());
    }
    let patch_path = write_patch(patch)?;
    let patch_arg = patch_path.to_string_lossy().into_owned();
    let check = git(
        repo,
        &[
            "apply",
            "--reverse",
            "--check",
            "--whitespace=nowarn",
            &patch_arg,
        ],
    );
    let backups = snapshot(repo, touched);
    let result = if check.is_ok() {
        let applied = git(
            repo,
            &["apply", "--reverse", "--whitespace=nowarn", &patch_arg],
        );
        if applied.is_err() {
            restore_worktree(repo, &backups);
        }
        applied.map(|_| ()).map_err(undo_error)
    } else {
        let before = git(repo, &["status", "--porcelain=v1"]).unwrap_or_default();
        match git(
            repo,
            &[
                "apply",
                "--reverse",
                "--3way",
                "--whitespace=nowarn",
                &patch_arg,
            ],
        ) {
            Ok(_) if !index_conflicts(repo) => unstage(repo, touched).map_err(undo_error),
            Ok(_) => {
                rollback_apply(repo, touched, &backups, &before);
                Err("Those changes don't apply cleanly on top of the current files.".into())
            }
            Err(error) => {
                rollback_apply(repo, touched, &backups, &before);
                Err(undo_error(error))
            }
        }
    };
    let _ = fs::remove_file(&patch_path);
    result
}

fn write_patch(patch: &[u8]) -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("ce-git-restore-{nanos}.patch"));
    fs::write(&path, patch).map_err(|error| format!("Could not write the patch: {error}"))?;
    Ok(path)
}

fn snapshot(repo: &Path, paths: &[String]) -> Vec<WorktreeBackup> {
    paths
        .iter()
        .map(|relative| WorktreeBackup {
            relative: relative.clone(),
            bytes: fs::read(repo.join(relative)).ok(),
        })
        .collect()
}

fn rollback_apply(repo: &Path, paths: &[String], backups: &[WorktreeBackup], before: &str) {
    let after = git(repo, &["status", "--porcelain=v1"]).unwrap_or_default();
    if after == before {
        return;
    }
    let _ = git_with_paths(repo, &["reset", "-q"], paths);
    let _ = git_with_paths(
        repo,
        &["restore", "--source=HEAD", "--staged", "--worktree"],
        paths,
    );
    restore_worktree(repo, backups);
}

fn restore_worktree(repo: &Path, backups: &[WorktreeBackup]) {
    for backup in backups {
        let full = repo.join(&backup.relative);
        match &backup.bytes {
            Some(bytes) => {
                if let Some(parent) = full.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&full, bytes);
            }
            None => {
                if full.is_file() {
                    let _ = fs::remove_file(&full);
                }
            }
        }
    }
}

fn index_conflicts(repo: &Path) -> bool {
    let Ok(porcelain) = git(repo, &["status", "--porcelain=v1"]) else {
        return false;
    };
    porcelain.lines().any(|line| {
        let mut chars = line.chars();
        let first = chars.next();
        let second = chars.next();
        matches!(
            (first, second),
            (Some('U'), _) | (_, Some('U')) | (Some('A'), Some('A')) | (Some('D'), Some('D'))
        )
    })
}

fn unstage(repo: &Path, paths: &[String]) -> Result<(), String> {
    git_with_paths(repo, &["restore", "--staged"], paths)
}

fn git_with_paths(repo: &Path, prefix: &[&str], paths: &[String]) -> Result<(), String> {
    for chunk in paths.chunks(40) {
        if chunk.is_empty() {
            continue;
        }
        let mut args = prefix.to_vec();
        args.push("--");
        args.extend(chunk.iter().map(String::as_str));
        match git(repo, &args) {
            Ok(_) => {}
            Err(error)
                if error
                    .to_ascii_lowercase()
                    .contains("did not match any file") => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn end_revert(repo: &Path) {
    if git(repo, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_ok()
        || git_path_exists(repo, "sequencer")
    {
        let _ = git(repo, &["revert", "--quit"]);
    }
}

fn abort_revert(repo: &Path) {
    let _ = git(repo, &["revert", "--abort"]);
}

fn undo_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("would be overwritten")
        || lower.contains("local changes")
        || lower.contains("please commit or stash")
    {
        return "Commit or stash your changes before undoing that commit.".into();
    }
    if lower.contains("conflict")
        || lower.contains("could not revert")
        || lower.contains("patch does not apply")
        || lower.contains("patch failed")
        || lower.contains("does not apply")
        || lower.contains("with conflicts")
    {
        return "Those changes don't apply cleanly on top of the current files.".into();
    }
    if lower.contains("empty commit") || lower.contains("nothing to commit") {
        return "That commit's changes are already gone.".into();
    }
    error
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

    fn head_of(path: &Path) -> String {
        git(path, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string()
    }

    fn porcelain(path: &Path) -> String {
        git(path, &["status", "--porcelain"]).unwrap()
    }

    #[test]
    fn restore_commit_puts_that_commits_changes_back_in_the_worktree() {
        let root = scratch("restore-commit");
        init_repo(&root);
        fs::write(root.join("keep.txt"), "keep-1\n").unwrap();
        fs::write(root.join("gone.txt"), "gone-1\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "first"]);

        fs::write(root.join("keep.txt"), "keep-2\n").unwrap();
        fs::write(root.join("other.txt"), "other-2\n").unwrap();
        fs::write(root.join("added.txt"), "added\n").unwrap();
        fs::remove_file(root.join("gone.txt")).unwrap();
        run_git(&root, &["add", "-A"]);
        run_git(&root, &["commit", "-m", "second"]);
        let second = head_of(&root);

        fs::write(root.join("keep.txt"), "keep-3\n").unwrap();
        run_git(&root, &["commit", "-am", "third"]);
        let third = head_of(&root);

        assert!(restore_commit(&root, "not a hash", None).is_err());
        assert!(restore_commit(&root, &second, Some(&["../outside.txt".into()])).is_err());
        assert!(restore_commit(&root, &second, Some(&["missing.txt".into()])).is_err());

        let blocked = restore_commit(&root, &second, Some(&["keep.txt".into()]));
        assert!(blocked.is_err(), "{blocked:?}");
        assert_eq!(normalized(&root.join("keep.txt")), "keep-3\n");
        assert_eq!(normalized(&root.join("other.txt")), "other-2\n");
        assert_eq!(porcelain(&root).trim(), "");
        assert!(git(&root, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_err());

        fs::write(root.join("keep.txt"), "dirty-keep\n").unwrap();
        let blocked = restore_commit(&root, &third, None);
        assert!(blocked.is_err(), "{blocked:?}");
        assert_eq!(normalized(&root.join("keep.txt")), "dirty-keep\n");
        run_git(&root, &["checkout", "--", "keep.txt"]);

        restore_commit(&root, &third[..7], Some(&["keep.txt".into()])).unwrap();
        assert_eq!(normalized(&root.join("keep.txt")), "keep-2\n");
        assert_eq!(normalized(&root.join("other.txt")), "other-2\n");
        assert!(root.join("added.txt").is_file());
        assert!(!root.join("gone.txt").exists());
        assert_eq!(head_of(&root), third);
        let status = porcelain(&root);
        assert!(status.contains("keep.txt"), "{status}");
        assert!(!status.contains("other.txt"), "{status}");
        assert!(git(&root, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_err());

        run_git(&root, &["checkout", "--", "."]);
        fs::write(root.join("other.txt"), "dirty-other\n").unwrap();
        restore_commit(&root, &second, Some(&["added.txt".into()])).unwrap();
        assert!(!root.join("added.txt").exists());
        assert_eq!(normalized(&root.join("keep.txt")), "keep-3\n");
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");
        assert_eq!(head_of(&root), third);

        restore_commit(&root, &second, Some(&["gone.txt".into()])).unwrap();
        assert_eq!(normalized(&root.join("gone.txt")), "gone-1\n");
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");
        assert_eq!(head_of(&root), third);

        run_git(&root, &["clean", "-fd"]);
        run_git(&root, &["reset", "--hard", &third]);
        fs::write(root.join("other.txt"), "dirty-other\n").unwrap();
        restore_commit(&root, &third, None).unwrap();
        assert_eq!(normalized(&root.join("keep.txt")), "keep-2\n");
        assert_eq!(normalized(&root.join("other.txt")), "dirty-other\n");
        assert!(root.join("added.txt").is_file());
        assert!(!root.join("gone.txt").exists());
        assert_eq!(head_of(&root), third);
        assert!(git(&root, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_err());

        run_git(&root, &["clean", "-fd"]);
        run_git(&root, &["reset", "--hard", &second]);
        fs::write(root.join("scratch.txt"), "note\n").unwrap();
        restore_commit(&root, &second, None).unwrap();
        assert_eq!(normalized(&root.join("keep.txt")), "keep-1\n");
        assert_eq!(normalized(&root.join("gone.txt")), "gone-1\n");
        assert!(!root.join("added.txt").exists());
        assert!(!root.join("other.txt").exists());
        assert_eq!(normalized(&root.join("scratch.txt")), "note\n");
        assert_eq!(head_of(&root), second);
        assert!(
            porcelain(&root).contains("scratch.txt"),
            "{}",
            porcelain(&root)
        );
        assert!(git(&root, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_commit_undoes_a_rename_without_moving_the_branch() {
        let root = scratch("restore-rename");
        init_repo(&root);
        fs::write(root.join("old.txt"), "hello\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "first"]);
        run_git(&root, &["mv", "old.txt", "new.txt"]);
        run_git(&root, &["commit", "-m", "rename"]);
        let rename = head_of(&root);

        restore_commit(&root, &rename, Some(&["new.txt".into()])).unwrap();
        assert_eq!(normalized(&root.join("old.txt")), "hello\n");
        assert!(!root.join("new.txt").exists());
        assert_eq!(head_of(&root), rename);
        assert!(!porcelain(&root).trim().is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reset_to_commit_moves_the_branch() {
        let root = scratch("reset-commit");
        init_repo(&root);
        fs::write(root.join("keep.txt"), "keep-1\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "first"]);
        let first = head_of(&root);
        fs::write(root.join("keep.txt"), "keep-2\n").unwrap();
        run_git(&root, &["commit", "-am", "second"]);
        fs::write(root.join("scratch.txt"), "note\n").unwrap();

        reset_to_commit(&root, &first).unwrap();
        assert_eq!(head_of(&root), first);
        assert_eq!(normalized(&root.join("keep.txt")), "keep-1\n");
        assert_eq!(normalized(&root.join("scratch.txt")), "note\n");
        assert_eq!(porcelain(&root).trim(), "?? scratch.txt");

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

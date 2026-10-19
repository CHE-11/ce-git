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
    use super::{contained_path, discard_change, ignore_change};

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
}

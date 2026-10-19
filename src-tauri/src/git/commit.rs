use std::path::Path;

use super::command::git;
use super::diff::ensure_repo;
use super::status::is_dirty;

pub fn commit_repo(path: &Path, message: &str) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Commit message is empty".into());
    }
    ensure_repo(path)?;
    if !is_dirty(path)? {
        return Err("Nothing to commit".into());
    }

    git(path, &["add", "-A"])?;
    match message.split_once("\n\n") {
        Some((subject, body)) if !body.trim().is_empty() => {
            git(path, &["commit", "-m", subject.trim(), "-m", body.trim()])?;
        }
        _ => {
            git(path, &["commit", "-m", message])?;
        }
    }
    Ok(())
}

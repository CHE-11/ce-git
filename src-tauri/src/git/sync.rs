use std::path::Path;

use super::command::{dir_name, git};
use super::status::{ahead_behind, current_branch, is_dirty, resolve_default_branch};

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Ok(String),
    Skipped(String),
    Failed(String),
}

pub fn pull_default(path: &Path) -> Outcome {
    if let Err(error) = require_repo(path) {
        return Outcome::Failed(error);
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

    // A checked-out branch cannot be updated with a refspec fetch, so pull it in place.
    // Any other branch is fast-forwarded without switching the working tree.
    let result = if !head.detached && head.name == branch {
        git(path, &["pull", "--ff-only", "origin", &branch])
    } else {
        let spec = format!("{branch}:{branch}");
        git(path, &["fetch", "origin", &spec])
    };

    match result {
        Ok(_) if !head.detached && head.name == branch => Outcome::Ok(format!("Updated {branch}")),
        Ok(_) => Outcome::Ok(format!(
            "Updated {branch} while staying on {}",
            if head.detached {
                "detached HEAD"
            } else {
                head.name.as_str()
            }
        )),
        Err(error) => Outcome::Failed(error),
    }
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

fn require_repo(path: &Path) -> Result<(), String> {
    if path.join(".git").exists() {
        Ok(())
    } else {
        Err(format!("{} is not a git repository", dir_name(path)))
    }
}

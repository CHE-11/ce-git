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
    let mut path = unquote(line[3..].trim());
    if let Some((_, new_path)) = path.split_once(" -> ") {
        path = unquote(new_path.trim());
    }
    if path.is_empty() {
        return None;
    }

    let staged = !xy.starts_with(' ') && !xy.starts_with('?');
    Some(FileChange {
        path,
        status: change_kind(xy).to_string(),
        staged,
    })
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
    if path.join(".git").exists() {
        Ok(())
    } else {
        Err("Not a git repository".into())
    }
}

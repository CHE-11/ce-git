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
    if path.join(".git").exists() {
        Ok(())
    } else {
        Err("Not a git repository".into())
    }
}

#[cfg(test)]
mod tests {
    use super::parse_porcelain;

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

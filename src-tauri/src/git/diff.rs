use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use super::command::git;

pub const UI_DIFF_LIMIT: usize = 200_000;
pub const AI_DIFF_LIMIT: usize = 24_000;

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
    let porcelain = git(path, &["status", "--porcelain=v1", "-uall"])?;
    let files = parse_porcelain(&porcelain);
    if files.is_empty() {
        return Err("Nothing to commit".into());
    }
    let sections = split_diff_sections(&working_diff(path));
    let counts = parse_numstat(&working_numstat(path));
    let excerpts = build_excerpts(path, &files, &sections);
    let context = assemble_ai_context(&files, &counts, &excerpts, AI_DIFF_LIMIT);
    if context.trim().is_empty() {
        return Err("Nothing to commit".into());
    }
    Ok(context)
}

struct AiExcerpt {
    heading: String,
    body: String,
}

fn working_numstat(path: &Path) -> String {
    match git(path, &["diff", "--numstat", "HEAD"]) {
        Ok(stat) => stat,
        Err(_) => {
            let staged = git(path, &["diff", "--numstat", "--cached"]).unwrap_or_default();
            let unstaged = git(path, &["diff", "--numstat"]).unwrap_or_default();
            format!("{staged}{unstaged}")
        }
    }
}

fn parse_numstat(text: &str) -> HashMap<String, (Option<u32>, Option<u32>)> {
    let mut counts = HashMap::new();
    for line in text.lines() {
        let Some((path, added, deleted)) = parse_numstat_line(line) else {
            continue;
        };
        counts
            .entry(path)
            .and_modify(|current| *current = add_counts(*current, (added, deleted)))
            .or_insert((added, deleted));
    }
    counts
}

fn parse_numstat_line(line: &str) -> Option<(String, Option<u32>, Option<u32>)> {
    let mut parts = line.splitn(3, '\t');
    let added = parts.next()?;
    let deleted = parts.next()?;
    let path = numstat_destination(&unquote(parts.next()?.trim()));
    if path.is_empty() {
        return None;
    }
    Some((path, added.parse().ok(), deleted.parse().ok()))
}

fn numstat_destination(path: &str) -> String {
    if let Some(open) = path.find('{') {
        if let Some(close) = path[open..].find('}') {
            let close = open + close;
            let inner = &path[open + 1..close];
            if let Some((_, destination)) = inner.split_once(" => ") {
                return format!("{}{destination}{}", &path[..open], &path[close + 1..]);
            }
        }
    }
    path.split_once(" => ")
        .map(|(_, destination)| destination.to_string())
        .unwrap_or_else(|| path.to_string())
}

fn add_counts(
    current: (Option<u32>, Option<u32>),
    next: (Option<u32>, Option<u32>),
) -> (Option<u32>, Option<u32>) {
    match (current, next) {
        ((Some(left_added), Some(left_deleted)), (Some(right_added), Some(right_deleted))) => (
            Some(left_added.saturating_add(right_added)),
            Some(left_deleted.saturating_add(right_deleted)),
        ),
        _ => (None, None),
    }
}

fn counts_for(
    file: &FileChange,
    counts: &HashMap<String, (Option<u32>, Option<u32>)>,
) -> Option<(Option<u32>, Option<u32>)> {
    let primary = counts.get(&file.path).copied();
    let previous = file
        .previous_path
        .as_ref()
        .and_then(|path| counts.get(path).copied());
    match (primary, previous) {
        (Some(primary), Some(previous)) => Some(add_counts(primary, previous)),
        (Some(primary), None) => Some(primary),
        (None, Some(previous)) => Some(previous),
        (None, None) => None,
    }
}

fn split_diff_sections(patch: &str) -> Vec<(String, String)> {
    if patch.trim().is_empty() {
        return Vec::new();
    }
    let mut sections = Vec::new();
    let mut path = String::new();
    let mut body = String::new();
    let mut started = false;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            if started || !body.trim().is_empty() {
                sections.push((std::mem::take(&mut path), std::mem::take(&mut body)));
            }
            started = true;
            path = diff_destination(line.trim_end()).unwrap_or_default();
            body.push_str(line);
        } else {
            body.push_str(line);
        }
    }
    if started || !body.trim().is_empty() {
        sections.push((path, body));
    }
    sections
}

fn diff_destination(header: &str) -> Option<String> {
    let rest = header.strip_prefix("diff --git ")?;
    let (_, consumed) = next_diff_token(rest)?;
    let (destination, _) = next_diff_token(&rest[consumed..])?;
    let destination = destination.strip_prefix("b/").unwrap_or(&destination);
    if destination.is_empty() {
        None
    } else {
        Some(destination.to_string())
    }
}

fn next_diff_token(input: &str) -> Option<(String, usize)> {
    let offset = input.find(|ch: char| ch != ' ')?;
    let rest = &input[offset..];
    if rest.starts_with('"') {
        let (token, consumed) = quoted_diff_token(rest)?;
        return Some((token, offset + consumed));
    }
    let end = rest.find(' ').unwrap_or(rest.len());
    Some((rest[..end].to_string(), offset + end))
}

fn quoted_diff_token(input: &str) -> Option<(String, usize)> {
    let bytes = input.as_bytes();
    let mut token = String::new();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => {
                if index + 1 >= bytes.len() {
                    return None;
                }
                match bytes[index + 1] {
                    b'n' => token.push('\n'),
                    b't' => token.push('\t'),
                    b'\\' | b'"' => token.push(bytes[index + 1] as char),
                    other => token.push(other as char),
                }
                index += 2;
            }
            b'"' => return Some((token, index + 1)),
            _ => {
                let ch = input[index..].chars().next()?;
                token.push(ch);
                index += ch.len_utf8();
            }
        }
    }
    None
}

fn build_excerpts(
    repo: &Path,
    files: &[FileChange],
    sections: &[(String, String)],
) -> Vec<AiExcerpt> {
    let mut used = vec![false; sections.len()];
    let mut excerpts = Vec::new();
    for file in files {
        let mut body = String::new();
        for (index, (path, section)) in sections.iter().enumerate() {
            let matches = path == &file.path
                || file
                    .previous_path
                    .as_deref()
                    .is_some_and(|previous| previous == path);
            if used[index] || !matches {
                continue;
            }
            if !body.is_empty() && !body.ends_with('\n') {
                body.push('\n');
            }
            body.push_str(section);
            used[index] = true;
        }
        if file.status == "untracked" {
            if !body.is_empty() && !body.ends_with('\n') {
                body.push('\n');
            }
            body.push_str(&untracked_preview(repo, &file.path));
        }
        if body.trim().is_empty() {
            continue;
        }
        excerpts.push(AiExcerpt {
            heading: format!("### {}\n", file_label(file)),
            body,
        });
    }
    for (index, (path, section)) in sections.iter().enumerate() {
        if used[index] || section.trim().is_empty() {
            continue;
        }
        let heading = if path.is_empty() {
            "### diff\n".to_string()
        } else {
            format!("### {path}\n")
        };
        excerpts.push(AiExcerpt {
            heading,
            body: section.clone(),
        });
    }
    excerpts
}

fn untracked_preview(repo: &Path, relative: &str) -> String {
    let mut body = format!("# untracked {relative}\n");
    if let Some(preview) = preview_file(&repo.join(relative)) {
        body.push_str(&preview);
    }
    body
}

fn file_label(file: &FileChange) -> String {
    match &file.previous_path {
        Some(previous) => format!("{previous} -> {}", file.path),
        None => file.path.clone(),
    }
}

fn file_list_line(file: &FileChange, counts: Option<(Option<u32>, Option<u32>)>) -> String {
    let label = file_label(file);
    let mark = status_mark(&file.status);
    match counts {
        Some((Some(added), Some(deleted))) => format!("{mark} {label} (+{added} -{deleted})"),
        _ => format!("{mark} {label}"),
    }
}

fn status_mark(status: &str) -> &'static str {
    match status {
        "added" => "A",
        "deleted" => "D",
        "renamed" => "R",
        "copied" => "C",
        "untracked" => "??",
        "unmerged" => "U",
        "typechange" => "T",
        _ => "M",
    }
}

fn assemble_ai_context(
    files: &[FileChange],
    counts: &HashMap<String, (Option<u32>, Option<u32>)>,
    excerpts: &[AiExcerpt],
    limit: usize,
) -> String {
    let mut header = format!("Changed files ({}):\n", files.len());
    for file in files {
        header.push_str(&file_list_line(file, counts_for(file, counts)));
        header.push('\n');
    }
    if !excerpts.is_empty() {
        header.push_str("\nDiff excerpts (shortened where marked; the file list is complete):\n");
    }
    let budget = limit.saturating_sub(header.chars().count());
    let lengths: Vec<usize> = excerpts.iter().map(excerpt_chars).collect();
    let shares = allocate_budget(&lengths, budget);
    let mut out = header;
    for (excerpt, share) in excerpts.iter().zip(shares) {
        let text = render_excerpt(excerpt, share);
        if text.is_empty() {
            continue;
        }
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&text);
        if !text.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

fn excerpt_chars(excerpt: &AiExcerpt) -> usize {
    excerpt.heading.chars().count() + excerpt.body.chars().count()
}

fn render_excerpt(excerpt: &AiExcerpt, limit: usize) -> String {
    if limit == 0 {
        return String::new();
    }
    let total = excerpt_chars(excerpt);
    if total <= limit {
        return format!("{}{}", excerpt.heading, excerpt.body);
    }
    let content: String = excerpt
        .heading
        .chars()
        .chain(excerpt.body.chars())
        .take(limit)
        .collect();
    format!("{content}\n\n[diff truncated]")
}

fn allocate_budget(lengths: &[usize], budget: usize) -> Vec<usize> {
    let mut assigned = vec![0usize; lengths.len()];
    let mut active: Vec<usize> = (0..lengths.len())
        .filter(|&index| lengths[index] > 0)
        .collect();
    let mut remaining = budget;
    let mut guard = lengths.len().saturating_add(1);
    while !active.is_empty() && remaining > 0 && guard > 0 {
        guard -= 1;
        let share = remaining / active.len();
        let mut extra = remaining % active.len();
        if share == 0 && extra == 0 {
            break;
        }
        let mut next = Vec::new();
        let mut consumed = 0usize;
        for index in active.iter().copied() {
            let mut add = share;
            if extra > 0 {
                add += 1;
                extra -= 1;
            }
            let room = lengths[index].saturating_sub(assigned[index]);
            let give = add.min(room);
            assigned[index] += give;
            consumed += give;
            if assigned[index] < lengths[index] {
                next.push(index);
            }
        }
        if consumed == 0 {
            break;
        }
        remaining -= consumed;
        active = next;
    }
    assigned
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

    #[test]
    fn budget_gives_unused_share_to_a_cut_excerpt() {
        let shares = super::allocate_budget(&[100_000, 20], 1_000);
        assert_eq!(shares, vec![980, 20]);
    }

    #[test]
    fn splits_diff_sections_by_file() {
        let patch = "diff --git a/a.txt b/a.txt\n+aaa\ndiff --git \"a/z file.txt\" \"b/z file.txt\"\n+ZEBRA\n";
        let sections = super::split_diff_sections(patch);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].0, "a.txt");
        assert!(sections[0].1.contains("+aaa"));
        assert_eq!(sections[1].0, "z file.txt");
        assert!(sections[1].1.contains("+ZEBRA"));
    }

    #[test]
    fn ai_context_includes_every_file_when_the_first_diff_exceeds_the_limit() {
        let root = scratch("ai-context-fair");
        init_repo(&root);
        fs::write(root.join("a.txt"), "seed\n").unwrap();
        fs::write(root.join("z.txt"), "seed\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);

        let huge = "A".repeat(super::AI_DIFF_LIMIT + 8_000);
        fs::write(root.join("a.txt"), huge).unwrap();
        fs::write(root.join("z.txt"), "seed\nZEBRA_MARKER\n").unwrap();

        let context = super::collect_ai_context(&root).unwrap();
        assert!(context.contains("Changed files (2):"), "{context}");
        assert!(context.contains("M a.txt"), "{context}");
        assert!(context.contains("M z.txt (+1 -0)"), "{context}");
        assert!(context.contains("ZEBRA_MARKER"), "{context}");
        assert!(context.contains("[diff truncated]"), "{context}");
        let marker = context.find("[diff truncated]").expect("truncation mark");
        let zebra = context.find("ZEBRA_MARKER").expect("later file");
        assert!(
            marker < zebra,
            "the later file should survive after the first file is cut\n{context}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ai_context_keeps_a_short_diff_intact() {
        let root = scratch("ai-context-short");
        init_repo(&root);
        fs::write(root.join("README.md"), "one\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("README.md"), "one\ntwo\n").unwrap();

        let context = super::collect_ai_context(&root).unwrap();
        assert!(context.contains("Changed files (1):"), "{context}");
        assert!(context.contains("M README.md (+1 -0)"), "{context}");
        assert!(context.contains("+two"), "{context}");
        assert!(!context.contains("[diff truncated]"), "{context}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ai_context_includes_untracked_files() {
        let root = scratch("ai-context-untracked");
        init_repo(&root);
        fs::write(root.join("README.md"), "one\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("notes.md"), "UNTRACKED_NOTE\n").unwrap();

        let context = super::collect_ai_context(&root).unwrap();
        assert!(context.contains("?? notes.md"), "{context}");
        assert!(context.contains("UNTRACKED_NOTE"), "{context}");
        assert!(!context.contains("[diff truncated]"), "{context}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ai_context_rejects_a_clean_repo() {
        let root = scratch("ai-context-clean");
        init_repo(&root);
        fs::write(root.join("README.md"), "one\n").unwrap();
        run(&root, &["add", "."]);
        run(&root, &["commit", "-m", "initial"]);

        let error = super::collect_ai_context(&root).unwrap_err();
        assert!(error.contains("Nothing to commit"), "{error}");

        let _ = fs::remove_dir_all(root);
    }
}

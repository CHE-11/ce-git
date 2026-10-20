use std::path::Path;

use serde::Serialize;

use super::command::{dir_name, git_output, GitOutput};

const MAX_MATCHES: usize = 200;
const MAX_TEXT: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSearchResult {
    pub path: String,
    pub name: String,
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
    pub error: Option<String>,
}

pub fn search_repos(
    paths: Vec<String>,
    query: String,
    match_case: bool,
    regex: bool,
    whole_word: bool,
    glob: String,
) -> Vec<RepoSearchResult> {
    if query.is_empty() {
        return paths
            .into_iter()
            .map(|path| {
                let name = dir_name(Path::new(&path));
                RepoSearchResult {
                    path,
                    name,
                    matches: Vec::new(),
                    truncated: false,
                    error: Some("Enter a search query.".into()),
                }
            })
            .collect();
    }

    std::thread::scope(|scope| {
        let mut results = Vec::with_capacity(paths.len());
        for chunk in paths.chunks(8) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|path| {
                    let path = path.clone();
                    let query = query.clone();
                    let glob = glob.clone();
                    scope.spawn(move || {
                        search_one(
                            Path::new(&path),
                            &query,
                            match_case,
                            regex,
                            whole_word,
                            &glob,
                        )
                    })
                })
                .collect();
            for handle in handles {
                if let Ok(result) = handle.join() {
                    results.push(result);
                }
            }
        }
        results
    })
}

fn search_one(
    path: &Path,
    query: &str,
    match_case: bool,
    regex: bool,
    whole_word: bool,
    glob: &str,
) -> RepoSearchResult {
    let path_string = path.to_string_lossy().into_owned();
    let name = dir_name(path);
    let mut args = vec![
        "-c",
        "core.quotepath=false",
        "grep",
        "-n",
        "-I",
        "--untracked",
        "--full-name",
    ];
    if regex {
        args.push("-E");
    } else {
        args.push("-F");
    }
    if !match_case {
        args.push("-i");
    }
    if whole_word {
        args.push("-w");
    }
    args.push("-e");
    args.push(query);
    args.push("--");
    let patterns: Vec<&str> = glob
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect();
    args.extend(patterns);

    match git_output(path, &args) {
        Err(error) => empty(path_string, name, Some(error)),
        Ok(output) => match output.status {
            Some(0) => {
                let (matches, truncated) = parse_grep(&output.stdout);
                RepoSearchResult {
                    path: path_string,
                    name,
                    matches,
                    truncated,
                    error: None,
                }
            }
            Some(1) => empty(path_string, name, None),
            _ => empty(path_string, name, Some(command_error(&output))),
        },
    }
}

fn empty(path: String, name: String, error: Option<String>) -> RepoSearchResult {
    RepoSearchResult {
        path,
        name,
        matches: Vec::new(),
        truncated: false,
        error,
    }
}

fn command_error(output: &GitOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    match output.status {
        Some(code) => format!("git grep failed: exit {code}"),
        None => "git grep failed".to_string(),
    }
}

fn parse_grep(stdout: &str) -> (Vec<SearchMatch>, bool) {
    let mut matches = Vec::new();
    let mut truncated = false;
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let Some(hit) = parse_grep_line(line) else {
            continue;
        };
        if matches.len() >= MAX_MATCHES {
            truncated = true;
            break;
        }
        matches.push(hit);
    }
    (matches, truncated)
}

fn parse_grep_line(line: &str) -> Option<SearchMatch> {
    let mut start = 0;
    while let Some(offset) = line[start..].find(':') {
        let colon = start + offset;
        let rest = &line[colon + 1..];
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && rest.as_bytes().get(digits) == Some(&b':') {
            let line_no = rest[..digits].parse().ok()?;
            let path = &line[..colon];
            if path.is_empty() {
                return None;
            }
            return Some(SearchMatch {
                path: path.to_string(),
                line: line_no,
                text: clip_text(&rest[digits + 1..]),
            });
        }
        start = colon + 1;
        if start >= line.len() {
            break;
        }
    }
    None
}

fn clip_text(text: &str) -> String {
    let trimmed = text.trim_end_matches(['\r', '\n']);
    if trimmed.chars().count() <= MAX_TEXT {
        return trimmed.to_string();
    }
    let clipped: String = trimmed.chars().take(MAX_TEXT).collect();
    format!("{clipped}…")
}

#[cfg(test)]
mod tests {
    use super::parse_grep_line;

    #[test]
    fn parses_a_grep_line() {
        let hit = parse_grep_line("src/main.rs:12:fn main() {").unwrap();
        assert_eq!(hit.path, "src/main.rs");
        assert_eq!(hit.line, 12);
        assert_eq!(hit.text, "fn main() {");
    }

    #[test]
    fn parses_a_path_that_contains_a_colon() {
        let hit = parse_grep_line("notes:draft.md:4:needle here").unwrap();
        assert_eq!(hit.path, "notes:draft.md");
        assert_eq!(hit.line, 4);
        assert_eq!(hit.text, "needle here");
    }
}

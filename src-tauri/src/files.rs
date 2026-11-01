use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

const SEARCH_MATCH_LIMIT: usize = 300;
const SEARCH_VISIT_LIMIT: usize = 50_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DirKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: DirKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSearch {
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

pub fn list_directory(repo: &Path, relative: &str) -> Result<Vec<DirEntry>, String> {
    let relative = normalize_relative(relative)?;
    let dir = directory_in_repo(repo, &relative)?;
    let read = fs::read_dir(&dir)
        .map_err(|error| format!("Could not read {}: {error}", display_path(&dir).display()))?;
    let mut entries = Vec::new();
    for item in read {
        let Ok(item) = item else {
            continue;
        };
        let name = item.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let relative_path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        entries.push(DirEntry {
            name,
            relative_path,
            kind: entry_kind(&item.path()),
        });
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn search_directory(repo: &Path, query: &str) -> Result<DirSearch, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Err("Enter a name to search for.".into());
    }
    if !repo.is_dir() {
        return Err(format!("Folder does not exist: {}", repo.display()));
    }
    let root = repo
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", repo.display()))?;
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(root.clone());
    let mut stack = vec![(root.clone(), String::new())];
    let mut visited = 0usize;

    while let Some((dir, relative)) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read {
            let Ok(item) = item else {
                continue;
            };
            visited += 1;
            if visited > SEARCH_VISIT_LIMIT {
                return Ok(finish_search(entries, true));
            }
            let name = item.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.eq_ignore_ascii_case(".git") {
                continue;
            }
            let path = item.path();
            let relative_path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let kind = entry_kind(&path);
            if name.to_lowercase().contains(&needle) {
                if entries.len() >= SEARCH_MATCH_LIMIT {
                    return Ok(finish_search(entries, true));
                }
                entries.push(DirEntry {
                    name: name.clone(),
                    relative_path: relative_path.clone(),
                    kind,
                });
            }
            if kind == DirKind::Folder && descend_into(&path, &root, &mut seen) {
                stack.push((path, relative_path));
            }
        }
    }

    Ok(finish_search(entries, false))
}

pub fn delete_folder(root: &Path, target: &Path) -> Result<(), String> {
    let target = child_directory(root, target)?;
    let visible = display_path(&target);
    trash::delete(&visible).map_err(|error| {
        format!(
            "Could not move {} to the Recycle Bin: {error}",
            visible.display()
        )
    })
}

fn child_directory(root: &Path, target: &Path) -> Result<PathBuf, String> {
    if !root.is_dir() {
        return Err(format!(
            "Workspace folder does not exist: {}",
            root.display()
        ));
    }
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", root.display()))?;
    let target = target
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", target.display()))?;

    if is_same_path(&root, &target) {
        return Err("The workspace folder cannot be deleted.".into());
    }
    if !is_strict_child(&root, &target) {
        return Err("That path is outside the workspace.".into());
    }

    Ok(target)
}

pub(crate) fn display_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn component_eq(left: Component<'_>, right: Component<'_>) -> bool {
    left.as_os_str().eq_ignore_ascii_case(right.as_os_str())
}

fn is_same_path(left: &Path, right: &Path) -> bool {
    let mut left_iter = left.components();
    let mut right_iter = right.components();
    loop {
        match (left_iter.next(), right_iter.next()) {
            (None, None) => return true,
            (Some(left_component), Some(right_component))
                if component_eq(left_component, right_component) => {}
            _ => return false,
        }
    }
}

pub fn reveal_path(path: &Path) -> Result<(), String> {
    let select_file = path.is_file();
    let target = if path.exists() {
        display_path(path)
    } else {
        let parent = path
            .parent()
            .filter(|parent| parent.exists())
            .ok_or_else(|| format!("Path does not exist: {}", path.display()))?;
        display_path(parent)
    };
    reveal_existing(&target, select_file && path.exists())
}

pub fn open_in_terminal(path: &Path, command: Option<&str>) -> Result<(), String> {
    let path = if path.exists() {
        display_path(path)
    } else {
        return Err(format!("Folder does not exist: {}", path.display()));
    };
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    let login = accepted_terminal_command(command)?;
    #[cfg(windows)]
    {
        return windows_shell::open_terminal(&path, login);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_open_terminal(&path, login);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return linux_open_terminal(&path, login);
    }
}

/// The webview may only ask for a terminal, or for `gh auth login`.
/// Anything else would run as a shell command.
fn accepted_terminal_command(command: Option<&str>) -> Result<bool, String> {
    match command.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(false),
        Some("gh auth login") => Ok(true),
        Some(_) => Err("That terminal command is not allowed.".into()),
    }
}

pub fn open_with_default(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    start_default(&display_path(path))
}

fn reveal_existing(path: &Path, select_file: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_shell::reveal(path, select_file);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = select_file;
        return spawn_command("open", &["-R", &path.to_string_lossy()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = select_file;
        let directory = if path.is_dir() {
            path.to_path_buf()
        } else {
            path.parent().unwrap_or(path).to_path_buf()
        };
        return spawn_command("xdg-open", &[&directory.to_string_lossy()]);
    }
}

fn start_default(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_shell::open_path(path);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_command("open", &[&path.to_string_lossy()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return spawn_command("xdg-open", &[&path.to_string_lossy()]);
    }
}

#[cfg(any(test, target_os = "macos"))]
const GITHUB_LOGIN_APPLESCRIPT: &str = r#"on run argv
  set repoPath to item 1 of argv
  tell application "Terminal"
    activate
    do script "cd " & quoted form of repoPath & " && gh auth login"
  end tell
end run"#;

#[cfg(target_os = "macos")]
fn macos_open_terminal(path: &Path, login: bool) -> Result<(), String> {
    if !login {
        return spawn_command("open", &["-a", "Terminal", &path.to_string_lossy()]);
    }
    let repo = path.to_string_lossy();
    spawn_command("osascript", &["-e", GITHUB_LOGIN_APPLESCRIPT, &repo])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_open_terminal(path: &Path, login: bool) -> Result<(), String> {
    let directory = path.to_string_lossy();
    if !login {
        if spawn_command("x-terminal-emulator", &["--working-directory", &directory]).is_ok() {
            return Ok(());
        }
        return spawn_command("gnome-terminal", &["--working-directory", &directory]);
    }
    let shell = unix_github_login_shell(path);
    // gnome-terminal treats `-e` as one argument and ignores the rest, so a
    // split `sh -lc <script>` would open a shell and never run the login.
    if spawn_command(
        "gnome-terminal",
        &["--working-directory", &directory, "--", "sh", "-lc", &shell],
    )
    .is_ok()
    {
        return Ok(());
    }
    if spawn_command(
        "konsole",
        &["--workdir", &directory, "-e", "sh", "-lc", &shell],
    )
    .is_ok()
    {
        return Ok(());
    }
    if spawn_command(
        "xfce4-terminal",
        &["--working-directory", &directory, "-x", "sh", "-lc", &shell],
    )
    .is_ok()
    {
        return Ok(());
    }
    if spawn_command(
        "kitty",
        &["--working-directory", &directory, "sh", "-lc", &shell],
    )
    .is_ok()
    {
        return Ok(());
    }
    if spawn_command("xterm", &["-e", "sh", "-lc", &shell]).is_ok() {
        return Ok(());
    }
    let one_shot = format!("sh -lc {}", shell_single_quote(&shell));
    spawn_command(
        "x-terminal-emulator",
        &["--working-directory", &directory, "-e", &one_shot],
    )
}

#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn unix_github_login_shell(path: &Path) -> String {
    format!(
        "cd {} && gh auth login; exec \"${{SHELL:-sh}}\"",
        shell_single_quote(&path.to_string_lossy())
    )
}

#[cfg(any(test, windows))]
fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(any(test, windows))]
fn github_login_powershell(path: &Path) -> String {
    let quoted = powershell_single_quote(&path.to_string_lossy());
    format!(
        "Set-Location -LiteralPath {quoted}\r\n\
$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')\r\n\
$user = [Environment]::GetEnvironmentVariable('Path', 'User')\r\n\
if ($machine -or $user) {{\r\n\
    $env:Path = (@($machine, $user) | Where-Object {{ $_ }}) -join ';'\r\n\
}}\r\n\
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {{\r\n\
    Write-Host 'GitHub CLI (gh) was not found. Install it from https://cli.github.com, then run: gh auth login'\r\n\
    return\r\n\
}}\r\n\
gh auth login\r\n"
    )
}

#[cfg(any(test, windows))]
fn encode_utf16le_base64(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64_encode(&bytes)
}

#[cfg(any(test, windows))]
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut chunks = data.chunks_exact(3);
    for chunk in chunks.by_ref() {
        let value = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | chunk[2] as u32;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push(TABLE[(value & 63) as usize] as char);
    }
    let rest = chunks.remainder();
    if rest.len() == 1 {
        let value = (rest[0] as u32) << 16;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest.len() == 2 {
        let value = ((rest[0] as u32) << 16) | ((rest[1] as u32) << 8);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(unix)]
fn spawn_command(program: &str, args: &[&str]) -> Result<(), String> {
    std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Could not open {}: {error}",
                args.last().unwrap_or(&program)
            )
        })?;
    Ok(())
}

#[cfg(windows)]
mod windows_shell {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::{Command, Stdio};

    const CREATE_NEW_CONSOLE: u32 = 0x00000010;

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> isize;
    }

    pub fn reveal(path: &Path, select_file: bool) -> Result<(), String> {
        let mut command = Command::new("explorer.exe");
        if select_file {
            command.arg("/select,").arg(path);
        } else {
            command.arg(path);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not show {} in Explorer: {error}", path.display()))?;
        Ok(())
    }

    pub fn open_terminal(path: &Path, login: bool) -> Result<(), String> {
        if login {
            return open_github_login(path);
        }
        Command::new("wt.exe")
            .arg("-d")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .or_else(|_| {
                Command::new("powershell.exe")
                    .args(["-NoExit", "-NoLogo"])
                    .current_dir(path)
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
            })
            .map_err(|error| format!("Could not open {} in a terminal: {error}", path.display()))?;
        Ok(())
    }

    fn open_github_login(path: &Path) -> Result<(), String> {
        // Windows Terminal splits on ';', and a quoted `-Command` loses its
        // quotes when Terminal rebuilds the command line, so PowerShell only
        // runs the first word. `-EncodedCommand` is one token. The script
        // also reloads PATH; this process still has the PATH from startup,
        // which misses GitHub CLI installed after that.
        let encoded = super::encode_utf16le_base64(&super::github_login_powershell(path));
        let launch = [
            "-NoProfile",
            "-NoExit",
            "-NoLogo",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            encoded.as_str(),
        ];
        if Command::new("wt.exe")
            .arg("-d")
            .arg(path)
            .arg("--")
            .arg("powershell.exe")
            .args(launch)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        // A window-subsystem app has no console. A new console keeps `gh auth login` interactive.
        Command::new("powershell.exe")
            .args(launch)
            .current_dir(path)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|error| format!("Could not open {} in a terminal: {error}", path.display()))?;
        Ok(())
    }

    pub fn open_path(path: &Path) -> Result<(), String> {
        let file = wide(path.as_os_str());
        let operation = wide(std::ffi::OsStr::new("open"));
        let code = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if code > 32 {
            return Ok(());
        }
        Err(format!("Could not open {} (error {code}).", path.display()))
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }
}

fn is_strict_child(root: &Path, target: &Path) -> bool {
    let mut root_iter = root.components();
    let mut target_iter = target.components();
    loop {
        match root_iter.next() {
            Some(root_component) => match target_iter.next() {
                Some(target_component) if component_eq(root_component, target_component) => {}
                _ => return false,
            },
            None => return target_iter.next().is_some(),
        }
    }
}

/// `git::contained_path` rejects the repository root and `.git`. The explorer
/// still opens both, so this repeats that canonical-prefix guard without those refusals.
fn directory_in_repo(repo: &Path, relative: &str) -> Result<PathBuf, String> {
    if !repo.is_dir() {
        return Err(format!("Folder does not exist: {}", repo.display()));
    }
    let root = repo
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", repo.display()))?;
    let relative = normalize_relative(relative)?;
    let full = if relative.is_empty() {
        root.clone()
    } else {
        root.join(relative)
    };
    let canonical = full
        .canonicalize()
        .map_err(|_| format!("Folder does not exist: {}", display_path(&full).display()))?;
    if !is_same_path(&root, &canonical) && !is_strict_child(&root, &canonical) {
        return Err("That path is outside the repository.".into());
    }
    if !canonical.is_dir() {
        return Err(format!(
            "Folder does not exist: {}",
            display_path(&canonical).display()
        ));
    }
    Ok(canonical)
}

fn normalize_relative(value: &str) -> Result<String, String> {
    let relative = value.trim().replace('\\', "/");
    if relative.is_empty() {
        return Ok(String::new());
    }
    if relative.starts_with('/')
        || relative.starts_with('~')
        || relative.chars().any(|ch| ch == '\0' || ch == ':')
    {
        return Err("That path is outside the repository.".into());
    }
    if relative
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("That path is outside the repository.".into());
    }
    Ok(relative)
}

fn entry_kind(path: &Path) -> DirKind {
    match path.metadata() {
        Ok(meta) if meta.is_dir() => DirKind::Folder,
        _ => DirKind::File,
    }
}

fn sort_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|left, right| {
        kind_rank(left.kind)
            .cmp(&kind_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn kind_rank(kind: DirKind) -> u8 {
    match kind {
        DirKind::Folder => 0,
        DirKind::File => 1,
    }
}

fn finish_search(mut entries: Vec<DirEntry>, truncated: bool) -> DirSearch {
    sort_entries(&mut entries);
    DirSearch { entries, truncated }
}

fn descend_into(path: &Path, root: &Path, seen: &mut HashSet<PathBuf>) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    let file_type = meta.file_type();
    if !file_type.is_dir() && !file_type.is_symlink() {
        return false;
    }
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    if !canonical.is_dir() {
        return false;
    }
    if !is_same_path(root, &canonical) && !is_strict_child(root, &canonical) {
        return false;
    }
    seen.insert(canonical)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        DirKind, GITHUB_LOGIN_APPLESCRIPT, accepted_terminal_command, child_directory,
        display_path, encode_utf16le_base64, github_login_powershell, is_strict_child,
        list_directory, search_directory, unix_github_login_shell,
    };

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\repos\demo")),
            PathBuf::from(r"C:\repos\demo")
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
    }

    #[test]
    fn child_directory_accepts_descendants_only() {
        let root = scratch("delete-root");
        let child = root.join("group").join("repo");
        fs::create_dir_all(&child).unwrap();
        let sibling = scratch("delete-sibling");

        let file = child.join("note.txt");
        fs::write(&file, "x").unwrap();

        assert!(child_directory(&root, &child).is_ok());
        assert!(child_directory(&root, &file).is_ok());
        assert!(child_directory(&root, &root).is_err());
        assert!(child_directory(&root, &sibling).is_err());
        assert!(child_directory(&root, &sibling.join("note.txt")).is_err());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&sibling);
    }

    #[cfg(windows)]
    #[test]
    fn strict_child_ignores_case_and_rejects_siblings() {
        let root = Path::new(r"C:\Work\Repos");
        assert!(is_strict_child(root, Path::new(r"c:\work\repos\app")));
        assert!(!is_strict_child(root, root));
        assert!(!is_strict_child(
            root,
            Path::new(r"C:\Work\Repos-other\app")
        ));
        assert!(!is_strict_child(root, Path::new(r"C:\Work")));
    }

    #[test]
    fn list_directory_sorts_folders_and_stays_inside() {
        let root = scratch("list");
        fs::create_dir_all(root.join("src").join("lib")).unwrap();
        fs::write(root.join("readme.txt"), "hi").unwrap();
        fs::write(root.join("src").join("main.ts"), "x").unwrap();
        fs::create_dir_all(root.join(".git").join("objects")).unwrap();
        fs::write(root.join(".git").join("config"), "").unwrap();
        fs::write(
            root.join(".git").join("objects").join("secret-name.txt"),
            "",
        )
        .unwrap();

        let entries = list_directory(&root, "").unwrap();
        let src = entries.iter().find(|entry| entry.name == "src").unwrap();
        let readme = entries
            .iter()
            .find(|entry| entry.name == "readme.txt")
            .unwrap();
        assert_eq!(src.kind, DirKind::Folder);
        assert_eq!(readme.kind, DirKind::File);
        assert!(
            entries
                .iter()
                .position(|entry| entry.name == "src")
                .unwrap()
                < entries
                    .iter()
                    .position(|entry| entry.name == "readme.txt")
                    .unwrap()
        );

        let nested = list_directory(&root, "src").unwrap();
        assert!(
            nested.iter().any(|entry| {
                entry.relative_path == "src/main.ts" && entry.kind == DirKind::File
            })
        );
        assert!(
            nested
                .iter()
                .any(|entry| { entry.name == "lib" && entry.kind == DirKind::Folder })
        );
        assert!(list_directory(&root, "..").is_err());
        assert!(list_directory(&root, "src/../../secret").is_err());
        assert!(list_directory(&root, ".git").is_ok());

        let found = search_directory(&root, "main").unwrap();
        assert!(
            found
                .entries
                .iter()
                .any(|entry| entry.relative_path == "src/main.ts")
        );
        let hidden = search_directory(&root, "secret-name").unwrap();
        assert!(hidden.entries.is_empty());
        assert!(search_directory(&root, "   ").is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_does_not_follow_a_link_outside_the_repo() {
        let root = scratch("link");
        let outside = scratch("link-out");
        fs::write(outside.join("secret.txt"), "nope").unwrap();
        fs::create_dir_all(root.join("nested")).unwrap();
        let link = root.join("nested").join("escape");
        if link_dir(&outside, &link).is_err() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let listed = list_directory(&root, "nested").unwrap();
        assert!(
            listed
                .iter()
                .any(|entry| entry.name == "escape" && entry.kind == DirKind::Folder)
        );
        assert!(list_directory(&root, "nested/escape").is_err());
        let found = search_directory(&root, "secret").unwrap();
        assert!(found.entries.is_empty());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn terminal_command_allows_only_github_login() {
        assert!(!accepted_terminal_command(None).unwrap());
        assert!(!accepted_terminal_command(Some("  ")).unwrap());
        assert!(accepted_terminal_command(Some("  gh auth login  ")).unwrap());
        assert!(accepted_terminal_command(Some("gh auth login; calc.exe")).is_err());
        assert!(accepted_terminal_command(Some("gh auth login && rm -rf /")).is_err());
        assert!(accepted_terminal_command(Some("calc.exe")).is_err());
    }

    #[test]
    fn github_login_applescript_quotes_the_path_as_an_argument() {
        assert!(GITHUB_LOGIN_APPLESCRIPT.contains("quoted form of repoPath"));
        assert!(GITHUB_LOGIN_APPLESCRIPT.contains("item 1 of argv"));
        assert!(GITHUB_LOGIN_APPLESCRIPT.contains("gh auth login"));
    }

    #[test]
    fn unix_login_shell_quotes_spaces_and_quotes() {
        let shell = unix_github_login_shell(Path::new("/home/a b/o'brien"));
        assert_eq!(
            shell,
            "cd '/home/a b/o'\\''brien' && gh auth login; exec \"${SHELL:-sh}\""
        );
    }

    #[test]
    fn powershell_login_script_quotes_the_repo_and_reloads_path() {
        let script = github_login_powershell(Path::new(r"C:\Repos\O'Brien"));
        assert!(script.contains("Set-Location -LiteralPath 'C:\\Repos\\O''Brien'"));
        assert!(script.contains("GetEnvironmentVariable('Path', 'Machine')"));
        assert!(script.contains("gh auth login"));
        let encoded = encode_utf16le_base64(&script);
        assert!(encoded.chars().all(|ch| !ch.is_whitespace() && ch != ';'));
    }

    #[cfg(windows)]
    #[test]
    fn powershell_runs_an_encoded_command() {
        let encoded = encode_utf16le_base64("Write-Output 'ce-git-encoded'\r\n");
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NoLogo",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                &encoded,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("ce-git-encoded"));
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }
}

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn open_in_editor(path: &Path, editor: &str) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    let executable = match editor {
        "cursor" => require_cursor()?,
        "code" => require_code()?,
        "default" | "" => resolve_editor()?,
        other => return Err(format!("Unknown editor: {other}")),
    };
    spawn_editor(&executable, path).map_err(|error| {
        format!(
            "Could not open {} in {}: {error}",
            path.display(),
            executable.display()
        )
    })
}

fn require_cursor() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        return windows::find_cursor().ok_or_else(|| "Cursor was not found.".to_string());
    }
    #[cfg(not(windows))]
    {
        unix_command("cursor", "Cursor")
    }
}

fn require_code() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        return windows::find_code().ok_or_else(|| "Visual Studio Code was not found.".to_string());
    }
    #[cfg(not(windows))]
    {
        unix_command("code", "Visual Studio Code")
    }
}

fn resolve_editor() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        windows::resolve_editor()
    }
    #[cfg(not(windows))]
    {
        unix_editor()
    }
}

fn spawn_editor(editor: &Path, folder: &Path) -> std::io::Result<()> {
    let mut command = Command::new(editor);
    command
        .arg(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn expand_env(value: &str) -> String {
    let mut expanded = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        expanded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if name.is_empty() {
                expanded.push('%');
            } else if let Some(replacement) = env::var_os(name) {
                expanded.push_str(&replacement.to_string_lossy());
            } else {
                expanded.push('%');
                expanded.push_str(name);
                expanded.push('%');
            }
            rest = &after[end + 1..];
        } else {
            expanded.push('%');
            expanded.push_str(after);
            break;
        }
    }
    expanded.push_str(rest);
    expanded
}

fn exe_from_open_command(command: &str) -> Option<String> {
    let command = expand_env(command.trim());
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    if let Some(rest) = command.strip_prefix('"') {
        let end = rest.find('"')?;
        let exe = rest[..end].trim();
        if exe.is_empty() {
            None
        } else {
            Some(exe.to_string())
        }
    } else {
        let exe = command.split_whitespace().next()?.trim();
        if exe.is_empty() {
            None
        } else {
            Some(exe.to_string())
        }
    }
}

fn opens_folders(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    let name = name.to_string_lossy().to_ascii_lowercase();
    const NAMES: &[&str] = &[
        "cursor.exe",
        "code.exe",
        "code - insiders.exe",
        "windsurf.exe",
        "zed.exe",
        "sublime_text.exe",
        "idea64.exe",
        "idea.exe",
        "webstorm64.exe",
        "webstorm.exe",
        "rider64.exe",
        "pycharm64.exe",
        "pycharm.exe",
        "goland64.exe",
        "rustrover64.exe",
        "clion64.exe",
        "phpstorm64.exe",
        "rubymine64.exe",
        "fleet.exe",
        "atom.exe",
    ];
    NAMES.contains(&name.as_str())
}

#[cfg(not(windows))]
fn unix_command(command: &str, label: &str) -> Result<PathBuf, String> {
    let output = Command::new("which")
        .arg(command)
        .output()
        .map_err(|error| format!("Could not look up {label}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{label} was not found."));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let path = PathBuf::from(text.lines().next().unwrap_or("").trim());
    if path.is_file() {
        return Ok(path);
    }
    Err(format!("{label} was not found."))
}

#[cfg(not(windows))]
fn unix_editor() -> Result<PathBuf, String> {
    let Some(editor) = env::var_os("VISUAL").or_else(|| env::var_os("EDITOR")) else {
        return Err("No code editor found. Set the EDITOR environment variable.".into());
    };
    let raw = editor.to_string_lossy();
    let program = raw.split_whitespace().next().unwrap_or("");
    let path = PathBuf::from(program);
    if path.is_file() {
        return Ok(path);
    }
    Err(format!("Editor command was not found: {program}"))
}

#[cfg(windows)]
mod windows {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    use winreg::RegKey;
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};

    use super::{exe_from_open_command, opens_folders};

    const SOURCE_EXTENSIONS: &[&str] =
        &[".tsx", ".ts", ".jsx", ".js", ".rs", ".json", ".md", ".py"];

    pub fn resolve_editor() -> Result<PathBuf, String> {
        if let Some(path) = default_associated_editor().or_else(installed_editor) {
            return Ok(path);
        }
        Err(
            "No code editor found. Install Cursor or Visual Studio Code, or set one as the default app for .ts files."
                .into(),
        )
    }

    fn default_associated_editor() -> Option<PathBuf> {
        for extension in SOURCE_EXTENSIONS {
            let Some(progid) = user_choice(extension).or_else(|| extension_progid(extension))
            else {
                continue;
            };
            let Some(command) = open_command(&progid) else {
                continue;
            };
            let Some(exe) = exe_from_open_command(&command) else {
                continue;
            };
            let raw = PathBuf::from(exe);
            let path = normalize_cli_path(&raw).unwrap_or(raw);
            if opens_folders(&path) && path.is_file() {
                return Some(path);
            }
        }
        None
    }

    fn user_choice(extension: &str) -> Option<String> {
        let base =
            format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{extension}");
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        reg_string(&hkcu, &format!(r"{base}\UserChoice"), "ProgId")
            .or_else(|| reg_string(&hkcu, &format!(r"{base}\UserChoiceLatest"), "ProgId"))
    }

    fn extension_progid(extension: &str) -> Option<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        reg_string(&hkcr, extension, "")
    }

    fn open_command(progid: &str) -> Option<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        for suffix in ["shell\\open\\command", "shell\\edit\\command"] {
            if let Some(value) = reg_string(&hkcr, &format!(r"{progid}\{suffix}"), "") {
                return Some(value);
            }
        }
        None
    }

    fn reg_string(hive: &RegKey, path: &str, name: &str) -> Option<String> {
        let key = hive.open_subkey(path).ok()?;
        let value: String = key.get_value(name).ok()?;
        let value = super::expand_env(value.trim());
        if value.is_empty() { None } else { Some(value) }
    }

    pub(super) fn find_cursor() -> Option<PathBuf> {
        first_file(&cursor_candidates()).or_else(|| where_exe("cursor"))
    }

    pub(super) fn find_code() -> Option<PathBuf> {
        first_file(&code_candidates()).or_else(|| where_exe("code"))
    }

    fn first_file(paths: &[PathBuf]) -> Option<PathBuf> {
        paths.iter().find(|path| path.is_file()).cloned()
    }

    fn installed_editor() -> Option<PathBuf> {
        find_cursor()
            .or_else(find_code)
            .or_else(|| first_file(&other_editor_candidates()))
            .or_else(|| where_exe("windsurf"))
            .or_else(|| where_exe("zed"))
            .or_else(|| where_exe("subl"))
    }

    fn cursor_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            paths.push(local.join("Programs").join("cursor").join("Cursor.exe"));
            paths.push(local.join("Programs").join("Cursor").join("Cursor.exe"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            paths.push(
                PathBuf::from(program_files)
                    .join("cursor")
                    .join("Cursor.exe"),
            );
        }
        paths
    }

    fn code_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            paths.push(
                local
                    .join("Programs")
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            );
            paths.push(
                local
                    .join("Programs")
                    .join("Microsoft VS Code Insiders")
                    .join("Code - Insiders.exe"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let program_files = PathBuf::from(program_files);
            paths.push(program_files.join("Microsoft VS Code").join("Code.exe"));
            paths.push(
                program_files
                    .join("Microsoft VS Code Insiders")
                    .join("Code - Insiders.exe"),
            );
        }
        paths
    }

    fn other_editor_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            paths.push(local.join("Programs").join("Windsurf").join("Windsurf.exe"));
            paths.push(local.join("Programs").join("Zed").join("Zed.exe"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let program_files = PathBuf::from(program_files);
            paths.push(program_files.join("Sublime Text").join("sublime_text.exe"));
            paths.push(program_files.join("Zed").join("Zed.exe"));
        }
        paths
    }

    fn where_exe(name: &str) -> Option<PathBuf> {
        let output = hidden_command("where.exe").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut fallback = None;
        for line in text.lines() {
            let raw = PathBuf::from(line.trim());
            let Some(path) = normalize_cli_path(&raw) else {
                continue;
            };
            if is_app_execution_alias(&path) {
                fallback = Some(path);
                continue;
            }
            return Some(path);
        }
        fallback
    }

    fn hidden_command(program: &str) -> Command {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new(program);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000);
        command
    }

    fn is_app_execution_alias(path: &Path) -> bool {
        path.to_string_lossy()
            .to_ascii_lowercase()
            .contains("windowsapps")
    }

    pub(super) fn normalize_cli_path(path: &Path) -> Option<PathBuf> {
        if !path.exists() {
            return None;
        }
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".exe") {
            return Some(path.to_path_buf());
        }
        let exe_name = if name.starts_with("cursor") {
            "Cursor.exe"
        } else if name.starts_with("code-insiders") || name.starts_with("code - insiders") {
            "Code - Insiders.exe"
        } else if name.starts_with("code") {
            "Code.exe"
        } else if name.starts_with("windsurf") {
            "Windsurf.exe"
        } else if name.starts_with("zed") {
            "Zed.exe"
        } else if name.starts_with("subl") {
            "sublime_text.exe"
        } else {
            return None;
        };
        let mut dir = path.parent()?;
        for _ in 0..4 {
            let exe = dir.join(exe_name);
            if exe.is_file() {
                return Some(exe);
            }
            dir = dir.parent()?;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{exe_from_open_command, expand_env, opens_folders};

    #[test]
    fn reads_quoted_executable() {
        let exe = exe_from_open_command(r#""C:\Program Files\cursor\Cursor.exe" "%1""#).unwrap();
        assert_eq!(exe, r"C:\Program Files\cursor\Cursor.exe");
    }

    #[test]
    fn reads_unquoted_executable() {
        let exe = exe_from_open_command(r"C:\Windows\notepad.exe %1").unwrap();
        assert_eq!(exe, r"C:\Windows\notepad.exe");
    }

    #[test]
    fn expands_environment_variables_in_commands() {
        let Ok(root) = std::env::var("SystemRoot") else {
            return;
        };
        assert_eq!(
            expand_env(r"%SystemRoot%\notepad.exe"),
            format!(r"{root}\notepad.exe")
        );
        let exe = exe_from_open_command(r#""%SystemRoot%\notepad.exe" "%1""#).unwrap();
        assert_eq!(exe, format!(r"{root}\notepad.exe"));
    }

    #[test]
    fn folder_editors_are_known_by_file_name() {
        assert!(opens_folders(Path::new(r"C:\Apps\Cursor.exe")));
        assert!(opens_folders(Path::new(r"C:\Apps\Code.exe")));
        assert!(!opens_folders(Path::new(r"C:\Windows\notepad.exe")));
        assert!(!opens_folders(Path::new(r"C:\Windows\explorer.exe")));
    }

    #[cfg(windows)]
    #[test]
    fn cli_shim_resolves_to_editor_exe() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ce-git-editor-{nanos}"));
        let bin = root.join("resources").join("app").join("bin");
        fs::create_dir_all(&bin).unwrap();
        let shim = bin.join("cursor.cmd");
        fs::write(&shim, "@echo off\n").unwrap();
        fs::write(root.join("Cursor.exe"), "").unwrap();

        let resolved = super::windows::normalize_cli_path(&shim).unwrap();
        assert_eq!(resolved, root.join("Cursor.exe"));
        let bin_shim = root.join("bin");
        fs::create_dir_all(&bin_shim).unwrap();
        let code_shim = bin_shim.join("code.cmd");
        fs::write(&code_shim, "@echo off\n").unwrap();
        fs::write(root.join("Code.exe"), "").unwrap();
        assert_eq!(
            super::windows::normalize_cli_path(&code_shim).unwrap(),
            root.join("Code.exe")
        );
        assert!(
            super::windows::normalize_cli_path(&PathBuf::from(r"C:\missing\cursor.cmd")).is_none()
        );

        let _ = fs::remove_dir_all(root);
    }
}

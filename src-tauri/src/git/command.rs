use std::path::Path;
use std::process::{Child, Command, Output, Stdio};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) struct GitOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl GitOutput {
    pub(crate) fn success(&self) -> bool {
        self.status == Some(0)
    }

    pub(crate) fn from_output(output: Output) -> Self {
        Self {
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }
}

fn prepare(dir: &Path, args: &[&str], interactive: bool) -> Command {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Interactive sign-in has to be able to open the Git Credential Manager window.
    if !interactive {
        command.env("GIT_TERMINAL_PROMPT", "0");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
    }

    command
}

fn map_start_error(error: std::io::Error, dir: &Path) -> String {
    if error.kind() == std::io::ErrorKind::NotFound && dir.is_dir() {
        "git was not found on PATH".to_string()
    } else {
        format!("Failed to start git: {error}")
    }
}

pub(crate) fn spawn_git(dir: &Path, args: &[&str], interactive: bool) -> Result<Child, String> {
    prepare(dir, args, interactive)
        .spawn()
        .map_err(|error| map_start_error(error, dir))
}

pub(crate) fn stop_process(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = command.status();
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }
}

pub(crate) fn git_output(dir: &Path, args: &[&str]) -> Result<GitOutput, String> {
    let output = prepare(dir, args, false)
        .output()
        .map_err(|error| map_start_error(error, dir))?;
    Ok(GitOutput::from_output(output))
}

pub fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = prepare(dir, args, false)
        .output()
        .map_err(|error| map_start_error(error, dir))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout_trim = stdout.trim();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout_trim.is_empty() {
        stdout_trim.to_string()
    } else {
        format!("exit {}", output.status)
    };
    let command_name = args.first().copied().unwrap_or("git");
    Err(format!("git {command_name} failed: {detail}"))
}

pub fn git_available() -> bool {
    let mut command = Command::new("git");
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn dir_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

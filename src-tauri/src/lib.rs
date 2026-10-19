mod ai;
mod app_settings;
mod batch;
mod editor;
mod files;
mod git;

use std::path::Path;

use tauri::Manager;

use batch::CommitRequest;
use git::{RepoDiff, RepoStatus, TreeNode, repo_diff as read_repo_diff, status_of};

#[tauri::command]
fn git_available() -> bool {
    git::git_available()
}

#[tauri::command]
fn git_settings() -> Result<git::GitSettings, String> {
    git::read_git_settings()
}

#[tauri::command]
fn save_git_settings(
    name: String,
    email: String,
    default_branch: String,
    autocrlf: String,
) -> Result<(), String> {
    git::save_git_settings(name, email, default_branch, autocrlf)
}

#[tauri::command]
async fn git_sign_in() -> Result<git::GitSettings, String> {
    tauri::async_runtime::spawn_blocking(git::git_sign_in)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn git_sign_out(account: String) -> Result<git::GitSettings, String> {
    git::git_sign_out(account)
}

#[tauri::command]
fn git_cancel_sign_in() {
    git::git_cancel_sign_in();
}

#[tauri::command]
fn app_settings(app: tauri::AppHandle) -> Result<app_settings::AppSettings, String> {
    app_settings::app_settings(&app)
}

#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    settings_folder: String,
    font_zoom: u32,
    theme: String,
    color_mode: String,
    selected_prompt: Option<u8>,
    prompts: Vec<String>,
) -> Result<app_settings::AppSettings, String> {
    app_settings::save_app_settings(
        &app,
        settings_folder,
        font_zoom,
        theme,
        color_mode,
        selected_prompt,
        prompts,
    )
}

#[tauri::command]
fn theme_css(app: tauri::AppHandle) -> Result<String, String> {
    app_settings::theme_css(&app)
}

#[tauri::command]
fn patch_app_settings(
    app: tauri::AppHandle,
    patch: app_settings::AppSettingsPatch,
) -> Result<(), String> {
    app_settings::patch_app_settings(&app, patch)
}

#[tauri::command]
fn openai_configured(app: tauri::AppHandle) -> bool {
    ai::openai_configured(&app)
}

#[tauri::command]
fn ai_settings(app: tauri::AppHandle) -> ai::AiSettings {
    ai::ai_settings(&app)
}

#[tauri::command]
fn save_ai_settings(
    app: tauri::AppHandle,
    key: String,
    model: String,
    thinking: String,
    prompts: Vec<String>,
    clear_key: bool,
) -> Result<(), String> {
    ai::save_ai_settings(&app, key, model, thinking, prompts, clear_key)
}

#[tauri::command]
async fn list_openai_models(
    app: tauri::AppHandle,
    key: String,
    include: String,
) -> Result<Vec<ai::OpenAiModel>, String> {
    ai::list_openai_models(app, key, include).await
}

#[tauri::command]
fn discover_repos(root: String) -> Result<TreeNode, String> {
    git::discover(Path::new(&root))
}

#[tauri::command]
fn repo_statuses(paths: Vec<String>) -> Vec<RepoStatus> {
    std::thread::scope(|scope| {
        let mut statuses = Vec::with_capacity(paths.len());
        for chunk in paths.chunks(8) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|path| {
                    let path = path.clone();
                    scope.spawn(move || status_of(Path::new(&path)))
                })
                .collect();
            for handle in handles {
                if let Ok(status) = handle.join() {
                    statuses.push(status);
                }
            }
        }
        statuses
    })
}

#[tauri::command]
fn repo_diff(path: String) -> Result<RepoDiff, String> {
    read_repo_diff(Path::new(&path))
}

#[tauri::command]
async fn search_repos(
    paths: Vec<String>,
    query: String,
    match_case: bool,
    regex: bool,
    whole_word: bool,
    glob: String,
) -> Result<Vec<git::RepoSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::search_repos(paths, query, match_case, regex, whole_word, glob)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn generate_commit_message(
    app: tauri::AppHandle,
    path: String,
    prompt: String,
) -> Result<ai::GeneratedCommit, String> {
    ai::generate_commit_message(app, path, prompt).await
}

#[tauri::command]
async fn batch_pull(app: tauri::AppHandle, paths: Vec<String>) -> Vec<batch::BatchProgress> {
    batch::batch_pull(app, paths).await
}

#[tauri::command]
async fn batch_push(app: tauri::AppHandle, paths: Vec<String>) -> Vec<batch::BatchProgress> {
    batch::batch_push(app, paths).await
}

#[tauri::command]
async fn batch_commit(
    app: tauri::AppHandle,
    commits: Vec<CommitRequest>,
) -> Vec<batch::BatchProgress> {
    batch::batch_commit(app, commits).await
}

#[tauri::command]
fn init_repo(path: String) -> Result<(), String> {
    git::init_repo(Path::new(&path))
}

#[tauri::command]
async fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::editor::open_in_editor(Path::new(&path), &editor)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_path(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        files::delete_folder(Path::new(&root), Path::new(&path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn discard_change(repo: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git::discard_change(Path::new(&repo), &path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn ignore_change(repo: String, kind: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git::ignore_change(Path::new(&repo), &kind, &path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reveal_change(repo: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let full = git::contained_path(Path::new(&repo), &path)?;
        files::reveal_path(&full)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_change(repo: String, path: String, mode: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let full = git::contained_path(Path::new(&repo), &path)?;
        match mode.as_str() {
            "editor" => crate::editor::open_file_in_editor(&full, "default"),
            "cursor" => crate::editor::open_file_in_editor(&full, "cursor"),
            "default" => files::open_with_default(&full),
            _ => Err("Unknown open mode.".into()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git_available,
            git_settings,
            save_git_settings,
            git_sign_in,
            git_sign_out,
            git_cancel_sign_in,
            app_settings,
            save_app_settings,
            theme_css,
            patch_app_settings,
            openai_configured,
            ai_settings,
            save_ai_settings,
            list_openai_models,
            discover_repos,
            repo_statuses,
            repo_diff,
            search_repos,
            generate_commit_message,
            batch_pull,
            batch_push,
            batch_commit,
            open_in_editor,
            init_repo,
            delete_path,
            discard_change,
            ignore_change,
            reveal_change,
            open_change
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

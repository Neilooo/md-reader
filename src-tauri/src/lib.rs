use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

mod pdf_export;
mod pdf_utils;

use pdf_utils::{current_millis, strip_windows_extended_prefix};

const STORAGE_FILE: &str = "settings.json";
const THEME_STORAGE_KEY: &str = "md-reader-theme";

#[cfg(target_os = "windows")]
fn apply_windows_frame_theme(window: &tauri::WebviewWindow, is_dark: bool) {
    let _ = window_vibrancy::apply_mica(window, Some(is_dark));
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_frame_theme(_window: &tauri::WebviewWindow, _is_dark: bool) {}

fn extract_md_path_from_args(argv: &[String]) -> Option<String> {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("--") {
            continue;
        }
        let p = std::path::Path::new(arg);
        if p.is_file() {
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            if matches!(
                ext.as_deref(),
                Some("md") | Some("markdown") | Some("mdx") | Some("txt")
            ) {
                if let Ok(abs) = std::fs::canonicalize(p) {
                    return Some(strip_windows_extended_prefix(
                        abs.to_string_lossy().to_string(),
                    ));
                }
                return Some(arg.clone());
            }
        }
    }
    None
}

use tauri::{Emitter, State};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct MdFile {
    pub path: String,
    pub name: String,
    pub rel_path: String,
    pub size: u64,
    pub modified_ms: i64,
}

#[derive(Default)]
pub struct WatcherState {
    inner: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    current_root: Mutex<Option<PathBuf>>,
}

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx") | Some("txt")
    )
}

#[tauri::command]
fn list_md_files(root: String) -> Result<Vec<MdFile>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    let mut files = Vec::new();
    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules" || name == "target")
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && is_markdown_file(path) {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let rel = path
                .strip_prefix(&root_path)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            files.push(MdFile {
                path: path.to_string_lossy().to_string(),
                name,
                rel_path: rel,
                size: meta.len(),
                modified_ms,
            });
        }
    }
    files.sort_by(|a, b| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn start_watch(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.exists() {
        return Err(format!("Path not found: {}", root));
    }
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                let paths: Vec<String> = events
                    .into_iter()
                    .map(|e| e.path.to_string_lossy().to_string())
                    .collect();
                let _ = app_handle.emit("md-reader://file-changed", paths);
            }
            Err(error) => {
                eprintln!("watch error: {error:?}");
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        *guard = Some(debouncer);
    }
    {
        let mut cur = state.current_root.lock().map_err(|e| e.to_string())?;
        *cur = Some(path);
    }
    Ok(())
}

#[tauri::command]
fn stop_watch(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = None;
    let mut cur = state.current_root.lock().map_err(|e| e.to_string())?;
    *cur = None;
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub rel_path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[tauri::command]
fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    max_results: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let needle = if case_sensitive {
        q.to_string()
    } else {
        q.to_lowercase()
    };
    let limit = max_results.unwrap_or(500);
    let mut results = Vec::new();

    'outer: for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules" || name == "target")
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_markdown_file(path) {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let rel = path
            .strip_prefix(&root_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        for (idx, line) in content.lines().enumerate() {
            let hay = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if let Some(col) = hay.find(&needle) {
                let preview = line.chars().take(200).collect::<String>();
                results.push(SearchMatch {
                    path: path.to_string_lossy().to_string(),
                    rel_path: rel.clone(),
                    line: idx + 1,
                    column: col + 1,
                    preview,
                });
                if results.len() >= limit {
                    break 'outer;
                }
            }
        }
    }
    Ok(results)
}

#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(target_os = "windows")]
fn reg_add(args: Vec<String>) -> Result<(), String> {
    let output = hidden_command("reg")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run reg.exe: {}", e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

#[cfg(target_os = "windows")]
fn notify_shell_assoc_changed() {
    let _ = hidden_command("ie4uinit.exe").arg("-show").output();
}

#[cfg(target_os = "windows")]
fn register_windows_file_associations() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = strip_windows_extended_prefix(exe.to_string_lossy().to_string());
    let open_command = format!("\"{}\" \"%1\"", exe_path);
    let icon = format!("\"{}\",0", exe_path);
    let prog_id = "MDReader.Markdown";
    let app_key = r"HKCU\Software\Classes\Applications\md-reader.exe";

    reg_add(vec![
        "add".into(),
        format!(r"HKCU\Software\Classes\{}", prog_id),
        "/ve".into(),
        "/d".into(),
        "Markdown Document".into(),
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        format!(r"HKCU\Software\Classes\{}", prog_id),
        "/v".into(),
        "FriendlyTypeName".into(),
        "/d".into(),
        "Markdown Document".into(),
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        format!(r"HKCU\Software\Classes\{}\DefaultIcon", prog_id),
        "/ve".into(),
        "/d".into(),
        icon,
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        format!(r"HKCU\Software\Classes\{}\shell", prog_id),
        "/ve".into(),
        "/d".into(),
        "open".into(),
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        format!(r"HKCU\Software\Classes\{}\shell\open\command", prog_id),
        "/ve".into(),
        "/d".into(),
        open_command.clone(),
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        app_key.into(),
        "/v".into(),
        "FriendlyAppName".into(),
        "/d".into(),
        "MD Reader".into(),
        "/f".into(),
    ])?;
    reg_add(vec![
        "add".into(),
        format!(r"{}\shell\open\command", app_key),
        "/ve".into(),
        "/d".into(),
        open_command,
        "/f".into(),
    ])?;

    for (ext, content_type) in [
        ("md", "text/markdown"),
        ("markdown", "text/markdown"),
        ("mdx", "text/mdx"),
    ] {
        let ext_name = format!(".{}", ext);
        let ext_key = format!(r"HKCU\Software\Classes\{}", ext_name);
        reg_add(vec![
            "add".into(),
            ext_key.clone(),
            "/ve".into(),
            "/d".into(),
            prog_id.into(),
            "/f".into(),
        ])?;
        reg_add(vec![
            "add".into(),
            ext_key.clone(),
            "/v".into(),
            "Content Type".into(),
            "/d".into(),
            content_type.into(),
            "/f".into(),
        ])?;
        reg_add(vec![
            "add".into(),
            format!(r"{}\OpenWithProgids", ext_key),
            "/v".into(),
            prog_id.into(),
            "/t".into(),
            "REG_SZ".into(),
            "/d".into(),
            "".into(),
            "/f".into(),
        ])?;
        reg_add(vec![
            "add".into(),
            format!(r"{}\OpenWithList\md-reader.exe", ext_key),
            "/ve".into(),
            "/d".into(),
            "".into(),
            "/f".into(),
        ])?;
        reg_add(vec![
            "add".into(),
            format!(r"{}\SupportedTypes", app_key),
            "/v".into(),
            ext_name,
            "/t".into(),
            "REG_SZ".into(),
            "/d".into(),
            "".into(),
            "/f".into(),
        ])?;
    }

    notify_shell_assoc_changed();
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn register_file_associations() -> Result<(), String> {
    register_windows_file_associations()
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn register_file_associations() -> Result<(), String> {
    Err("File association registration is only supported on Windows".into())
}

#[tauri::command]
fn set_theme_mode(window: tauri::WebviewWindow, theme_mode: String) -> Result<(), String> {
    let theme_option = match theme_mode.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        "system" | _ => None, // 传入 None 可恢复对操作系统的监听
    };

    window
        .set_theme(theme_option)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_effective_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    apply_windows_frame_theme(&window, theme == "dark");
    Ok(())
}

#[tauri::command]
fn initial_open_file() -> Option<String> {
    let argv: Vec<String> = std::env::args().collect();
    extract_md_path_from_args(&argv)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Already-running instance: focus window and emit the new file path.
            use tauri::Emitter;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Some(path) = extract_md_path_from_args(&argv) {
                let _ = app.emit("md-reader://open-file", path);
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            app.manage(WatcherState::default());

            let window = app.get_webview_window("main").unwrap();
            let store = app.store(STORAGE_FILE)?;
            if let Some(theme) = store.get(THEME_STORAGE_KEY) {
                if theme.eq("light") {
                    window.set_theme(Some(tauri::Theme::Light))?;
                    apply_windows_frame_theme(&window, false);
                } else if theme.eq("dark") {
                    window.set_theme(Some(tauri::Theme::Dark))?;
                    apply_windows_frame_theme(&window, true);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_md_files,
            start_watch,
            stop_watch,
            search_in_files,
            initial_open_file,
            register_file_associations,
            set_theme_mode,
            set_effective_theme,
            check_pandoc,
            export_with_pandoc,
            pdf_utils::check_pdf_engine,
            pdf_export::export_pdf_via_edge
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Serialize, Clone)]
pub struct PandocInfo {
    pub available: bool,
    pub version: String,
    pub has_xelatex: bool,
}

fn pandoc_cmd() -> Command {
    let mut cmd = Command::new("pandoc");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run_check(program: &str, arg: &str) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.arg(arg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn check_pandoc() -> PandocInfo {
    let pandoc = run_check("pandoc", "--version");
    let xelatex = run_check("xelatex", "--version");
    PandocInfo {
        available: pandoc.is_some(),
        version: pandoc
            .as_ref()
            .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
            .unwrap_or_default(),
        has_xelatex: xelatex.is_some(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub html: String,
    pub out_path: String,
    pub format: String,
    pub title: Option<String>,
    pub reference_doc: Option<String>,
}

#[tauri::command]
fn export_with_pandoc(opts: ExportOptions) -> Result<String, String> {
    let format = opts.format.to_lowercase();
    if !matches!(format.as_str(), "docx" | "html") {
        return Err(format!("Unsupported format: {}", format));
    }

    let tmp_dir = std::env::temp_dir();
    let stamp = current_millis();
    let in_path = tmp_dir.join(format!("md-reader-export-{}.html", stamp));
    std::fs::write(&in_path, &opts.html)
        .map_err(|e| format!("Failed to write temp html: {}", e))?;

    let out_path = PathBuf::from(&opts.out_path);
    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).ok();
        }
    }

    let mut cmd = pandoc_cmd();
    cmd.arg("--from").arg("html");
    cmd.arg("--standalone");
    if let Some(title) = &opts.title {
        cmd.arg("--metadata").arg(format!("title={}", title));
    }
    cmd.arg(&in_path);
    cmd.arg("-o").arg(&out_path);

    if format == "html" {
        cmd.arg("--embed-resources");
    }

    if format == "docx" {
        if let Some(ref_doc) = &opts.reference_doc {
            let p = PathBuf::from(ref_doc);
            if !p.exists() {
                return Err(format!("参考文档不存在: {}", ref_doc));
            }
            cmd.arg("--reference-doc").arg(p);
        }
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to invoke pandoc: {}", e))?;

    let _ = std::fs::remove_file(&in_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("pandoc 失败: {}", stderr.trim()));
    }
    Ok(out_path.to_string_lossy().to_string())
}

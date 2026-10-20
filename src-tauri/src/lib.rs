//! MD Reader 后端主模块。
//!
//! 职责：
//! - 应用装配（插件注册、单实例、窗口可见性保证、macOS odoc 事件处理）
//! - 文件系统命令：目录扫描 / 递归监听 / 全局搜索 / 打开文件
//! - Windows 文件关联注册（HKCU 注册表，绿色版补齐 MSI 安装器的注册能力）
//! - pandoc 导出（HTML/DOCX）；PDF 导出在 `pdf_export` 子模块
//!
//! 维护约定（踩过的坑，详见仓库 AGENTS.md）：
//! - `#[tauri::command]` 函数必须保持私有，标 `pub` 会触发 `__cmd__<name>`
//!   宏重导入冲突（E0255）；
//! - Cargo.toml 的 `crate-type` 只能是 `["rlib"]`；
//! - Windows 上启动外部进程一律加 CREATE_NO_WINDOW 防 cmd 黑窗。

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

/// 与前端 `useTheme.ts` / `useReadingSettings.ts` 共用的 plugin-store 文件名，
/// 改名会导致用户已有设置全部丢失。
const STORAGE_FILE: &str = "settings.json";
/// 主题键。前端写、setup() 读，两端必须一致。
const THEME_STORAGE_KEY: &str = "md-reader-theme";

/// 给窗口框架（标题栏/边框）应用 Windows Mica 材质，随亮暗主题切换。
#[cfg(target_os = "windows")]
fn apply_windows_frame_theme(window: &tauri::WebviewWindow, is_dark: bool) {
    let _ = window_vibrancy::apply_mica(window, Some(is_dark));
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_frame_theme(_window: &tauri::WebviewWindow, _is_dark: bool) {}

/// #32 guard: the main window is created hidden (tauri.conf `visible: false`) and
/// the window-state plugin is normally what shows it during state restore. If
/// that restore errors midway (the plugin swallows the error) the process keeps
/// running with no visible window: double-clicking the exe then does nothing and
/// the exe file stays locked. Make showing the window deterministic instead.
fn ensure_window_visible(window: &tauri::WebviewWindow) {
    // A window restored onto a monitor that no longer exists is "visible" but
    // undetectable for the user; pull it back on-screen first.
    if window.current_monitor().map(|m| m.is_none()).unwrap_or(false) {
        let _ = window.center();
    }
    if !matches!(window.is_visible(), Ok(true)) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 从命令行参数中提取要打开的 Markdown 文件路径。
///
/// 首次启动（setup 里）和单实例回调（第二次双击带文件启动）都走这里。
/// 跳过 `--` 开头的选项参数，取第一个存在且扩展名匹配的文件；能 canonicalize
/// 就返回绝对路径（顺手剥掉 Windows `\\?\` 前缀），失败则原样返回。
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
            // 白名单与 is_markdown_file 保持一致（两处刻意重复：本函数要同时
            // 校验「是文件 + 是 md」避免 canonicalize 无谓开销）。
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

/// 目录扫描结果条目，前端文件树/打开面板直接消费。
#[derive(Debug, Serialize, Clone)]
pub struct MdFile {
    pub path: String,
    pub name: String,
    pub rel_path: String,
    pub size: u64,
    pub modified_ms: i64,
}

/// 全局唯一的文件监听器状态。单 watcher 设计：同一时刻只监听一个根目录，
/// 切换目录时旧的 debounce 后 watcher 被 Drop（置 None）以释放句柄。
#[derive(Default)]
pub struct WatcherState {
    inner: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    current_root: Mutex<Option<PathBuf>>,
}

/// Files delivered via the macOS Open-Document Apple Event (Finder double-click,
/// "Open With"). They arrive as RunEvent::Opened, never through argv, so neither
/// the startup arg scan nor the single-instance callback can see them. Paths are
/// queued here until the frontend drains them on mount (the frontend may not be
/// loaded yet when the first open arrives).
#[derive(Default)]
pub struct OpenedFilesState(Mutex<Vec<String>>);

/// 扩展名白名单判断。md / markdown / mdx / txt 均按 Markdown 渲染。
fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx") | Some("txt")
    )
}

/// 递归扫描 root 目录下的所有 Markdown 文件（文件树数据源）。
///
/// 过滤规则：跳过隐藏目录（`.` 开头）和 node_modules / target 这类大型
/// 生成目录，避免无意义的深递归。结果按相对路径不区分大小写排序，
/// 保证目录内文件排在子目录文件前（视觉上聚合在一起）。
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

/// 开始递归监听 root 目录。文件变更经 300ms 防抖合并后，以路径列表形式
/// emit `md-reader://file-changed` 事件——事件名与前端 `useFileWatcher.ts`
/// 耦合，改名必须两端同步。
///
/// 先置 None 丢弃旧 watcher（切换目录场景），再装新的；防抖避免编辑器
/// 连续保存触发的风暴。
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
                // 注意：Err 是单个 Error 而非可迭代集合（notify 的类型如此）。
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

/// 停止监听并清空当前根目录记录。置 None 即 Drop 旧 watcher。
#[tauri::command]
fn stop_watch(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = None;
    let mut cur = state.current_root.lock().map_err(|e| e.to_string())?;
    *cur = None;
    Ok(())
}

/// 全局搜索命中条目：定位到行/列，preview 为该行前 200 字符的截断。
#[derive(Debug, Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub rel_path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

/// 在 root 目录下所有 Markdown 文件里做纯文本搜索（全局搜索面板数据源）。
///
/// 大小写不敏感时把 needle 和每一行都转小写再 find（比正则简单可靠）；
/// `'outer` 标签让结果达到上限（默认 500）时直接跳出双层循环，防止
/// 大仓库把结果数组撑爆。目录过滤规则与 `list_md_files` 一致。
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

// ===================== Windows 文件关联注册 =====================
// MSI 安装器通过 WiX 已经注册 .md/.markdown/.mdx 关联；这里给绿色版（便携
// exe）提供运行时的等效注册能力（设置页里由用户主动触发）。全部写 HKCU
// （当前用户），不需要管理员权限。

/// 构造带 CREATE_NO_WINDOW 的 Command，避免 reg.exe 等外部工具闪黑窗。
#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 执行一次 `reg add`，失败时返回 reg.exe 的 stderr（或 stdout）。
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

/// 通知 Shell 文件关联发生了变化（刷新资源管理器图标与右键「打开方式」）。
/// ie4uinit -show 是通用的缓存刷新触发器。
#[cfg(target_os = "windows")]
fn notify_shell_assoc_changed() {
    let _ = hidden_command("ie4uinit.exe").arg("-show").output();
}

/// 在 HKCU 下注册 .md/.markdown/.mdx 与本 exe 的关联。写入的注册表布局：
///
/// - `HKCU\Software\Classes\MDReader.Markdown`（ProgID）：文件类型本体——
///   显示名、图标、`shell\open\command` = `"<exe>" "%1"`；
/// - `HKCU\Software\Classes\Applications\md-reader.exe`：应用注册项，
///   提供 FriendlyAppName 和 SupportedTypes（「打开方式」列表显示用）；
/// - `HKCU\Software\Classes\.<ext>`：三个扩展名各自指向 ProgID，并补
///   Content Type / OpenWithProgids / OpenWithList，保证「打开方式→
///   选择默认应用」里能选中 MD Reader。
///
/// ProgID 方案（而非直接写 .md 的默认值指向 exe）是刻意的：不抢占用户的
/// 默认应用设置，仅在候选列表里出现；用户在系统设置里主动设为默认后才接管。
#[cfg(target_os = "windows")]
fn register_windows_file_associations() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = strip_windows_extended_prefix(exe.to_string_lossy().to_string());
    // 打开命令：exe 路径与 %1（被双击的文件）都要加引号，兼容含空格路径。
    let open_command = format!("\"{}\" \"%1\"", exe_path);
    let icon = format!("\"{}\",0", exe_path);
    let prog_id = "MDReader.Markdown";
    let app_key = r"HKCU\Software\Classes\Applications\md-reader.exe";

    // --- ProgID 本体：类型名、友好名、图标 ---
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
    // --- ProgID 的 open 动词：默认动作设为 open，命令行指向本 exe ---
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
    // --- Applications 注册项：「打开方式」列表里显示的应用信息 ---
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

    // --- 每个扩展名：默认值指向 ProgID + Content Type + OpenWith 注册 ---
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

/// 文件关联注册命令（跨平台壳）。Windows 之外的平台返回不支持错误。
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

/// 设置窗口主题模式（用户设置项：亮 / 暗 / 跟随系统）。
/// 传 "system" 时给 `set_theme` 传 None，恢复对操作系统的监听。
#[tauri::command]
fn set_theme_mode(window: tauri::WebviewWindow, theme_mode: String) -> Result<(), String> {
    let theme_option = match theme_mode.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        "system" | _ => None,
    };

    window
        .set_theme(theme_option)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 应用「实际生效」的主题（亮/暗二值，由前端计算 system 落到哪边）。
/// 与 set_theme_mode 的区别：那个管窗口 set_theme（标题栏/滚动条），
/// 这个管 Windows Mica 材质——set_theme 没有 None 之外的粒度，材质
/// 只能按最终亮暗单独应用。
#[tauri::command]
fn set_effective_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    apply_windows_frame_theme(&window, theme == "dark");
    Ok(())
}

/// 首次启动时前端调用：从 argv 里取要打开的文件路径（双击文件/命令行唤起）。
#[tauri::command]
fn initial_open_file() -> Option<String> {
    let argv: Vec<String> = std::env::args().collect();
    extract_md_path_from_args(&argv)
}

/// 前端挂载完成后排空 macOS odoc 队列（见 OpenedFilesState 的注释）。
/// `std::mem::take` 保证一次取走全部，取过的不会重复打开。
#[tauri::command]
fn take_pending_open_files(state: State<'_, OpenedFilesState>) -> Vec<String> {
    let mut queue = state.0.lock().expect("opened files state poisoned");
    std::mem::take(&mut *queue)
}

/// Handles files macOS hands over via RunEvent::Opened (Open-Document Apple
/// Event): focus the window, queue the paths for the frontend and emit the
/// open-file event for the already-mounted listener.
#[cfg(target_os = "macos")]
fn handle_opened_files(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let mut to_emit: Vec<String> = Vec::new();
    {
        let state = app.state::<OpenedFilesState>();
        let mut queue = state.0.lock().expect("opened files state poisoned");
        for url in urls {
            let Ok(path) = url.to_file_path() else {
                continue;
            };
            if !is_markdown_file(&path) {
                continue;
            }
            let path = strip_windows_extended_prefix(path.to_string_lossy().to_string());
            if queue.contains(&path) {
                continue;
            }
            queue.push(path.clone());
            to_emit.push(path);
        }
    }
    for path in to_emit {
        let _ = app.emit("md-reader://open-file", path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Panic diagnostics: a Launch Services launch (Finder double-click) has no
    // stderr, so persist panics with a backtrace to a temp file for triage.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let bt = std::backtrace::Backtrace::force_capture();
        let _ = std::fs::write(
            "/tmp/md-reader-panic.log",
            format!("panic: {info}\nbacktrace:\n{bt}\n"),
        );
        default_hook(info);
    }));

    tauri::Builder::default()
        // Managed at builder level ON PURPOSE: RunEvent::Opened can be delivered
        // before setup() runs (macOS hands the odoc event over during app
        // initialization), and state() would panic on the unmanaged state (#33).
        .manage(OpenedFilesState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Already-running instance: bring the window to the front (even when it is
            // minimized) and emit the new file path so the frontend opens it in a tab.
            use tauri::Emitter;
            if let Some(window) = app.get_webview_window("main") {
                // Restore from the minimized state first.
                let _ = window.unminimize();
                // Make sure it is actually visible.
                let _ = window.show();
                // A window restored onto a disconnected monitor looks like
                // "clicking does nothing" as well; pull it back on-screen.
                if window.current_monitor().map(|m| m.is_none()).unwrap_or(false) {
                    let _ = window.center();
                }
                // Briefly raise to top-most and then drop it back, so Windows'
                // foreground-lock cannot keep the window hidden behind others.
                #[cfg(target_os = "windows")]
                let _ = window.set_always_on_top(true);
                // Move the window into the foreground.
                let _ = window.set_focus();
                #[cfg(target_os = "windows")]
                let _ = window.set_always_on_top(false);
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
        .plugin(tauri_plugin_system_fonts::init())
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

            ensure_window_visible(&window);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_md_files,
            start_watch,
            stop_watch,
            search_in_files,
            initial_open_file,
            take_pending_open_files,
            register_file_associations,
            set_theme_mode,
            set_effective_theme,
            check_pandoc,
            export_with_pandoc,
            pdf_utils::check_pdf_engine,
            pdf_export::export_pdf_via_edge
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 事件循环。macOS 的「打开方式」/Finder 双击走 Open-Document
            // Apple Event，在这里以 RunEvent::Opened 送达（早于 setup 也可能，
            // 所以 OpenedFilesState 必须在 Builder 级 manage）。
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    handle_opened_files(app, &urls);
                }
            }
            // 其他平台没有 odoc 事件，显式消费掉参数避免未使用告警。
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}

/// pandoc 环境探测结果：版本串 + 是否有 xelatex（PDF via LaTeX 才需要）。
#[derive(Debug, Serialize, Clone)]
pub struct PandocInfo {
    pub available: bool,
    pub version: String,
    pub has_xelatex: bool,
}

/// 构造 pandoc 命令。Windows 下必须 CREATE_NO_WINDOW 防 cmd 黑窗。
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

/// 运行 `<program> <arg>` 并取 stdout（探测 pandoc / xelatex 是否在 PATH）。
/// 返回 None 表示命令不存在或执行失败。
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

/// 探测 pandoc 可用性（设置页展示依赖状态用）。
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

/// DOCX/HTML 导出选项。camelCase 对应前端的 outPath / referenceDoc。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub html: String,
    pub out_path: String,
    pub format: String,
    pub title: Option<String>,
    pub reference_doc: Option<String>,
}

/// 用 pandoc 把渲染好的 HTML 转成 DOCX / 单文件 HTML。
/// PDF 分支已刻意移除——PDF 走 Edge headless（见 pdf_export.rs）。
#[tauri::command]
fn export_with_pandoc(opts: ExportOptions) -> Result<String, String> {
    let format = opts.format.to_lowercase();
    if !matches!(format.as_str(), "docx" | "html") {
        return Err(format!("Unsupported format: {}", format));
    }

    // 与 PDF 导出同款策略：输入 HTML 落 %TEMP% ASCII 路径再交给 pandoc，
    // 规避用户路径里的中文/空格问题。
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

    // HTML 单文件导出时把图片等资源内嵌进产物，脱离源目录也能打开。
    if format == "html" {
        cmd.arg("--embed-resources");
    }

    // DOCX 参考模板：用户在设置里选择的样式基准（PDF 样式系统导出用）。
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

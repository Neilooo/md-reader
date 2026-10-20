// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebView2 运行时检查必须在 Tauri 初始化前完成：便携运行时目录检测、
    // 缺失时的中文提示都依赖它（见 lib.rs prepare_windows_webview）。
    #[cfg(windows)]
    {
        if !md_reader_lib::prepare_windows_webview() {
            std::process::exit(1);
        }
    }
    md_reader_lib::run()
}
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::{Deserialize, Serialize};

use crate::pdf_utils::{current_millis, find_edge_executable, path_to_file_url};

#[derive(Debug, Serialize, Clone)]
pub struct PdfExportResult {
    pub out_path: String,
    pub elapsed_ms: u64,
    pub edge_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", content = "message")]
pub enum PdfExportError {
    NoEdge(String),
    EdgeFailed(String),
    IoError(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportOptions {
    pub html: String,
    pub out_path: String,
    pub edge_path: Option<String>,
}

struct EdgeAttemptResult {
    output: Output,
    temp_pdf: PathBuf,
    user_data_dir: PathBuf,
}

fn format_output_diagnostics(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!(
        "exit={:?}\nstderr: {}\nstdout: {}",
        output.status.code(),
        stderr.trim(),
        stdout.trim()
    )
}

/// 等待 PDF 文件达到有效大小。返回实际大小或区分类型的错误。
enum PdfWaitResult {
    Ok(u64),
    FileTooSmall(u64),
    Io(std::io::Error),
}

fn wait_for_valid_pdf(path: &Path, timeout_ms: u64) -> PdfWaitResult {
    let start = std::time::Instant::now();
    loop {
        match std::fs::metadata(path) {
            Ok(meta) if meta.len() > 1024 => return PdfWaitResult::Ok(meta.len()),
            Ok(meta) if start.elapsed().as_millis() >= timeout_ms as u128 => {
                return PdfWaitResult::FileTooSmall(meta.len());
            }
            Err(e) if start.elapsed().as_millis() >= timeout_ms as u128 => {
                return PdfWaitResult::Io(e);
            }
            _ => {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }
}

fn run_edge_print(
    edge: &Path,
    file_url: &str,
    tmp_dir: &Path,
    stamp: u128,
    attempt: u8,
) -> Result<EdgeAttemptResult, PdfExportError> {
    let temp_pdf = tmp_dir.join(format!("md-reader-out-{}-{}.pdf", stamp, attempt));
    let user_data_dir = tmp_dir.join(format!("md-reader-edge-{}-{}", stamp, attempt));
    std::fs::create_dir_all(&user_data_dir)
        .map_err(|e| PdfExportError::IoError(e.to_string()))?;

    let mut cmd = Command::new(edge);
    cmd.arg("--headless=new");
    cmd.arg("--disable-gpu");
    cmd.arg("--no-sandbox");
    cmd.arg("--allow-file-access-from-files");
    cmd.arg("--disable-extensions");
    cmd.arg("--disable-features=IsolateOrigins,site-per-process");
    cmd.arg("--disable-background-networking");
    cmd.arg("--disable-background-timer-throttling");
    cmd.arg("--disable-backgrounding-occluded-windows");
    cmd.arg("--disable-renderer-backgrounding");
    cmd.arg("--disable-dev-shm-usage");
    cmd.arg("--disable-sync");
    cmd.arg("--metrics-recording-only");
    cmd.arg("--no-first-run");
    cmd.arg("--no-default-browser-check");
    cmd.arg("--no-pdf-header-footer");
    cmd.arg("--no-margins");
    cmd.arg("--run-all-compositor-stages-before-draw");
    cmd.arg(format!(
        "--virtual-time-budget={}",
        if attempt >= 3 { 30000 } else { 15000 }
    ));
    cmd.arg(format!("--user-data-dir={}", user_data_dir.display()));
    cmd.arg(format!("--print-to-pdf={}", temp_pdf.display()));
    cmd.arg(file_url);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().map_err(|e| {
        let _ = std::fs::remove_file(&temp_pdf);
        let _ = std::fs::remove_dir_all(&user_data_dir);
        PdfExportError::EdgeFailed(format!("无法启动 Edge: {}", e))
    })?;

    Ok(EdgeAttemptResult {
        output,
        temp_pdf,
        user_data_dir,
    })
}

#[tauri::command]
pub fn export_pdf_via_edge(
    opts: PdfExportOptions,
) -> Result<PdfExportResult, PdfExportError> {
    let edge = find_edge_executable(opts.edge_path.as_deref()).ok_or_else(|| {
        PdfExportError::NoEdge(
            "未找到 Microsoft Edge，请手动选择 msedge.exe 路径".into(),
        )
    })?;

    let tmp_dir = std::env::temp_dir();
    let stamp = current_millis();
    let tmp_html = tmp_dir.join(format!("md-reader-export-{}.html", stamp));
    std::fs::write(&tmp_html, &opts.html)
        .map_err(|e| PdfExportError::IoError(e.to_string()))?;

    let final_out = PathBuf::from(&opts.out_path);
    if let Some(parent) = final_out.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).ok();
        }
    }

    let file_url = path_to_file_url(&tmp_html);
    let start = std::time::Instant::now();
    let mut diagnostics = Vec::new();

    for attempt in 1..=3 {
        let result = run_edge_print(&edge, &file_url, &tmp_dir, stamp, attempt)?;
        let output = result.output;
        let temp_pdf = result.temp_pdf;
        let user_data_dir = result.user_data_dir;
        let detail = format!(
            "attempt {}: {}",
            attempt,
            format_output_diagnostics(&output)
        );

        if output.status.success() {
            match wait_for_valid_pdf(&temp_pdf, 10_000) {
                PdfWaitResult::Ok(size) if size > 1024 => {
                    std::fs::copy(&temp_pdf, &final_out).map_err(|e| {
                        let _ = std::fs::remove_file(&temp_pdf);
                        let _ = std::fs::remove_dir_all(&user_data_dir);
                        let _ = std::fs::remove_file(&tmp_html);
                        PdfExportError::IoError(format!("拷贝 PDF 到目标位置失败: {}", e))
                    })?;
                    let _ = std::fs::remove_file(&temp_pdf);
                    let _ = std::fs::remove_dir_all(&user_data_dir);
                    let _ = std::fs::remove_file(&tmp_html);
                    return Ok(PdfExportResult {
                        out_path: final_out.to_string_lossy().to_string(),
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        edge_path: edge.to_string_lossy().to_string(),
                    });
                }
                PdfWaitResult::FileTooSmall(size) => {
                    diagnostics.push(format!(
                        "{}\nPDF 文件已生成但过小（可能损坏）: {} bytes",
                        detail, size
                    ));
                }
                PdfWaitResult::Io(e) => {
                    diagnostics.push(format!(
                        "{}\n读取 PDF 元数据失败: {}",
                        detail, e
                    ));
                }
                PdfWaitResult::Ok(size) => {
                    // 理论上 wait_for_valid_pdf 不会返回 ≤ 1024 的 Ok，但保留兜底
                    diagnostics.push(format!(
                        "{}\nPDF 文件大小异常: {} bytes",
                        detail, size
                    ));
                }
            }
        } else {
            diagnostics.push(detail);
        }

        let _ = std::fs::remove_file(&temp_pdf);
        let _ = std::fs::remove_dir_all(&user_data_dir);
    }

    Err(PdfExportError::EdgeFailed(format!(
        "Edge headless 连续 3 次未生成有效 PDF。诊断 HTML 已保留: {}\n{}",
        tmp_html.display(),
        diagnostics.join("\n\n")
    )))
}

//! PDF 导出后端：将前端渲染好的 HTML（已含 Mermaid/KaTeX 产物）交给 Edge 无头模式
//! 打印成 PDF。
//!
//! 整体链路：HTML 先写入 %TEMP% 下的 ASCII 临时文件 → Edge `--headless=new` 加载
//! file:// URL 并 `--print-to-pdf` 到临时 PDF → 校验有效后 `fs::copy` 到用户选定的
//! 输出路径。之所以全程走临时路径，是因为用户路径常含中文/空格，会破坏 Edge 对
//! `--print-to-pdf=` 参数的 CLI 解析。
//!
//! 改动本文件前请先阅读仓库根目录 AGENTS.md 的「PDF export quirks」一节——
//! 下面这些坑都是实测踩出来的。

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

/// PDF 导出失败类型。前端按 `kind` 分支处理：`NoEdge` 会引导用户手动选择
/// msedge.exe 并持久化到 localStorage（见 `find_edge_executable` 的 custom 参数）。
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", content = "message")]
pub enum PdfExportError {
    NoEdge(String),
    EdgeFailed(String),
    IoError(String),
}

/// 前端传参为 camelCase（outPath / edgePath），必须配合 `rename_all`。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportOptions {
    pub html: String,
    pub out_path: String,
    pub edge_path: Option<String>,
}

/// 单次 Edge 尝试的产物：进程输出 + 临时 PDF 路径 + 本次独立 user-data 目录。
/// 三者都要在结束时清理，否则 %TEMP% 会堆积残留。
struct EdgeAttemptResult {
    output: Output,
    temp_pdf: PathBuf,
    user_data_dir: PathBuf,
}

/// 把 Edge 进程的 stdout/stderr 拼成诊断文本，失败时随错误消息返回给前端，
/// 也用于多次重试间的对比。
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

/// 等待临时 PDF 落盘并达到有效大小。
///
/// Edge 进程退出码为 0 不代表 PDF 已写完/写好（偶见退出后文件仍在写入，或
/// 只产出了几百字节的空壳）。这里以 1024 字节为“有效”阈值——正常的 PDF
/// 头加一页内容必然超过它，空壳文件则不会。200ms 轮询，默认 10s 超时。
fn wait_for_valid_pdf(path: &Path, timeout_ms: u64) -> std::io::Result<u64> {
    let start = std::time::Instant::now();
    loop {
        match std::fs::metadata(path) {
            Ok(meta) if meta.len() > 1024 => return Ok(meta.len()),
            Ok(_) | Err(_) if start.elapsed().as_millis() < timeout_ms as u128 => {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Ok(meta) => return Ok(meta.len()),
            Err(e) => return Err(e),
        }
    }
}

/// 用 Edge 无头模式把 file_url 打印为 PDF 的一次尝试。
///
/// 注意 temp_pdf / user_data_dir 都带 attempt 编号：每次尝试使用全新的
/// user-data-dir，避免上一次的崩溃残留（缓存锁、半成品状态）影响本次运行。
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
    // Edge ≥ 132 移除了 legacy --headless，静默回退旧参数会打印出空白 PDF，
    // 必须用 --headless=new。
    cmd.arg("--headless=new");
    // 下面这组 flag 是 file:// 页面可靠渲染的前提：
    // --no-sandbox / --allow-file-access-from-files 放开无头环境下的本地文件访问，
    // --disable-features=IsolateOrigins,site-per-process 关掉站点隔离，否则
    // asset:// 内嵌图片等跨源子资源会被拦。
    cmd.arg("--disable-gpu");
    cmd.arg("--no-sandbox");
    cmd.arg("--allow-file-access-from-files");
    cmd.arg("--disable-extensions");
    cmd.arg("--disable-features=IsolateOrigins,site-per-process");
    // 后台节流类 flag：无头环境下防止网络/定时器/渲染进程被降级，
    // 保证 Mermaid/KaTeX 这类异步渲染任务不被冻结。
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
    // --headless=new 必须配合它才能等到首帧绘制完成，否则可能在页面
    // paint 之前就截走空白。
    cmd.arg("--run-all-compositor-stages-before-draw");
    // 虚拟时间预算：让页面跑完所有定时器/异步任务再触发打印。输入 HTML
    // 已是渲染好的产物，这里只是兜底；第 3 次尝试加大预算做最后一搏。
    cmd.arg(format!(
        "--virtual-time-budget={}",
        if attempt >= 3 { 30000 } else { 15000 }
    ));
    cmd.arg(format!("--user-data-dir={}", user_data_dir.display()));
    cmd.arg(format!("--print-to-pdf={}", temp_pdf.display()));
    cmd.arg(file_url);

    // Windows 下必须加 CREATE_NO_WINDOW，否则每次导出都会闪一个 cmd 黑窗。
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

/// 导出 PDF（命令入口）
#[tauri::command(async)]
pub fn export_pdf_via_edge(
    opts: PdfExportOptions,
) -> Result<PdfExportResult, PdfExportError> {
    // 探测顺序：前端持久化的自定义路径 → PATH → 硬编码候选。全 miss 才报
    // NoEdge，前端此时弹出选择框让用户手动指定（不要破坏这个回退链）。
    let edge = find_edge_executable(opts.edge_path.as_deref()).ok_or_else(|| {
        PdfExportError::NoEdge(
            "未找到 Microsoft Edge，请手动选择 msedge.exe 路径".into(),
        )
    })?;

    let tmp_dir = std::env::temp_dir();
    let stamp = current_millis();
    // HTML 落到 %TEMP% 的 ASCII 路径：用户目录若含中文/空格，Edge 的
    // file:// 加载会不可靠，这里从源头规避。
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
    // 收集每次尝试的诊断信息，最终失败时一次性展示，方便定位是启动失败
    // 还是产物无效。
    let mut diagnostics = Vec::new();

    // 最多重试 3 次：Edge 无头偶发首跑失败（退出码非 0 或产出无效 PDF），
    // 且每次尝试都换全新 user-data-dir，重试才有意义。
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
                Ok(size) if size > 1024 => {
                    // 成功路径：先复制到用户目标位置，再统一清理临时产物。
                    // 注意必须先复制后清理，且失败时同样要清理。
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
                Ok(size) => {
                    diagnostics.push(format!(
                        "{}\n等待 PDF 落盘后文件仍过小: {} bytes",
                        detail, size
                    ));
                }
                Err(_) => diagnostics.push(format!(
                    "{}\n等待 10 秒后 PDF 文件仍未生成",
                    detail
                )),
            }
        } else {
            diagnostics.push(detail);
        }

        let _ = std::fs::remove_file(&temp_pdf);
        let _ = std::fs::remove_dir_all(&user_data_dir);
    }

    // 3 次全部失败：诊断 HTML 故意不删，留在 %TEMP% 供用户打开排查
    // （渲染产物本身有问题时，用浏览器打开它即可复现）。
    Err(PdfExportError::EdgeFailed(format!(
        "Edge headless 连续 3 次未生成有效 PDF。诊断 HTML 已保留: {}\n{}",
        tmp_html.display(),
        diagnostics.join("\n\n")
    )))
}

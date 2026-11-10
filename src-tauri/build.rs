fn main() {
    // 注意：tauri-build 不会为 icons/icon.ico 发 rerun-if-changed。更换图标后
    // 必须 touch 本文件（或 cargo clean -p md-reader），否则 exe 里仍是旧图标。
    tauri_build::build()
}
# AGENTS.md

Operational notes for working in this repo. Read this before changing build or PDF/export code.

## Stack

Tauri 2 (Rust) + Vue 3 + TS + Vite. Windows-first; PDF / file association code is Windows-specific.

## Commands

Build / verify (run from repo root):

```powershell
# Rust env on this machine is not on PATH by default
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Frontend
.\node_modules\.bin\vue-tsc.cmd --noEmit       # type check
.\node_modules\.bin\vite.cmd build              # frontend prod build

# Full app build (msi only is faster than "all")
.\node_modules\.bin\tauri.cmd build --bundles msi

# Rust only (fast iteration)
cd src-tauri && cargo check
```

Do **not** run `pnpm tauri build` / `pnpm exec ...` for verification: pnpm wraps the call with `pnpm install` first, which then aborts on the `ERR_PNPM_IGNORED_BUILDS` (esbuild) hook unless `pnpm approve-builds esbuild` has been run. Calling `node_modules/.bin/*` directly bypasses that wrapper.

Lint / format:

```powershell
.\node_modules\.bin\eslint.cmd .
.\node_modules\.bin\prettier.cmd --write "src/**/*.{ts,vue,css,json}"
```

## Hard-earned Rust gotchas

- `#[tauri::command]` functions **must not be `pub`**. Marking them pub triggers `__cmd__<name>` macro re-import errors (E0255). All commands in `src-tauri/src/lib.rs`, `pdf_export.rs`, `pdf_utils.rs` are private on purpose.
- `src-tauri/Cargo.toml` uses `crate-type = ["rlib"]` only. Adding `staticlib` / `cdylib` makes the tauri command macro expand twice and breaks the build.
- `tauri` feature `protocol-asset` **is required** because `tauri.conf.json` enables `assetProtocol`. If you remove this feature, build fails with "allowlist does not match".
- `notify_debouncer_mini::DebounceEventResult` is `Result<Vec<Event>, Error>` — the Err arm is a single `Error`, not iterable.
- Commands use `#[serde(rename_all = "camelCase")]` on struct args because the frontend sends camelCase (e.g. `outPath`, `edgePath`).
- Windows: spawn external processes with `creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) to suppress the cmd flash. See `pandoc_cmd()` and `export_pdf_via_edge`.

## PDF export quirks (`src-tauri/src/pdf_export.rs`)

Re-read this before touching it. We were bitten by all of the following:

- Edge ≥ 132 removed legacy `--headless`. **Must use `--headless=new`**.
- `--headless=new` needs `--run-all-compositor-stages-before-draw` to wait for paint.
- Mermaid/KaTeX rendered HTML is the input; we still pass `--virtual-time-budget=15000` as a safety net.
- The user-chosen output path can contain CJK / spaces, which breaks Edge's `--print-to-pdf=` CLI parsing. We always write to an ASCII temp path under `%TEMP%\md-reader-out-<ms>.pdf`, then `std::fs::copy` to the user path.
- Required extra flags so file:// loads reliably: `--no-sandbox --allow-file-access-from-files --disable-extensions --disable-features=IsolateOrigins,site-per-process`.
- Edge path is auto-detected (`find_edge_executable`); on miss, the frontend prompts the user and persists the choice in `localStorage["md-reader-edge-path"]`. Don't break this fallback.
- DOCX still goes through pandoc (`export_with_pandoc`); the PDF branch was removed deliberately.

## Frontend conventions

- All export-related composables are split into small files to stay within editor string limits: `exportStyles.ts`, `exportInline.ts`, `useExport.ts`, `mathPlugin.ts`. Keep them small if you edit them.
- KaTeX & Mermaid are lazy-imported in `useMarkdown.ts` (dynamic `import()`). Don't change them to static imports — it doubles the main chunk.
- `vite.config.ts` `manualChunks` splits vendor bundles (hljs / markdown-it / vue / tauri). Update it when adding heavy deps.
- DOM is rewritten after render in `useLinkRewriter.ts`: image `src` is converted via `convertFileSrc`, and `.md` links are intercepted to call `loadFile`. Keep the rewrite **idempotent** — it runs again on every render.
- `useFindInPage.ts` walks text nodes and skips `script, style, .math-inline, .math-block, .mermaid-block, .find-highlight`. If you introduce new rendered widgets that contain raw text, add their class here.

## Tauri config gotchas

- `tauri.conf.json` `bundle.fileAssociations[*].description` **must be ASCII** for WiX MSI build (codepage 1252). Don't put Chinese here or `light.exe` fails with LGHT0311.
- `fileAssociations` registers `.md / .markdown / .mdx` via the MSI installer. The .exe (portable) does **not** register file associations.
- Asset scope is `**` in `capabilities/default.json` to allow images from anywhere the user opens. Be aware when reviewing security changes.
- Single-instance plugin: a second invocation re-uses the first window and emits `md-reader://open-file` with the new path. Frontend `App.vue` listens for this on mount.

## Build artifacts & WiX

- `src-tauri/icons/icon.ico` is required for Windows build. The png-only generator we used loses .ico; if regenerating, produce both .png (256) and a multi-resolution .ico.
- WiX toolset auto-download from GitHub releases often fails in CN. Cached at `%LOCALAPPDATA%\tauri\WixTools314\`. If missing, manually extract `wix314-binaries.zip` there.
- Cargo is configured to use USTC mirror in `~/.cargo/config.toml` on this machine. Pure ICE if mirrors go down — switch to crates.io directly.

## Mirrors / network

```toml
# ~/.cargo/config.toml
[source.crates-io]
replace-with = 'ustc'
[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
```

```powershell
# Rustup over USTC mirror
$env:RUSTUP_DIST_SERVER = "https://mirrors.ustc.edu.cn/rust-static"
$env:RUSTUP_UPDATE_ROOT = "https://mirrors.ustc.edu.cn/rust-static/rustup"
```

## Testing

No tests yet. Verification = `cargo check` + `vue-tsc --noEmit` + a manual `tauri build --bundles msi`. Don't claim "tests pass" without these three.

## Git / release

- `main` is the only branch. Direct commit + push is the workflow.
- Tags `vX.Y.Z` correspond to GitHub Releases that carry the `.exe` (portable) and `.msi` (installer) as attachments. Update `CHANGELOG.md` when cutting a tag.
- Don't commit `src-tauri/target`, `dist`, `node_modules`. Already in `.gitignore` but easy to slip with `git add -f`.
- `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are tracked intentionally — keep them in commits.

## File map (only what's non-obvious)

- `src/composables/useExport.ts` — entry for HTML/DOCX/PDF export; calls Rust commands `export_with_pandoc` and `export_pdf_via_edge`.
- `src-tauri/src/pdf_utils.rs` — Edge / Chrome path discovery + `path_to_file_url` (handles `\\?\` UNC prefix).
- `src-tauri/src/lib.rs:extract_md_path_from_args` — used by both `setup` (first launch) and `tauri-plugin-single-instance` (subsequent launches with a path argv).
- `src/App.vue` is large; logic is intentionally split into composables. Add new state there as composables, not inline.

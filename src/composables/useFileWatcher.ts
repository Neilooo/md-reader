/**
 * 文件监听的前端壳：同步「根目录（递归）+ 当前打开的文件（非递归）」监听目标，
 * 并订阅 `md-reader://file-changed` 事件（后端已做 300ms 防抖）。
 *
 * 应用级单 watcher：事件监听只挂一次，sync 只重建后端的监听目标集合。
 * 没有打开文件夹时靠文件列表兜底，保证单独打开的 md 也能自动刷新（#43）。
 * 变更如何分发到各标签见 App.vue 的 onFilesChanged。
 */

import { onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type FileChangeHandler = (paths: string[]) => void;

export function useFileWatcher() {
  // 当前监听的根目录（空串 = 无目录监听）
  const watching = ref<string>("");
  // 当前单独监听的文件数（不含根目录内已覆盖的）
  const watchingFiles = ref<number>(0);
  let unlisten: UnlistenFn | null = null;
  let handler: FileChangeHandler | null = null;

  /** 注册变更回调；只保存引用，事件订阅在首次 sync 时建立。 */
  function onChanged(h: FileChangeHandler) {
    handler = h;
  }

  /**
   * 同步监听目标。root 为空串表示只看文件；files 传当前打开标签的路径。
   * 反复调用是幂等的，不会重复挂事件监听。
   */
  async function sync(root: string, files: string[]) {
    if (!handler) return;
    if (!unlisten) {
      unlisten = await listen<string[]>("md-reader://file-changed", (event) => {
        handler?.(event.payload);
      });
    }
    await invoke("set_watch_targets", {
      root: root || null,
      files,
    });
    watching.value = root;
    watchingFiles.value = files.length;
  }

  /** 停止监听并移除回调（关文件夹/卸载时不需要，仅卸载时清理）。 */
  async function stop() {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
    handler = null;
    try {
      await invoke("stop_watch");
    } catch {
      /* ignore: 后端 watcher 已失效时静默 */
    }
    watching.value = "";
    watchingFiles.value = 0;
  }

  onUnmounted(() => {
    void stop();
  });

  return { watching, watchingFiles, onChanged, sync, stop };
}

import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface MdFile {
  path: string;
  name: string;
  rel_path: string;
  size: number;
  modified_ms: number;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: MdFile;
}

const rootDir = ref<string>("");
const files = ref<MdFile[]>([]);
const loading = ref<boolean>(false);
const error = ref<string>("");

function buildTree(items: MdFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const f of items) {
    const parts = f.rel_path.split(/[\\/]/);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.children!.push({
          name: part,
          path: f.path,
          isDir: false,
          file: f,
        });
      } else {
        let next = cur.children!.find((c) => c.isDir && c.name === part);
        if (!next) {
          next = {
            name: part,
            path: parts.slice(0, i + 1).join("/"),
            isDir: true,
            children: [],
          };
          cur.children!.push(next);
        }
        cur = next;
      }
    }
  }
  sortNode(root);
  return root.children!;
}

function sortNode(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
  node.children.forEach(sortNode);
}

const tree = computed<TreeNode[]>(() => buildTree(files.value));

async function refresh(): Promise<void> {
  if (!rootDir.value) return;
  loading.value = true;
  error.value = "";
  try {
    const list = await invoke<MdFile[]>("list_md_files", {
      root: rootDir.value,
    });
    files.value = list;
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    loading.value = false;
  }
}

async function openFolder(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true });
  if (typeof selected === "string") {
    rootDir.value = selected;
    localStorage.setItem("md-reader-root", selected);
    await refresh();
    return selected;
  }
  return null;
}

async function restoreRoot(): Promise<void> {
  const saved = localStorage.getItem("md-reader-root");
  if (saved) {
    rootDir.value = saved;
    await refresh();
  }
}

function clearRoot(): void {
  rootDir.value = "";
  files.value = [];
  localStorage.removeItem("md-reader-root");
}

export function useFileTree() {
  return {
    rootDir,
    files,
    tree,
    loading,
    error,
    refresh,
    openFolder,
    restoreRoot,
    clearRoot,
  };
}

/**
 * FileTree 组件测试
 *
 * 测试目标：
 * - currentPath 变化时自动展开父目录
 * - 当前文件在树中高亮 (.active)
 * - 切换 tab 时 currentPath 更新触发重新展开定位
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import FileTree from "../components/FileTree.vue";
import type { TreeNode } from "../composables/useFileTree";

// ─── Mock TreeNode 工厂 ───────────────────────────────────────

function makeDir(name: string, path: string, children?: TreeNode[]): TreeNode {
  return { name, path, isDir: true, children };
}

function makeFile(name: string, path: string): TreeNode {
  return { name, path, isDir: false, file: { path, name, rel_path: "", size: 0, modified_ms: 0 } };
}

// 构建一个嵌套目录树：
// root/
//   docs/
//     guide.md
//     advanced/
//       plugin.md
//   README.md

const sampleNodes: TreeNode[] = [
  makeDir("docs", "/root/docs", [
    makeFile("guide.md", "/root/docs/guide.md"),
    makeDir("advanced", "/root/docs/advanced", [
      makeFile("plugin.md", "/root/docs/advanced/plugin.md"),
    ]),
  ]),
  makeFile("README.md", "/root/README.md"),
];

// ─── 测试 ─────────────────────────────────────────────────────

describe("FileTree", () => {
  let wrapper: VueWrapper;
  let mockScrollIntoView: ReturnType<typeof vi.fn>;

  function renderTree(nodes: TreeNode[], currentPath = "") {
    const w = mount(FileTree, {
      props: { nodes, currentPath },
      attachTo: document.body,
    });
    mockScrollContainer.appendChild(w.element);
    return w;
  }

  let mockScrollContainer: HTMLElement;

  beforeEach(() => {
    mockScrollIntoView = vi.fn();
    (window.HTMLElement.prototype as any).scrollIntoView = mockScrollIntoView;
    vi.clearAllMocks();
    delete (window as any).__treeScrollContainer;
    mockScrollContainer = document.createElement("div");
    mockScrollContainer.className = "tree-scroll";
    document.body.appendChild(mockScrollContainer);
    (window as any).__treeScrollContainer = mockScrollContainer;
  });

  afterEach(() => {
    wrapper?.unmount();
    mockScrollContainer.remove();
    delete (window as any).__treeScrollContainer;
    delete (window.HTMLElement.prototype as any).scrollIntoView;
  });

  // ─── 基础渲染 ────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders root-level files when currentPath is empty", () => {
      wrapper = renderTree(sampleNodes, "");
      expect(wrapper.find(".tree.root").exists()).toBe(true);
      expect(wrapper.findAll(".file").length).toBe(3);
    });

    it("renders nested directories with collapsed state", () => {
      wrapper = renderTree(sampleNodes, "");
      expect(wrapper.findAll(".dir").length).toBe(2);
    });
  });

  // ─── currentPath 高亮 ────────────────────────────────────────

  describe("active highlighting", () => {
    it("marks the current file as active", () => {
      wrapper = renderTree(sampleNodes, "/root/docs/guide.md");
      const active = wrapper.find(".row.file.active");
      expect(active.exists()).toBe(true);
      expect(active.find(".name").text()).toBe("guide.md");
    });

    it("does not mark non-current files as active", () => {
      wrapper = renderTree(sampleNodes, "/root/docs/guide.md");
      const readmeFile = wrapper.findAll(".row.file").find((el) =>
        el.find(".name").text() === "README.md"
      );
      expect(readmeFile?.classes("active")).toBe(false);
    });
  });

  // ─── 核心：currentPath 变化时自动展开父目录 ───────────────────

  describe("auto-expand parent directories on currentPath change", () => {
    it("auto-expands parent directories when currentPath is set to a deeply nested file", async () => {
      wrapper = renderTree(sampleNodes, "");
      expect(wrapper.find(".row.file.active").exists()).toBe(false);

      await wrapper.setProps({ currentPath: "/root/docs/advanced/plugin.md" });
      await wrapper.vm.$nextTick();
      await new Promise((r) => setTimeout(r, 100));

      // 1. 目标文件存在且高亮
      const active = wrapper.find(".row.file.active");
      expect(active.exists()).toBe(true);
      expect(active.find(".name").text()).toBe("plugin.md");

      expect(wrapper.findAll(".dir")[0]?.find(".caret")?.text()).toBe("▼");

      // 3. "advanced" 目录已展开
      const advancedCaret = wrapper.findAll(".dir")[1]?.find(".caret");
      expect(advancedCaret?.text()).toBe("▼");

      // 4. scrollIntoView 被调用（定位目标文件）
      expect(mockScrollIntoView).toHaveBeenCalled();
    });

    it("auto-expands only necessary directories (not all directories)", async () => {
      wrapper = renderTree(sampleNodes, "");
      await wrapper.setProps({ currentPath: "/root/docs/guide.md" });
      await wrapper.vm.$nextTick();

      // "docs" 目录展开
      const docsCaret = wrapper.findAll(".dir")[0]?.find(".caret");
      expect(docsCaret?.text()).toBe("▼");

      // "advanced" 目录不应展开
      const advancedCaret = wrapper.findAll(".dir")[1]?.find(".caret");
      expect(advancedCaret?.text()).toBe("▶");
    });

    it("works for root-level files without expanding any directory", async () => {
      wrapper = renderTree(sampleNodes, "");
      await wrapper.setProps({ currentPath: "/root/README.md" });
      await wrapper.vm.$nextTick();
      await new Promise((r) => setTimeout(r, 100));

      const active = wrapper.find(".row.file.active");
      expect(active.exists()).toBe(true);
      expect(active.find(".name").text()).toBe("README.md");
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });

  // ─── Tab 切换场景 ────────────────────────────────────────────

  describe("tab switching scenario", () => {
    it("re-expands directories and scrolls when switching between tabs", async () => {
      wrapper = renderTree(sampleNodes, "/root/docs/guide.md");
      await wrapper.vm.$nextTick();
      await new Promise((r) => setTimeout(r, 100));
      vi.clearAllMocks();

      expect(wrapper.find(".row.file.active").find(".name").text()).toBe("guide.md");
      expect(wrapper.findAll(".dir")[0]?.find(".caret")?.text()).toBe("▼");

      await wrapper.setProps({ currentPath: "/root/docs/advanced/plugin.md" });
      await wrapper.vm.$nextTick();
      await new Promise((r) => setTimeout(r, 100));

      expect(wrapper.find(".row.file.active").find(".name").text()).toBe("plugin.md");
      expect(wrapper.findAll(".dir")[1]?.find(".caret")?.text()).toBe("▼");
      expect(mockScrollIntoView).toHaveBeenCalled();
    });

    it("collapses previously expanded directories when switching to a different branch", async () => {
      wrapper = renderTree(sampleNodes, "/root/docs/advanced/plugin.md");
      await wrapper.vm.$nextTick();
      vi.clearAllMocks();

      expect(wrapper.findAll(".dir")[0]?.find(".caret")?.text()).toBe("▼");
      expect(wrapper.findAll(".dir")[1]?.find(".caret")?.text()).toBe("▼");

      await wrapper.setProps({ currentPath: "/root/docs/guide.md" });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll(".dir")[0]?.find(".caret")?.text()).toBe("▼");
      expect(wrapper.findAll(".dir")[1]?.find(".caret")?.text()).toBe("▶");
    });
  });

  // ─── 边缘情况 ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("does not crash when currentPath is empty", () => {
      wrapper = renderTree(sampleNodes, "");
      expect(wrapper.find(".row.file.active").exists()).toBe(false);
    });

    it("does not crash when currentPath points to a non-existent file", () => {
      wrapper = renderTree(sampleNodes, "/nonexistent/file.md");
      expect(wrapper.find(".row.file.active").exists()).toBe(false);
    });

    it("handles flat file list without directories", () => {
      const flatNodes: TreeNode[] = [
        makeFile("a.md", "/root/a.md"),
        makeFile("b.md", "/root/b.md"),
      ];
      wrapper = renderTree(flatNodes, "/root/a.md");
      expect(wrapper.find(".row.file.active").find(".name").text()).toBe("a.md");
    });
  });
});

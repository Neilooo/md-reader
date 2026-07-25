/**
 * useTabs 测试
 *
 * 测试目标:
 * - Tab 创建时默认 staleSince = null
 * - staleSince 可被设置为 number 或 null
 */

import { describe, it, expect } from "vitest";
import { useTabs, normalizePath, samePath, type Tab } from "./useTabs";

describe("Tab", () => {
  describe("staleSince 字段", () => {
    it("createTab 创建的 Tab 默认 staleSince 为 null", () => {
      const { createTab } = useTabs();
      const tab = createTab("/root/test.md");
      expect(tab.staleSince).toBe(null);
    });

    it("Tab 对象包含 staleSince 属性", () => {
      const tab: Tab = {
        id: "tab-test-1",
        path: "/root/test.md",
        content: "# Hello",
        draftContent: "# Hello",
        isDirty: false,
        isEditing: false,
        headings: [],
        scrollTop: 0,
        pendingHash: "",
        pendingScrollTop: 0,
        pendingSourceLine: 0,
        staleSince: null,
      };
      expect(tab.staleSince).toBe(null);
    });

    it("staleSince 可被设置为 number 时间戳", () => {
      const { createTab } = useTabs();
      const tab = createTab("/root/test.md");
      const timestamp = Date.now();
      tab.staleSince = timestamp;
      expect(tab.staleSince).toBe(timestamp);
    });

    it("staleSince 可被重置为 null", () => {
      const { createTab } = useTabs();
      const tab = createTab("/root/test.md");
      tab.staleSince = Date.now();
      tab.staleSince = null;
      expect(tab.staleSince).toBe(null);
    });
  });
});

describe("normalizePath", () => {
  it("normalizePath 转换反斜杠为斜杠并转小写", () => {
    expect(normalizePath("C:\\Users\\Test\\file.md")).toBe("c:/users/test/file.md");
  });

  it("normalizePath 对于已标准化的路径不改变", () => {
    expect(normalizePath("/root/file.md")).toBe("/root/file.md");
  });
});

describe("samePath", () => {
  it("samePath 比较相同路径返回 true", () => {
    expect(samePath("/root/file.md", "/root/file.md")).toBe(true);
  });

  it("samePath 比较不同大小写返回 true", () => {
    expect(samePath("/root/file.md", "/root/FILE.md")).toBe(true);
  });

  it("samePath 比较不同路径返回 false", () => {
    expect(samePath("/root/file.md", "/root/other.md")).toBe(false);
  });
});

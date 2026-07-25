/**
 * DiffView 组件测试
 *
 * 测试目标:
 * - 渲染 diff 内容
 * - 显示新增行（绿色）
 * - 显示删除行（红色）
 * - 关闭时 emit close 事件
 * - 无 diff 时显示提示
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import DiffView from "./DiffView.vue";

const i18n = createI18n({
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      diff: {
        title: "差异对比",
        close: "关闭",
        noChanges: "无变化",
        added: "新增",
        removed: "删除",
      },
    },
  },
});

describe("DiffView", () => {
  let wrapper: ReturnType<typeof mount>;
  let mockClose: () => void;

  beforeEach(() => {
    mockClose = vi.fn() as unknown as () => void;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function renderDiff(
    oldContent: string,
    newContent: string,
    visible = true
  ) {
    wrapper = mount(DiffView, {
      global: {
        plugins: [i18n],
      },
      props: {
        oldContent,
        newContent,
        fileName: "test.md",
        visible,
        onClose: mockClose,
      },
    });
  }

  describe("渲染", () => {
    it("visible 为 true 时渲染 diff 容器", () => {
      renderDiff("# Hello", "# Hello World");
      expect(wrapper.find(".diff-view").exists()).toBe(true);
    });

    it("visible 为 false 时不渲染 diff 容器", () => {
      renderDiff("# Hello", "# Hello World", false);
      expect(wrapper.find(".diff-view").exists()).toBe(false);
    });

    it("渲染标题和文件名", () => {
      renderDiff("# Hello", "# Hello World");
      expect(wrapper.find(".diff-title").text()).toContain("差异对比");
      expect(wrapper.find(".diff-filename").text()).toContain("test.md");
    });
  });

  describe("diff 输出", () => {
    it("显示无变化时提示", () => {
      renderDiff("# Hello", "# Hello");
      expect(wrapper.find(".diff-empty").exists()).toBe(true);
    });

    it("显示新增行（绿色）", () => {
      renderDiff("# Hello\n", "# Hello\nWorld\n");
      const addedLines = wrapper.findAll(".diff-line.added");
      expect(addedLines.length).toBeGreaterThan(0);
      expect(addedLines[0]?.text()).toContain("World");
    });

    it("显示删除行（红色）", () => {
      renderDiff("# Hello\nWorld\n", "# Hello\n");
      const removedLines = wrapper.findAll(".diff-line.removed");
      expect(removedLines.length).toBeGreaterThan(0);
      expect(removedLines[0]?.text()).toContain("World");
    });
  });

  describe("事件", () => {
    it("点击关闭按钮 emit onClose", async () => {
      renderDiff("# Hello", "# Hello World");
      await wrapper.find("[data-action='close']").trigger("click");
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});

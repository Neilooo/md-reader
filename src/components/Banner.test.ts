/**
 * Banner 组件测试
 *
 * 测试目标:
 * - 渲染状态消息
 * - 渲染四个操作按钮: 重新加载、查看差异、忽略、启用自动重载
 * - 点击按钮时 emit 正确事件
 * - 不显示时不渲染内容
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import Banner from "./Banner.vue";
import type { Tab } from "../composables/useTabs";

// 全局 i18n 实例
const i18n = createI18n({
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      editor: {
        externalChangedTitle: "文件已在外部修改",
      },
      banner: {
        reload: "重新加载",
        viewDiff: "查看差异",
        ignore: "忽略",
        autoReload: "启用自动重载",
      },
    },
  },
});

// 测试用的 Tab 工厂
function makeTab(id = "tab-1", path = "/root/test.md", staleSince = null): Tab {
  return {
    id,
    path,
    content: "# Hello",
    draftContent: "# Hello",
    isDirty: false,
    isEditing: false,
    headings: [],
    scrollTop: 0,
    pendingHash: "",
    pendingScrollTop: 0,
    pendingSourceLine: 0,
    staleSince,
  };
}

describe("Banner", () => {
  let wrapper: ReturnType<typeof mount>;
  let mockFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFn = vi.fn();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function renderBanner(tab: Tab, visible = true) {
    wrapper = mount(Banner, {
      global: {
        plugins: [i18n],
      },
      props: {
        tab,
        visible,
        onReload: mockFn,
        onViewDiff: mockFn,
        onIgnore: mockFn,
        onAutoReload: mockFn,
      },
    });
  }

  describe("渲染", () => {
    it("visible 为 true 时渲染 banner 容器", () => {
      renderBanner(makeTab());
      expect(wrapper.find(".banner").exists()).toBe(true);
    });

    it("visible 为 false 时不渲染 banner 容器", () => {
      renderBanner(makeTab(), false);
      expect(wrapper.find(".banner").exists()).toBe(false);
    });

    it("渲染文件名", () => {
      renderBanner(makeTab("tab-1", "/root/test.md"));
      expect(wrapper.find(".banner-filename").text()).toContain("test.md");
    });

    it("渲染状态消息提示", () => {
      renderBanner(makeTab());
      expect(wrapper.find(".banner-message").exists()).toBe(true);
    });
  });

  describe("按钮渲染", () => {
    it("渲染重新加载按钮", () => {
      renderBanner(makeTab());
      expect(wrapper.find("[data-action='reload']").exists()).toBe(true);
    });

    it("渲染查看差异按钮", () => {
      renderBanner(makeTab());
      expect(wrapper.find("[data-action='view-diff']").exists()).toBe(true);
    });

    it("渲染忽略按钮", () => {
      renderBanner(makeTab());
      expect(wrapper.find("[data-action='ignore']").exists()).toBe(true);
    });

    it("渲染启用自动重载按钮", () => {
      renderBanner(makeTab());
      expect(wrapper.find("[data-action='auto-reload']").exists()).toBe(true);
    });
  });

  describe("事件", () => {
    it("点击重新加载按钮 emit onReload", async () => {
      renderBanner(makeTab());
      await wrapper.find("[data-action='reload']").trigger("click");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("点击查看差异按钮 emit.onViewDiff", async () => {
      renderBanner(makeTab());
      await wrapper.find("[data-action='view-diff']").trigger("click");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("点击忽略按钮 emit onIgnore", async () => {
      renderBanner(makeTab());
      await wrapper.find("[data-action='ignore']").trigger("click");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("点击启用自动重载按钮 emit onAutoReload", async () => {
      renderBanner(makeTab());
      await wrapper.find("[data-action='auto-reload']").trigger("click");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });
});

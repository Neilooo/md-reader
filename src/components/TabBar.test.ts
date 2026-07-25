/**
 * TabBar 组件测试
 *
 * 测试目标:
 * - 渲染 tab 列表
 * - stale tab 显示 (!) 警告标记
 * - 非 stale tab 不显示 (!) 标记
 * - 当前活动 tab 正确高亮
 * - 未修改 tab 显示干净状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TabBar from "./TabBar.vue";
import type { Tab } from "../composables/useTabs";

const i18n = createI18n({
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      app: { noFile: "未打开文件" },
      tabs: { close: "关闭标签" },
    },
  },
});

function makeTab(
  id = "tab-1",
  path = "/root/test.md",
  isDirty = false,
  staleSince: number | null = null
): Tab {
  return {
    id,
    path,
    content: "# Hello",
    draftContent: "# Hello",
    isDirty,
    isEditing: false,
    headings: [],
    scrollTop: 0,
    pendingHash: "",
    pendingScrollTop: 0,
    pendingSourceLine: 0,
    staleSince,
  };
}

describe("TabBar", () => {
  let wrapper: ReturnType<typeof mount>;
  let mockActivate: (id: string) => void;
  let mockClose: (id: string) => void;

  beforeEach(() => {
    mockActivate = vi.fn() as any;
    mockClose = vi.fn() as any;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function renderTabBar(
    tabs: Tab[],
    activeTabId = "tab-1",
    autoReload: string[] = []
  ) {
    wrapper = mount(TabBar, {
      global: {
        plugins: [i18n],
      },
      props: {
        tabs,
        activeTabId,
        autoReload,
        "onActivate": mockActivate,
        "onClose": mockClose,
      },
    });
  }

  describe("基础渲染", () => {
    it("渲染 tab 列表", () => {
      const tabs = [makeTab("tab-1"), makeTab("tab-2", "/root/other.md")];
      renderTabBar(tabs);
      expect(wrapper.findAll(".tab-item").length).toBe(2);
    });

    it("当前活动 tab 正确高亮", () => {
      const tabs = [makeTab("tab-1"), makeTab("tab-2", "/root/other.md")];
      renderTabBar(tabs, "tab-2");
      expect(wrapper.find(".tab-item.active").find(".name").text()).toBe("other.md");
    });
  });

  describe("stale 警告标记", () => {
    it("stale tab 显示 (!) 警告标记", () => {
      const tabs = [makeTab("tab-1", "/root/test.md", false, Date.now())];
      renderTabBar(tabs);
      expect(wrapper.find(".stale-warning").exists()).toBe(true);
    });

    it("非 stale tab 不显示 (!) 标记", () => {
      const tabs = [makeTab("tab-1", "/root/test.md", false, null)];
      renderTabBar(tabs);
      expect(wrapper.find(".stale-warning").exists()).toBe(false);
    });

    it("dirty tab 不显示 stale 标记", () => {
      const tabs = [makeTab("tab-1", "/root/test.md", true, Date.now())];
      renderTabBar(tabs);
      expect(wrapper.find(".stale-warning").exists()).toBe(false);
    });

    it("auto-reload 白名单中的 stale tab 不显示警告标记", () => {
      const tabs = [makeTab("tab-1", "/root/test.md", false, Date.now())];
      renderTabBar(tabs, "tab-1", ["/root/test.md"]);
      expect(wrapper.find(".stale-warning").exists()).toBe(false);
    });
  });

  describe("点击事件", () => {
    it("点击 tab 触发 activate 事件", async () => {
      const tabs = [makeTab("tab-1"), makeTab("tab-2", "/root/other.md")];
      renderTabBar(tabs);
      const tab2 = wrapper.findAll(".tab-item")[1];
      await tab2.trigger("click");
      expect(mockActivate).toHaveBeenCalledWith("tab-2");
    });

    it("点击关闭按钮触发 close 事件", async () => {
      const tabs = [makeTab("tab-1")];
      renderTabBar(tabs);
      await wrapper.find(".close").trigger("click");
      expect(mockClose).toHaveBeenCalledWith("tab-1");
    });
  });
});

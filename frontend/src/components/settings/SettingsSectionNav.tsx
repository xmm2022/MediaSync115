import type { LucideIcon } from "lucide-react";
import { Cloud, Database, HeartPulse, Key, Search, Send, Server, Terminal } from "lucide-react";
import type { SettingsSection } from "./types";

type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  desc: string;
};

const SETTINGS_NAV_ITEMS = [
  { id: "cloud", label: "网盘集成", icon: Cloud, desc: "115/夸克账号与目录" },
  { id: "media", label: "媒体服务", icon: Server, desc: "Emby/飞牛/MoviePilot" },
  { id: "resources", label: "资源与元数据", icon: Search, desc: "TMDB/资源站/展示源" },
  { id: "telegram", label: "Telegram", icon: Send, desc: "Client / Bot / 索引" },
  { id: "automation", label: "订阅与归档", icon: Database, desc: "策略、规则与追更" },
  { id: "system", label: "网络与系统", icon: HeartPulse, desc: "代理、体检与升级" },
  { id: "security", label: "安全与偏好", icon: Key, desc: "账号密码" },
  { id: "logs", label: "操作日志", icon: Terminal, desc: "查看与维护日志" },
] satisfies SettingsNavItem[];

export default function SettingsSectionNav({
  activeTab,
  onChange,
}: {
  activeTab: SettingsSection;
  onChange: (section: SettingsSection) => void;
}) {
  return (
    <div className="lg:col-span-3 flex flex-row lg:flex-col gap-1.5 overflow-x-auto no-scrollbar lg:sticky lg:top-20 pb-2 lg:pb-0 shrink-0">
      {SETTINGS_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isTabActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all glass-hover shrink-0 lg:shrink cursor-pointer"
            style={
              isTabActive
                ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" }
                : { color: "var(--txt-secondary)", background: "transparent" }
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            <div className="hidden lg:block text-left">
              <p className="text-xs font-black leading-none">{item.label}</p>
              <p className="text-[9px] font-semibold mt-1 opacity-70 leading-none">{item.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

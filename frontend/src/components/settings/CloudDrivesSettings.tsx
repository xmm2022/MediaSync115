import type { Dispatch, SetStateAction } from "react";
import { Cloud, QrCode, RefreshCw } from "lucide-react";
import {
  FALLBACK_PAN115_QR_LOGIN_APPS,
  type Pan115QrLoginAppOption,
} from "../../utils/pan115QrLogin";

type StringSetter = Dispatch<SetStateAction<string>>;
type ActionHandler = () => void | Promise<void>;

type CloudDrivesSettingsProps = {
  busy: {
    isBusy: (key: string) => boolean;
  };
  pan115: {
    cookie: string;
    setCookie: StringSetter;
    transferDefaultFolderId: string;
    setTransferDefaultFolderId: StringSetter;
    transferDefaultFolderName: string;
    setTransferDefaultFolderName: StringSetter;
    offlineDefaultFolderId: string;
    setOfflineDefaultFolderId: StringSetter;
    offlineDefaultFolderName: string;
    setOfflineDefaultFolderName: StringSetter;
    qrToken: string | null;
    qrImage: string | null;
    qrStatus: string | null;
    qrPolling: boolean;
    qrApps: Pan115QrLoginAppOption[];
    qrApp: string;
    setQrApp: StringSetter;
    qrAppsLoading: boolean;
    isTesting: boolean;
  };
  storage: {
    localMountPath: string;
    setLocalMountPath: StringSetter;
  };
  quark: {
    cookie: string;
    setCookie: StringSetter;
    defaultFolderId: string;
    setDefaultFolderId: StringSetter;
    defaultFolderName: string;
    setDefaultFolderName: StringSetter;
  };
  actions: {
    test115Connection: ActionHandler;
    startPan115QrLogin: ActionHandler;
    cancelPan115QrLogin: ActionHandler;
    savePan115DefaultFolders: ActionHandler;
    saveQuarkSettings: ActionHandler;
    checkQuarkCookie: ActionHandler;
  };
};

export default function CloudDrivesSettings({
  busy,
  pan115,
  storage,
  quark,
  actions,
}: CloudDrivesSettingsProps) {
  const qrLoginAppOptions = pan115.qrApps.length > 0
    ? pan115.qrApps
    : FALLBACK_PAN115_QR_LOGIN_APPS;
  const selectedQrLoginApp = qrLoginAppOptions.find((item) => item.value === pan115.qrApp) || qrLoginAppOptions[0];
  const qrLoginHint = selectedQrLoginApp?.hint || (pan115.qrAppsLoading ? "正在加载客户端列表…" : "");

  return (
    <div className="space-y-6">
      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Cloud className="w-4 h-4 text-brand-primary" />
          115 云盘授权设置
        </h3>
        <div className="space-y-3">
          <label className="space-y-1 block">
            <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>115 浏览器 Cookie 原始字符串 (全字段) *</span>
            <textarea
              rows={3}
              placeholder="键入您的 115 浏览器 Cookie 原始串 (包含 UID, CID, SEID...)"
              value={pan115.cookie}
              onChange={(e) => pan115.setCookie(e.target.value)}
              className="w-full text-xs font-mono p-3 resize-none input-premium"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>NAS 统筹媒体存储绝对路径 (strm 保存点) *</span>
            <input
              type="text"
              placeholder="e.g. /volume1/Media"
              value={storage.localMountPath}
              onChange={(e) => storage.setLocalMountPath(e.target.value)}
              className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
            />
          </label>
          <div className="pt-2">
            <button
              type="button"
              onClick={actions.test115Connection}
              disabled={pan115.isTesting}
              className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${pan115.isTesting ? "animate-spin" : ""}`} />
              <span>{pan115.isTesting ? "正与网盘连接建立中..." : "测试 115 API 会话可用性"}</span>
            </button>
          </div>
          <div className="rounded-2xl p-4 space-y-3 border" style={{ background: "var(--surface-subtle)", borderColor: "var(--border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                  <QrCode className="w-3.5 h-3.5" />
                  115 扫码登录
                </p>
                <p className="text-[10px] mt-1" style={{ color: "var(--txt-muted)" }}>
                  扫码成功后后端会刷新 115 Cookie；文件工作台只使用当前账号执行文件、离线和转存操作。
                </p>
              </div>
              <button
                type="button"
                onClick={actions.startPan115QrLogin}
                disabled={pan115.qrPolling}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer"
              >
                {pan115.qrPolling ? "轮询中…" : "启动扫码"}
              </button>
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-pan115-qr-login-app" className="text-[9px] font-black" style={{ color: "var(--txt-muted)" }}>
                登录客户端
              </label>
              <select
                id="settings-pan115-qr-login-app"
                value={pan115.qrApp}
                onChange={(event) => pan115.setQrApp(event.target.value)}
                disabled={pan115.qrAppsLoading || pan115.qrPolling || Boolean(pan115.qrToken)}
                title={qrLoginHint}
                className="w-full rounded-lg px-2 py-1.5 text-[10px] font-bold focus:outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "var(--surface)", color: "var(--txt)", border: "1px solid var(--border)" }}
              >
                {qrLoginAppOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {qrLoginHint ? (
                <p className="text-[9px] leading-snug font-semibold" style={{ color: "var(--txt-muted)" }}>{qrLoginHint}</p>
              ) : null}
              <p className="text-[9px] leading-snug font-semibold" style={{ color: "var(--txt-muted)" }}>
                115 手机确认页可能显示通用 Web 登录文案；最终设备类型以这里选择的客户端和 115 后台登录记录为准。
              </p>
            </div>
            {pan115.qrImage && (
              <div className="inline-block p-2 bg-white rounded-lg border">
                <img src={pan115.qrImage} alt="115 扫码登录二维码" className="w-32 h-32" />
              </div>
            )}
            {pan115.qrStatus && (
              <p className="text-[10px] font-bold" style={{ color: "var(--brand-primary)" }}>{pan115.qrStatus}</p>
            )}
            {pan115.qrToken && (
              <button
                type="button"
                onClick={actions.cancelPan115QrLogin}
                className="text-[10px] font-bold cursor-pointer"
                style={{ color: "var(--accent-danger)" }}
              >
                取消扫码登录
              </button>
            )}
          </div>
          <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-xs font-black" style={{ color: "var(--txt)" }}>115 默认目标目录</p>
              <p className="text-[10px] mt-1" style={{ color: "var(--txt-muted)" }}>
                分享转存和离线下载分别使用不同默认目录；归档监听/输出目录在“订阅与归档”中配置。
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>分享转存默认目录 Folder ID</span>
                <input value={pan115.transferDefaultFolderId} onChange={(e) => pan115.setTransferDefaultFolderId(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>分享转存默认目录名称</span>
                <input value={pan115.transferDefaultFolderName} onChange={(e) => pan115.setTransferDefaultFolderName(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>离线下载默认目录 Folder ID</span>
                <input value={pan115.offlineDefaultFolderId} onChange={(e) => pan115.setOfflineDefaultFolderId(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>离线下载默认目录名称</span>
                <input value={pan115.offlineDefaultFolderName} onChange={(e) => pan115.setOfflineDefaultFolderName(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
              </label>
            </div>
            <button
              type="button"
              onClick={actions.savePan115DefaultFolders}
              disabled={busy.isBusy("pan115DefaultFoldersSave")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer"
            >
              保存 115 默认目录
            </button>
          </div>
        </div>
      </div>

      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Cloud className="w-4 h-4 text-blue-500" />
          夸克网盘授权集成
        </h3>
        <div className="space-y-3">
          <label className="space-y-1 block">
            <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>夸克网盘 Cookie</span>
            <textarea
              rows={3}
              placeholder="填入您的 Quark Cookie 以供夸克资源转存任务识别使用..."
              value={quark.cookie}
              onChange={(e) => quark.setCookie(e.target.value)}
              className="w-full text-xs font-mono p-3 resize-none input-premium"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>夸克默认存储目录 Folder ID</span>
              <input
                type="text"
                value={quark.defaultFolderId}
                onChange={(e) => quark.setDefaultFolderId(e.target.value)}
                className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>默认目录友好名称</span>
              <input
                type="text"
                value={quark.defaultFolderName}
                onChange={(e) => quark.setDefaultFolderName(e.target.value)}
                className="w-full text-xs px-3.5 py-2.5 input-premium"
              />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={actions.saveQuarkSettings} disabled={busy.isBusy("quarkConfigSave")} className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存夸克配置</button>
            <button type="button" onClick={actions.checkQuarkCookie} disabled={busy.isBusy("quarkCheck")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测 Cookie</button>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { Dispatch, SetStateAction } from "react";
import { Database, Send, SlidersHorizontal } from "lucide-react";

type StringSetter = Dispatch<SetStateAction<string>>;
type NumberSetter = Dispatch<SetStateAction<number>>;
type BoolSetter = Dispatch<SetStateAction<boolean>>;
type ActionHandler = () => void | Promise<void>;

type TelegramSettingsProps = {
  busy: {
    isBusy: (key: string) => boolean;
  };
  client: {
    apiId: string;
    setApiId: StringSetter;
    apiHash: string;
    setApiHash: StringSetter;
    phone: string;
    setPhone: StringSetter;
    channelsInput: string;
    setChannelsInput: StringSetter;
    searchDays: number;
    setSearchDays: NumberSetter;
    maxMessagesPerChannel: number;
    setMaxMessagesPerChannel: NumberSetter;
  };
  bot: {
    token: string;
    setToken: StringSetter;
    enabled: boolean;
    setEnabled: BoolSetter;
    allowedUsersInput: string;
    setAllowedUsersInput: StringSetter;
    notifyChatIdsInput: string;
    setNotifyChatIdsInput: StringSetter;
    hdhiveAutoUnlock: boolean;
    setHdhiveAutoUnlock: BoolSetter;
  };
  index: {
    enabled: boolean;
    setEnabled: BoolSetter;
    session: string;
    setSession: StringSetter;
    realtimeFallbackEnabled: boolean;
    setRealtimeFallbackEnabled: BoolSetter;
    queryLimitPerChannel: number;
    setQueryLimitPerChannel: NumberSetter;
    backfillBatchSize: number;
    setBackfillBatchSize: NumberSetter;
    incrementalIntervalMinutes: number;
    setIncrementalIntervalMinutes: NumberSetter;
  };
  qr: {
    image: string | null;
    status: string | null;
    needPassword: boolean;
    password: string;
    setPassword: StringSetter;
    polling: boolean;
  };
  actions: {
    startQrLogin: ActionHandler;
    verifyQrPassword: ActionHandler;
    logoutSession: ActionHandler;
    saveClient: ActionHandler;
    checkClient: ActionHandler;
    saveBot: ActionHandler;
    restartBot: ActionHandler;
    stopBot: ActionHandler;
    refreshIndex: ActionHandler;
    rebuildIndex: ActionHandler;
    backfillIndex: ActionHandler;
    runIncremental: ActionHandler;
  };
};

export default function TelegramSettings({
  busy,
  client,
  bot,
  index,
  qr,
  actions,
}: TelegramSettingsProps) {
  return (
    <div className="space-y-6">
      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Send className="w-4 h-4 text-sky-500" />
          Telegram 客户端扫码与凭据
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-xl flex flex-col items-center gap-3 border text-center" style={{ background: "var(--surface-subtle)", borderColor: "var(--border)" }}>
            <div className="space-y-1">
              <p className="text-xs font-bold" style={{ color: "var(--txt)" }}>官方 TG 快速登录通道 (免验证码扫码)</p>
              <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>启动后可用官方 App 扫码登录。若设置了二步验证，请在下方填入二步密码。</p>
            </div>

            {qr.image && (
              <div className="p-2 bg-white rounded-lg inline-block border">
                <img src={qr.image} alt="Telegram QR Login" className="w-36 h-36" />
              </div>
            )}

            {qr.status && (
              <p className="text-[10px] font-black" style={{ color: "var(--brand-primary)" }}>{qr.status}</p>
            )}

            {qr.needPassword && (
              <div className="w-full max-w-sm flex gap-2">
                <input
                  type="password"
                  value={qr.password}
                  onChange={(e) => qr.setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void actions.verifyQrPassword();
                  }}
                  placeholder="Telegram 二步验证密码"
                  className="flex-1 min-w-0 text-xs px-3 py-2 input-premium"
                />
                <button
                  type="button"
                  onClick={actions.verifyQrPassword}
                  disabled={qr.polling || !qr.password.trim()}
                  className="px-3 py-2 bg-brand-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  验证
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={actions.startQrLogin}
                disabled={qr.polling}
                className="px-4 py-2 bg-brand-primary text-white text-[10px] font-bold rounded-lg hover:bg-opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {qr.polling ? "正在轮询..." : "启动 TG 扫码登录"}
              </button>
              <button
                type="button"
                onClick={actions.logoutSession}
                className="px-4 py-2 border rounded-lg text-[10px] font-bold text-[var(--accent-danger)] cursor-pointer"
                style={{ borderColor: "rgba(239,68,68,0.3)" }}
              >
                登出会话
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG API ID</span>
              <input value={client.apiId} onChange={(e) => client.setApiId(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG API Hash</span>
              <input type="password" value={client.apiHash} onChange={(e) => client.setApiHash(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-3">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>手机号码 (带国别码, e.g. +86138...)</span>
              <input value={client.phone} onChange={(e) => client.setPhone(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>追更频道列表 (以逗号或换行分隔)</span>
              <textarea rows={3} value={client.channelsInput} onChange={(e) => client.setChannelsInput(e.target.value)} placeholder="e.g. share_channel, mediasync_share..." className="w-full text-xs font-mono p-3 resize-none input-premium" />
            </label>
            <div className="space-y-2">
              <label className="space-y-1 block">
                <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>检索历史消息天数</span>
                <input type="number" min={1} value={client.searchDays} onChange={(e) => client.setSearchDays(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>单频道检索上限数</span>
                <input type="number" min={50} value={client.maxMessagesPerChannel} onChange={(e) => client.setMaxMessagesPerChannel(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={actions.saveClient} disabled={busy.isBusy("tgConfigSave")} className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 TG 连接配置</button>
            <button type="button" onClick={actions.checkClient} disabled={busy.isBusy("tgCheck")} className="glass-hover px-3 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连接状态</button>
          </div>
        </div>
      </div>

      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
          Telegram Bot 接收服务
        </h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>定时扫描与接收</span>
            <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
              <input type="checkbox" checked={bot.enabled} onChange={(e) => bot.setEnabled(e.target.checked)} className="accent-brand-primary" />
              启用 Telegram Bot
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Bot Token *</span>
              <input type="password" value={bot.token} onChange={(e) => bot.setToken(e.target.value)} placeholder="填入 @BotFather 申请的 API Token" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>授权交互用户 ID 列表 (以逗号分隔)</span>
              <input value={bot.allowedUsersInput} onChange={(e) => bot.setAllowedUsersInput(e.target.value)} placeholder="e.g. 12345678, 87654321" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>消息推送目的通知 Chat ID 列表</span>
              <input value={bot.notifyChatIdsInput} onChange={(e) => bot.setNotifyChatIdsInput(e.target.value)} placeholder="e.g. -10012345678" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <div className="pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                <input type="checkbox" checked={bot.hdhiveAutoUnlock} onChange={(e) => bot.setHdhiveAutoUnlock(e.target.checked)} className="accent-brand-primary" />
                允许机器人与 HDHive 自动交互并解锁资源
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={actions.saveBot} disabled={busy.isBusy("tgBotConfigSave")} className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 Bot 参数</button>
            <button type="button" onClick={actions.restartBot} disabled={busy.isBusy("tgBotRestart")} className="glass-hover px-3 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>重启机器人</button>
            <button type="button" onClick={actions.stopBot} disabled={busy.isBusy("tgBotStop")} className="px-3 py-2 border rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}>停用机器人</button>
          </div>
        </div>
      </div>

      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Database className="w-4 h-4 text-indigo-500" />
          Telegram 索引调度器参数 (Advanced)
        </h3>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" checked={index.enabled} onChange={(e) => index.setEnabled(e.target.checked)} className="accent-brand-primary" />
              启用消息索引服务
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" checked={index.realtimeFallbackEnabled} onChange={(e) => index.setRealtimeFallbackEnabled(e.target.checked)} className="accent-brand-primary" />
              实时兜底检索备份
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>单频道查询上限</span>
              <input type="number" min={20} value={index.queryLimitPerChannel} onChange={(e) => index.setQueryLimitPerChannel(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>回灌批量大小</span>
              <input type="number" min={50} value={index.backfillBatchSize} onChange={(e) => index.setBackfillBatchSize(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>增量间隔(分钟)</span>
              <input type="number" min={15} value={index.incrementalIntervalMinutes} onChange={(e) => index.setIncrementalIntervalMinutes(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG Session 秘钥</span>
            <input type="password" value={index.session} onChange={(e) => index.setSession(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
          </label>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={actions.refreshIndex}
              disabled={busy.isBusy("tgIndexRefresh")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer"
            >
              刷新索引状态
            </button>
            <button
              type="button"
              onClick={actions.rebuildIndex}
              disabled={busy.isBusy("tgIndexRebuild")}
              className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              全量重构索引
            </button>
            <button
              type="button"
              onClick={actions.backfillIndex}
              disabled={busy.isBusy("tgIndexBackfill")}
              className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              启动增量回灌
            </button>
            <button
              type="button"
              onClick={actions.runIncremental}
              disabled={busy.isBusy("tgIndexIncremental")}
              className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              执行增量拉取
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

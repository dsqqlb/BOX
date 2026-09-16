'use client';

import { ChangeEvent, DragEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

interface User { username: string; isAdmin: boolean; allowedTools: string[]; }
interface Attachment { id: string; originalName: string; mimeType: string; byteSize: number; previewKind: 'image' | 'video' | 'audio' | 'file'; url: string; }
interface Reaction { emoji: string; count: number; reacted: boolean; }
interface Message { id: string; body: string; createdAt: string; withdrawnAt: string | null; author: { username: string }; replyTo: { id: string; body: string; author: { username: string }; withdrawnAt: string | null } | null; attachments: Attachment[]; reactions: Reaction[]; }
interface Stats { messageCount: number; attachmentCount: number; totalBytes: number; maxUploadBytes: number; }
interface FloatingMenu { message: Message; own: boolean; x: number; y: number; }
const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉'];

function bytes(value: number) { if (value < 1024) return `${value} B`; const units = ['KB', 'MB', 'GB']; let size = value / 1024; let index = 0; while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; } return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`; }
function time(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function isFresh(value: string) { return Date.now() - new Date(value).getTime() <= 2 * 60 * 1000; }
function mergeMessages(current: Message[], additions: Message[]) { const map = new Map(current.map((message) => [message.id, message])); additions.forEach((message) => map.set(message.id, message)); return [...map.values()].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()); }

function MessageText({ body }: { body: string }) {
  const parts = body.split(/(@[A-Za-z0-9_.-]+)/g);
  return <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{parts.map((part, index) => part.startsWith('@') ? <span key={index} className="font-semibold text-emerald-700">{part}</span> : part)}</p>;
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  if (attachment.previewKind === 'image') return <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-xl border border-black/5 bg-black/5"><img src={attachment.url} alt={attachment.originalName} className="max-h-72 w-auto max-w-full object-contain" /></a>;
  if (attachment.previewKind === 'video') return <video className="mt-2 max-h-72 w-full rounded-xl bg-black" controls preload="metadata" src={attachment.url} />;
  if (attachment.previewKind === 'audio') return <div className="mt-2 rounded-xl bg-black/[0.05] p-3"><p className="mb-2 truncate text-xs text-slate-500">♫ {attachment.originalName}</p><audio className="w-full" controls preload="metadata" src={attachment.url} /></div>;
  return <a href={attachment.url} download={attachment.originalName} className="mt-2 flex min-w-[190px] items-center gap-3 rounded-xl border border-black/[0.08] bg-white/70 p-3 transition hover:bg-white"><span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-lg">▧</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{attachment.originalName}</span><span className="block text-xs text-slate-500">{bytes(attachment.byteSize)} · 下载文件</span></span></a>;
}

export default function LanChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState('');
  const [uploads, setUploads] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [darkTheme, setDarkTheme] = useState(true);
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenu | null>(null);
  const [reacting, setReacting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const floatingMenuTimer = useRef<number | null>(null);

  const visibleMessages = searchResults ?? messages;
  const suggestions = useMemo(() => {
    const hit = /(?:^|\s)@([A-Za-z0-9_.-]*)$/.exec(body);
    if (!hit) return [];
    return members.filter((name) => name !== user?.username && name.toLowerCase().includes(hit[1].toLowerCase())).slice(0, 6);
  }, [body, members, user]);

  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || '请求失败，请稍后重试。'); }
    return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  };

  const loadLatest = async () => {
    const page = await request<{ messages: Message[]; nextCursor: string | null }>('/api/chat/messages');
    setMessages([...page.messages].reverse()); setNextCursor(page.nextCursor); return page;
  };
  const loadOlder = async () => {
    if (!nextCursor || loadingOlder || searchResults) return;
    setLoadingOlder(true);
    try { const page = await request<{ messages: Message[]; nextCursor: string | null }>(`/api/chat/messages?cursor=${encodeURIComponent(nextCursor)}`); setMessages((current) => mergeMessages([...page.messages].reverse(), current)); setNextCursor(page.nextCursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '加载历史失败。'); }
    finally { setLoadingOlder(false); }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([request<User>('/api/auth/me'), request<{ usernames: string[] }>('/api/chat/members'), loadLatest()])
      .then(([account, memberList]) => { if (!cancelled) { setUser(account); setMembers(memberList.usernames); if (account.isAdmin) void request<Stats>('/api/chat/admin/stats').then(setStats).catch(() => {}); } })
      .catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : '无法连接聊天大厅。'); window.location.replace('/login?next=/tools/lan-chat'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
    socketRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'PRESENCE') setOnline(message.payload.usernames || []);
        if (message.type === 'TYPING') setTyping((current) => message.payload.active ? [...new Set([...current, message.payload.username])].filter((name) => name !== user?.username) : current.filter((name) => name !== message.payload.username));
        if (message.type === 'MESSAGE_CREATED') setMessages((current) => mergeMessages(current, [message.payload]));
        if (message.type === 'MESSAGE_CHANGED') void loadLatest().catch(() => {});
        if (message.type === 'MESSAGE_DELETED') setMessages((current) => current.filter((item) => item.id !== message.payload.id));
      } catch { /* Ignore malformed server event. */ }
    };
    return () => { if (socketRef.current === socket) socketRef.current = null; socket.close(); };
  }, [user?.username]);

  useEffect(() => () => { if (typingTimer.current) window.clearTimeout(typingTimer.current); }, []);

  const changeBody = (value: string) => {
    setBody(value);
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'TYPING', payload: { active: Boolean(value) } }));
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'TYPING', payload: { active: false } })); }, 1200);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files); if (!list.length) return;
    setUploading(true); setError('');
    try {
      const complete: Attachment[] = [];
      for (const file of list) {
        const response = await fetch('/api/chat/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Chat-File-Name': encodeURIComponent(file.name) }, body: file });
        if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `${file.name} 上传失败。`); }
        complete.push(await response.json());
      }
      setUploads((current) => [...current, ...complete]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '文件上传失败。'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const submit = async () => {
    if ((!body.trim() && uploads.length === 0) || sending) return;
    setSending(true); setError('');
    try {
      const message = await request<Message>('/api/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, attachmentIds: uploads.map((item) => item.id), replyToId: replyTo?.id || undefined }) });
      setMessages((current) => mergeMessages(current, [message])); setBody(''); setUploads([]); setReplyTo(null);
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'TYPING', payload: { active: false } }));
      window.setTimeout(() => messageAreaRef.current?.scrollTo({ top: messageAreaRef.current.scrollHeight, behavior: 'smooth' }), 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发送失败。'); }
    finally { setSending(false); }
  };

  const react = async (message: Message, emoji: string) => {
    const reactionKey = `${message.id}:${emoji}`;
    setReacting(reactionKey);
    try {
      const next = await request<Message>(`/api/chat/messages/${message.id}/reactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }) });
      setMessages((current) => current.map((item) => item.id === next.id ? next : item));
      setFloatingMenu((current) => current?.message.id === next.id ? { ...current, message: next } : current);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '表情发送失败。');
      return false;
    } finally { setReacting(null); }
  };
  const withdraw = async (message: Message) => { try { const next = await request<Message>(`/api/chat/messages/${message.id}/withdraw`, { method: 'POST' }); setMessages((current) => current.map((item) => item.id === next.id ? next : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : '撤回失败。'); } };
  const removeAsAdmin = async (message: Message) => { if (!window.confirm(`确定删除 ${message.author.username} 的这条消息及其附件？`)) return; try { await request(`/api/chat/admin/messages/${message.id}`, { method: 'DELETE' }); setMessages((current) => current.filter((item) => item.id !== message.id)); if (stats) void request<Stats>('/api/chat/admin/stats').then(setStats); } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败。'); } };
  const chooseMention = (name: string) => setBody((current) => current.replace(/@[A-Za-z0-9_.-]*$/, `@${name} `));
  const searchMessages = async (value: string) => { setSearch(value); if (!value.trim()) { setSearchResults(null); return; } try { const result = await request<{ messages: Message[] }>(`/api/chat/search?q=${encodeURIComponent(value.trim())}`); setSearchResults([...result.messages].reverse()); } catch (reason) { setError(reason instanceof Error ? reason.message : '搜索失败。'); } };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void uploadFiles(event.dataTransfer.files); };
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void uploadFiles(files); } };
  const clearFloatingMenuDismiss = () => { if (floatingMenuTimer.current) { window.clearTimeout(floatingMenuTimer.current); floatingMenuTimer.current = null; } };
  const queueFloatingMenuDismiss = () => { clearFloatingMenuDismiss(); floatingMenuTimer.current = window.setTimeout(() => setFloatingMenu(null), 350); };
  const showFloatingMenu = (event: React.MouseEvent<HTMLElement>, message: Message, own: boolean) => {
    clearFloatingMenuDismiss();
    const rect = event.currentTarget.getBoundingClientRect();
    setFloatingMenu({ message, own, x: own ? rect.right : rect.left, y: Math.max(12, rect.top - 8) });
  };

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#edf3ef]"><div className="rounded-2xl bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">正在进入局域网大厅…</div></main>;
  return <main className={`lan-chat h-[100dvh] overflow-hidden bg-[#edf3ef] text-slate-800 ${darkTheme ? 'lan-chat-dark' : ''}`}><div className="mx-auto flex h-full min-h-0 max-w-7xl overflow-hidden bg-[#f7faf8] shadow-2xl shadow-emerald-950/10">
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex"><a href="/" className="mb-7 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-xl text-white shadow-lg">B</span><span><span className="block font-bold tracking-wide">BOX</span><span className="text-[11px] text-slate-400">LOCAL NETWORK</span></span></a><div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-3 py-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-600 font-semibold text-white">{user?.username.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{user?.username}</span><span className="flex items-center gap-1 text-xs text-emerald-700"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />在线</span></span></div><nav className="mt-7"><a className="flex items-center gap-3 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-medium text-white shadow-sm" href="/tools/lan-chat">💬 局域网大厅<span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{online.length}</span></a></nav><div className="mt-auto rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">所有登录且具备大厅权限的账户均可查看这里的历史消息与附件。</div></aside>
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col"><header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6"><div><h1 className="text-base font-semibold">局域网大厅</h1><p className="mt-0.5 text-xs text-slate-400">{online.length ? `${online.length} 人在线` : '正在连接…'} · 全部历史已保存</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setDarkTheme((current) => !current)} title={darkTheme ? '切换为浅色主题' : '切换为深色主题'} className="rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-200">{darkTheme ? '☀ 浅色' : '◐ 深色'}</button><div className="relative"><input value={search} onChange={(event) => void searchMessages(event.target.value)} placeholder="搜索聊天记录" className="w-32 rounded-xl bg-slate-100 px-3 py-2 text-xs outline-none transition focus:w-48 focus:ring-2 focus:ring-emerald-200 sm:w-48" />{search && <button type="button" onClick={() => { setSearch(''); setSearchResults(null); }} className="absolute right-2 top-1.5 text-sm text-slate-400">×</button>}</div><span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white lg:hidden">{user?.username.slice(0, 1).toUpperCase()}</span></div></header>
      {error && <div className="mx-3 mt-3 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"><span>{error}</span><button type="button" onClick={() => setError('')}>×</button></div>}
      <div ref={messageAreaRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 60) void loadOlder(); }} className={`relative min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6 ${dragging ? 'bg-emerald-50' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop}>
        {dragging && <div className="pointer-events-none absolute inset-4 z-10 grid place-items-center rounded-3xl border-2 border-dashed border-emerald-400 bg-emerald-50/90 text-sm font-medium text-emerald-700">松开即可上传文件</div>}
        {!searchResults && nextCursor && <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mx-auto mb-5 block rounded-full bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm hover:text-emerald-700">{loadingOlder ? '正在加载…' : '加载更早消息'}</button>}
        {searchResults && <p className="mb-5 text-center text-xs text-slate-400">找到 {searchResults.length} 条匹配消息</p>}
        <div className="mx-auto max-w-3xl space-y-5">{visibleMessages.length === 0 ? <div className="py-24 text-center"><div className="text-4xl">👋</div><p className="mt-4 font-medium text-slate-600">还没有消息</p><p className="mt-1 text-sm text-slate-400">发出第一句问候，开启局域网大厅。</p></div> : visibleMessages.map((message) => { const own = message.author.username === user?.username; return <article key={message.id} className={`group flex gap-2.5 ${own ? 'flex-row-reverse' : ''}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${own ? 'bg-emerald-600 text-white' : 'bg-orange-100 text-orange-700'}`}>{message.author.username.slice(0, 1).toUpperCase()}</span><div onMouseEnter={(event) => { if (!message.withdrawnAt) showFloatingMenu(event, message, own); }} onMouseLeave={queueFloatingMenuDismiss} className={`relative min-w-0 max-w-[82%] sm:max-w-[72%] ${own ? 'items-end' : ''}`}><div className={`mb-1 flex items-center gap-2 text-[11px] text-slate-400 ${own ? 'justify-end' : ''}`}><span>{message.author.username}</span><span>{time(message.createdAt)}</span></div>{message.withdrawnAt ? <div className="rounded-2xl bg-slate-200 px-3 py-2 text-sm italic text-slate-500">这条消息已被撤回</div> : <><div className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${own ? 'rounded-tr-md bg-emerald-500 text-white' : 'rounded-tl-md bg-white text-slate-800'}`}>{message.replyTo && <button type="button" onClick={() => setReplyTo(message.replyTo as Message)} className={`mb-2 block max-w-full rounded-lg px-2 py-1 text-left text-xs ${own ? 'bg-emerald-600/40 text-emerald-50' : 'bg-slate-100 text-slate-500'}`}>回复 @{message.replyTo.author.username}：{message.replyTo.withdrawnAt ? '已撤回' : (message.replyTo.body || '[附件]').slice(0, 46)}</button>}{message.body && <MessageText body={message.body} />}{message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}</div>{message.reactions.length > 0 && <div className={`mt-1.5 flex flex-wrap gap-1 ${own ? 'justify-end' : ''}`}>{message.reactions.map((reaction) => <button type="button" key={reaction.emoji} disabled={reacting !== null} onClick={async (event) => { event.stopPropagation(); await react(message, reaction.emoji); }} className={`rounded-full border px-2 py-0.5 text-xs transition ${reaction.reacted ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>{reaction.emoji} {reaction.count}</button>)}</div>}</>}</div></article>; })}</div></div>
      {typing.length > 0 && <div className="h-6 px-4 text-xs text-slate-400 sm:px-6">{typing.join('、')} 正在输入…</div>}
      <footer className="relative shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5"><input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void uploadFiles(event.target.files); }} />{replyTo && <div className="mb-2 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><span className="truncate">回复 @{replyTo.author.username}：{replyTo.body || '[附件]'}</span><button type="button" onClick={() => setReplyTo(null)} className="ml-3 text-base">×</button></div>}{uploads.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{uploads.map((item) => <div key={item.id} className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-100 px-2 py-1.5 text-xs"><span className="max-w-32 truncate">{item.originalName}</span><button type="button" onClick={() => setUploads((current) => current.filter((upload) => upload.id !== item.id))} className="text-slate-400">×</button></div>)}</div>}<div className="relative flex items-end gap-2"><button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl text-slate-500 transition hover:bg-slate-100 disabled:opacity-50">＋</button><textarea value={body} onChange={(event) => changeBody(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} rows={1} placeholder="输入消息，支持 @ 提及、粘贴或拖入文件…" className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-emerald-200" />{suggestions.length > 0 && <div className="absolute bottom-12 left-12 z-20 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{suggestions.map((name) => <button type="button" key={name} onClick={() => chooseMention(name)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-emerald-50">@{name}</button>)}</div>}<button type="button" disabled={sending || uploading || (!body.trim() && uploads.length === 0)} onClick={() => void submit()} className="h-10 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{sending ? '发送中' : '发送'}</button></div><p className="hidden py-1 text-[10px] text-slate-400 sm:block">Enter 发送 · Shift + Enter 换行 · 单文件最大由服务器管理员配置</p></footer>
    </section>
    <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white p-4 xl:block"><h2 className="text-sm font-semibold">在线成员 <span className="font-normal text-slate-400">{online.length}</span></h2><div className="mt-3 space-y-2">{online.map((name) => <div key={name} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="truncate">{name}{name === user?.username ? '（我）' : ''}</span></div>)}</div>{user?.isAdmin && <div className="mt-8 rounded-2xl bg-slate-50 p-3"><h2 className="text-sm font-semibold">大厅存储</h2>{stats ? <><p className="mt-3 text-2xl font-semibold text-emerald-700">{bytes(stats.totalBytes)}</p><p className="mt-1 text-xs text-slate-500">{stats.messageCount} 条消息 · {stats.attachmentCount} 个附件</p><p className="mt-2 text-xs text-slate-400">单文件上限 {bytes(stats.maxUploadBytes)}</p></> : <p className="mt-2 text-xs text-slate-400">正在读取用量…</p>}</div>}</aside>
    {floatingMenu && <div role="toolbar" aria-label="消息操作" onMouseEnter={clearFloatingMenuDismiss} onMouseDown={clearFloatingMenuDismiss} onMouseLeave={queueFloatingMenuDismiss} style={{ left: floatingMenu.x, top: floatingMenu.y, transform: floatingMenu.own ? 'translate(-100%, -100%)' : 'translate(0, -100%)' }} className="fixed z-[120] flex max-w-[calc(100vw-1rem)] flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl shadow-slate-950/25 backdrop-blur-xl"><div className="flex gap-1">{QUICK_EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={async (event) => { event.stopPropagation(); if (await react(floatingMenu.message, emoji)) setFloatingMenu(null); }} disabled={reacting !== null} className="grid h-8 w-8 place-items-center rounded-xl text-sm transition hover:bg-emerald-50">{emoji}</button>)}</div>{floatingMenu.message.reactions.map((reaction) => <button type="button" key={reaction.emoji} onClick={async (event) => { event.stopPropagation(); if (await react(floatingMenu.message, reaction.emoji)) setFloatingMenu(null); }} disabled={reacting !== null} className={`rounded-xl border px-2 py-1 text-xs ${reaction.reacted ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'}`}>{reaction.emoji} {reaction.count}</button>)}<span className="h-5 w-px bg-slate-200" /><button type="button" onClick={() => { setReplyTo(floatingMenu.message); setFloatingMenu(null); }} className="rounded-xl px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100">回复</button>{floatingMenu.own && isFresh(floatingMenu.message.createdAt) && <button type="button" onClick={() => { void withdraw(floatingMenu.message); setFloatingMenu(null); }} className="rounded-xl px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100">撤回</button>}{user?.isAdmin && <button type="button" onClick={() => { void removeAsAdmin(floatingMenu.message); setFloatingMenu(null); }} className="rounded-xl px-2 py-1 text-xs text-rose-600 transition hover:bg-rose-50">删除</button>}</div>}
  </div></main>;
}

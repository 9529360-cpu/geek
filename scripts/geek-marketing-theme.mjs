export const MARKETING_ROUTES = new Set(['/product', '/translation', '/broadcast', '/security', '/pricing', '/guide', '/faq', '/windows']);
export const SITE_ORIGIN = 'https://geek.bbnba.com';

export const PAGE_META = {
  '/product': {
    label: 'Product',
    title: '产品总览 · 极客 Geek',
    description: '极客 Geek 是面向出海沟通的 Windows 多平台多账号工作台，把账号隔离、消息翻译与账号级群发任务收进一个桌面。',
    eyebrow: 'Product overview',
    headline: '把账号、语言与任务，\n收回一个工作台。',
    lede: '海外沟通真正消耗时间的，不是打开聊天软件，而是在多个账号、不同语言和持续任务之间反复切换。极客把工作上下文重新绑定回账号本身。',
  },
  '/translation': {
    label: 'Translation',
    title: '会话翻译 · 极客 Geek',
    description: '极客 Geek 把跨语言翻译放回会话现场：按账号保存设置、收发消息统一翻译、普通翻译支持账号级安全缓存。',
    eyebrow: 'Conversation translation',
    headline: '语言不同，\n工作流不必不同。',
    lede: '翻译不应该是复制、切页、粘贴再复制的另一份工作。极客把收件翻译、发送翻译和账号级配置放在聊天现场。',
  },
  '/broadcast': {
    label: 'Broadcast',
    title: '账号级群发任务 · 极客 Geek',
    description: '极客 Geek 的群发任务固定所属账号、目标快照与发送参数：不同账号可并行，同一账号任务串行并支持排队与定时。',
    eyebrow: 'Account-owned broadcast',
    headline: '群发是任务，\n不是一个卡住你的弹窗。',
    lede: '任务创建后就拥有明确的账号归属、受众快照与执行状态。你可以继续聊天、切换账号，让任务留在真正属于它的账号里。',
  },
  '/security': {
    label: 'Security',
    title: '账号隔离与安全边界 · 极客 Geek',
    description: '极客 Geek 以账号级持久化 Session、账号沙箱、安全 WebView 边界与服务端翻译密钥保护多账号出海沟通工作流。',
    eyebrow: 'Isolation by default',
    headline: '多账号的第一要求，\n是边界真的存在。',
    lede: '真正的多账号工作台不能只在界面上“看起来分开”。账号身份、会话环境、工具数据、后台任务与附件能力都必须拥有明确归属。',
  },
  '/pricing': {
    label: 'Pricing',
    title: '字符包与翻译用量 · 极客 Geek',
    description: '极客 Geek 当前按翻译字符余额计费：注册赠送 2 万字符，字符包一次购买、余额不限时，不按月收取席位费。',
    eyebrow: 'Usage pricing',
    headline: '按实际翻译用量付费，\n不按月养席位。',
    lede: '极客当前采用字符余额模式：注册先获得免费字符，真正产生持续翻译需求后再购买字符包。字符余额不限时，用完再买，不把多账号工作台包装成三档功能订阅。',
  },
  '/guide': {
    label: 'Guide',
    title: '安装与上手 · 极客 Geek',
    description: '从下载 Windows 客户端、登录极客账户，到添加 WhatsApp、Telegram、LINE 账号并配置翻译与群发任务，快速建立第一条跨境沟通工作流。',
    eyebrow: 'Getting started',
    headline: '先跑通一个账号，\n再扩展整个工作台。',
    lede: '不要一上来把所有账号和任务都搬进来。先完成安装、登录和第一个真实账号，再逐步打开翻译与群发，最快建立一条可验证的日常工作流。',
  },
  '/faq': {
    label: 'FAQ',
    title: '常见问题 · 极客 Geek',
    description: '了解极客 Geek 当前支持的平台与 Windows 客户端边界、账号隔离、翻译、群发、更新与第三方平台兼容说明。',
    eyebrow: 'Frequently asked',
    headline: '先把边界说清楚，\n再决定要不要使用。',
    lede: '极客不是把限制藏进页脚的产品。这里集中说明当前平台、系统、账号隔离、翻译、群发与更新方式，以及第三方平台兼容关系。',
  },
  '/windows': {
    label: 'Windows',
    title: '下载 Windows 客户端 · 极客 Geek',
    description: '下载极客 Geek Windows 客户端，登录账户后添加 WhatsApp、Telegram、LINE 账号并开始使用翻译与账号级群发工作流。',
    eyebrow: 'Geek for Windows',
    headline: '把海外沟通，\n放回桌面主战场。',
    lede: '极客是桌面工作台，不是另一个需要常驻浏览器标签页的后台。安装、登录、添加账号，然后在同一个窗口持续处理跨平台会话。',
  },
};

export const LOGO = `<svg class="brand-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
<linearGradient id="gx-silver" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f5f7fa"/>
<stop offset=".55" stop-color="#b9c0c9"/>
<stop offset="1" stop-color="#7d858f"/>
</linearGradient>
<linearGradient id="gx-tile" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#23252a"/>
<stop offset="1" stop-color="#101114"/>
</linearGradient>
</defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#gx-tile)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
  <rect x="31" y="12" width="21" height="14" rx="3.5" fill="none" stroke="#25d366" stroke-width="1.7"/>
<circle cx="34.5" cy="15.5" r="1.4" fill="#25d366"/>
  <rect x="35" y="39" width="23" height="17" rx="3.5" fill="none" stroke="#25d366" stroke-width="1.7"/>
<circle cx="38.5" cy="42.5" r="1.4" fill="#25d366"/>
  <path d="M18 38 A14.5 14.5 0 1 1 44 29" fill="none" stroke="url(#gx-silver)" stroke-width="9.5" stroke-linecap="round"/>
<path d="M45.5 23 l-2.5 9 l8.5 -4.2 z" fill="url(#gx-silver)"/>
</svg>`;
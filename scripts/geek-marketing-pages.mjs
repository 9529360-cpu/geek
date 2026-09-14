import { hero, stageBroadcast, stageProduct, stageSecurity, stageTranslation, stageWindows } from './geek-marketing-visuals.mjs';

function productPage() {
  return `${hero('/product',stageProduct())}<div class="metric-strip">
<div class="shell metrics">
<div class="metric">
<b>多平台多账号</b>
<span>一个桌面统一承载不同会话入口</span>
</div>
<div class="metric">
<b>账号级隔离</b>
<span>会话与工具状态拥有固定归属</span>
</div>
<div class="metric">
<b>会话内翻译</b>
<span>收发消息进入同一语言工作流</span>
</div>
<div class="metric">
<b>后台群发任务</b>
<span>任务不跟着当前查看页面漂移</span>
</div>
</div>
</div>
  <section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">The account is the workspace</div>
<h2>账号不是标签页，<br>账号就是工作现场。</h2>
</div>
<p class="section-intro">极客的核心不是“同时打开几个网页”，而是让每个账号保有自己的会话环境、工具配置和后台任务。你切换的是正在查看的现场，不是任务和数据的所有权。</p>
</div>
<div class="cards">
<article class="card">
<div class="card-top">
<span>01 · Account</span>
<span class="icon">◫</span>
</div>
<h3>每个账号独立运行</h3>
<p>账号拥有固定会话环境与账号级状态，界面焦点变化不会重新绑定另一个账号的运行上下文。</p>
</article>
<article class="card">
<div class="card-top">
<span>02 · Language</span>
<span class="icon">文</span>
</div>
<h3>语言留在会话里</h3>
<p>收到的消息和准备发送的回复都在同一个沟通现场处理，不必反复切换翻译页面。</p>
</article>
<article class="card">
<div class="card-top">
<span>03 · Job</span>
<span class="icon">↗</span>
</div>
<h3>任务留在账号里</h3>
<p>群发创建后固定所属账号和目标快照。切到其他账号继续工作，原任务仍按自己的归属执行。</p>
</article>
</div>
</div>
</section>
  <section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">One continuous flow</div>
<h2>从添加账号，到跨语言沟通，再到后台任务。</h2>
<p>功能不是一排互不相干的按钮。账号隔离提供底座，翻译解决会话语言，群发把重复操作变成有归属的任务；三者共同形成连续工作流。</p>
<ul class="list">
<li>先添加并长期保留账号会话现场</li>
<li>按账号配置翻译与日常沟通工具</li>
<li>把重复触达转为账号级群发任务</li>
<li>切换查看其他账号，不打断后台归属</li>
</ul>
</div>${stageProduct()}</div>
</section>`;
}

function translationPage() {
  return `${hero('/translation',stageTranslation())}<section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">Translate in context</div>
<h2>看到原文，也看到你真正要表达的意思。</h2>
</div>
<p class="section-intro">会话翻译的价值不是单次“翻对一句话”，而是让用户在客户上下文里连续阅读、回复和重新翻译，同时不把供应商密钥暴露给聊天页面。</p>
</div>
<div class="cards">
<article class="card">
<div class="card-top">
<span>Receive</span>
<span class="icon">↓</span>
</div>
<h3>收到即在会话内理解</h3>
<p>消息原文保留在上下文里，译文紧邻原消息呈现，避免用户在多个窗口之间失去客户语境。</p>
</article>
<article class="card">
<div class="card-top">
<span>Reply</span>
<span class="icon">↑</span>
</div>
<h3>用自己的语言组织回复</h3>
<p>先写真正想说的话，再转为目标语言发送；翻译是发送流程的一部分，而不是另一个产品。</p>
</article>
<article class="card">
<div class="card-top">
<span>Account</span>
<span class="icon">⌁</span>
</div>
<h3>设置与缓存按账号归属</h3>
<p>普通翻译可复用账号级安全缓存；重新翻译显式绕过旧缓存，不把不同账号的语言状态混在一起。</p>
</article>
</div>
</div>
</section>
<section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">Server-side boundary</div>
<h2>翻译供应商属于服务端，<br>不属于聊天页面。</h2>
<p>正式客户端只通过统一翻译网关工作。供应商 API Key 留在服务端；账号标识、partition 与聊天身份不被发送给翻译供应商。</p>
<ul class="list">
<li>正式版翻译网关使用 HTTPS 边界</li>
<li>客户端不持有真实供应商密钥与模型配置</li>
<li>账号级缓存键不把原文明文写入缓存索引</li>
<li>安全存储不可用时不降级为明文落盘</li>
</ul>
</div>${stageSecurity()}</div>
</section>`;
}

function broadcastPage() {
  return `${hero('/broadcast',stageBroadcast())}<section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">Job ownership</div>
<h2>先确定“谁在发”，<br>再执行“发给谁”。</h2>
</div>
<p class="section-intro">群发最危险的错误不是慢，而是串账号。极客在任务创建时固定 account、platform、WebView、targets、message 与附件等业务快照，之后的页面切换不能改变 owner。</p>
</div>
<div class="cards">
<article class="card">
<div class="card-top">
<span>Parallel</span>
<span class="icon">⇉</span>
</div>
<h3>不同账号可以并行</h3>
<p>A、B、C 三个账号可以各自运行自己的 Broadcast Job，互不占用彼此执行槽。</p>
</article>
<article class="card">
<div class="card-top">
<span>Serial</span>
<span class="icon">≡</span>
</div>
<h3>同账号一次执行一个</h3>
<p>同一账号最多一个 executing Job；后续 scheduled / queued 任务等待前一个任务进入终态。</p>
</article>
<article class="card">
<div class="card-top">
<span>Targets</span>
<span class="icon">◎</span>
</div>
<h3>一个任务内顺序发送</h3>
<p>目标在单个 Job 内串行执行并遵守随机间隔，不用并发轰炸换取表面速度。</p>
</article>
</div>
</div>
</section>
<section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">Scheduled & durable</div>
<h2>定时任务到点，<br>归属仍然不会改变。</h2>
<p>定时任务使用创建时固定的账号与目标快照。同账号撞上正在执行的任务就进入队列；附件则使用与账号、任务绑定的 opaque ref，在执行前重新校验。</p>
<ul class="list">
<li>定时触发不读取“当前正在查看的账号”</li>
<li>同账号冲突排队，上一任务终态后再 drain</li>
<li>附件真实路径不暴露给 renderer</li>
<li>终态与取消会清理对应 durable refs</li>
</ul>
</div>${stageBroadcast()}</div>
</section>`;
}

function securityPage() {
  return `${hero('/security',stageSecurity())}<section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">Four ownership layers</div>
<h2>从 Session 到数据，<br>从任务到服务端密钥。</h2>
</div>
<p class="section-intro">极客不把“隔离”当一句营销词。真正的边界分别存在于账号会话、账号工具数据、WebView/任务能力和服务端秘密之间，每一层都有不同 owner。</p>
</div>
<div class="cards">
<article class="card">
<div class="card-top">
<span>Session</span>
<span class="icon">⌁</span>
</div>
<h3>独立持久化会话</h3>
<p>账号身份、partition、guest WebContents 与 Session 不因为 UI focus 或另一个账号而重新绑定。</p>
</article>
<article class="card">
<div class="card-top">
<span>Sandbox</span>
<span class="icon">▣</span>
</div>
<h3>账号级工具数据</h3>
<p>工具数据按显式 allowlist 写入账号 partition；安全存储不可用时 fail closed，不把敏感值明文落盘。</p>
</article>
<article class="card">
<div class="card-top">
<span>WebView</span>
<span class="icon">◇</span>
</div>
<h3>远程页面保持安全边界</h3>
<p>远程 WebView 保持 sandbox 与 webSecurity；账号导航和权限决策按 owner 约束，而不是全局放开。</p>
</article>
</div>
</div>
</section>
<section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">Fail closed</div>
<h2>边界不确定时，<br>宁可拒绝，也不猜归属。</h2>
<p>多账号产品最大的隐性风险来自“帮用户猜一下”。极客在账号、附件、导航和安全存储等关键边界更倾向于显式失败，而不是把不确定状态静默归到当前页面。</p>
<ul class="list">
<li>renderer 不能自行提交 partition 或真实文件路径</li>
<li>跨账号或跨 Job 使用附件能力会被拒绝</li>
<li>翻译 provider 密钥不进入 renderer / WebView</li>
<li>账号删除前先排空账号数据写入队列</li>
</ul>
</div>${stageSecurity()}</div>
</section>`;
}

function windowsPage() {
  return `${hero('/windows',stageWindows())}<section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">Start in minutes</div>
<h2>安装以后，<br>从真实账号工作流开始。</h2>
</div>
<p class="section-intro">官网账户与桌面客户端使用同一极客账户。下载客户端后登录、添加聊天账号，再按每个账号分别设置翻译与工作任务。</p>
</div>
<div class="cards">
<article class="card">
<div class="card-top">
<span>01</span>
<span class="icon">↓</span>
</div>
<h3>下载 Windows 客户端</h3>
<p>下载按钮继续使用现有 Release Worker 的公开安装包入口，官网介绍层不接管版本分发契约。</p>
</article>
<article class="card">
<div class="card-top">
<span>02</span>
<span class="icon">◎</span>
</div>
<h3>登录并添加账号</h3>
<p>登录极客账户后添加你的 WhatsApp、Telegram 或 LINE 工作账号，让每个账号建立自己的会话现场。</p>
</article>
<article class="card">
<div class="card-top">
<span>03</span>
<span class="icon">↗</span>
</div>
<h3>配置翻译与任务</h3>
<p>按账号设置日常翻译，需要批量触达时创建账号级群发任务，然后继续处理其他会话。</p>
</article>
</div>
</div>
</section>
<section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">Desktop first</div>
<h2>不是把后台再塞进一个浏览器标签。</h2>
<p>极客把多账号会话、账号切换和后台任务放进桌面应用生命周期。客户端可以检查公开更新，而真正的账户、支付和下载安装业务仍由现有 Worker 链路负责。</p>
<ul class="list">
<li>一个桌面窗口集中处理多个平台账号</li>
<li>账号 Session 与账号级状态保持长期归属</li>
<li>群发在所属账号后台继续执行</li>
<li>官网账户、下载和支付业务契约保持独立</li>
</ul>
</div>${stageWindows()}</div>
</section>`;
}

export const PAGE_BODY = {
  '/product': productPage,
  '/translation': translationPage,
  '/broadcast': broadcastPage,
  '/security': securityPage,
  '/windows': windowsPage,
};

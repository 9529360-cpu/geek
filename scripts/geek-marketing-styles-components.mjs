export const MARKETING_STYLES_COMPONENTS = `.section{padding:116px 0}
.section.border{border-top:1px solid var(--line)}
.section-head{display:grid;grid-template-columns:.78fr 1.22fr;gap:64px;align-items:end;margin-bottom:54px}
.kicker{color:var(--green2);font-size:10px;font-weight:760;letter-spacing:.17em;text-transform:uppercase}
.section h2{margin:13px 0 0;max-width:690px;font-size:clamp(35px,4.6vw,56px);line-height:1.06;letter-spacing:-.052em;font-weight:720}
.section-intro{margin:0;max-width:600px;color:var(--muted);font-size:15px;line-height:1.85}
.cards{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.card{min-height:270px;padding:31px 29px;border-right:1px solid var(--line)}
.card:last-child{border-right:0}
.card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:66px;color:var(--faint);font-size:9px;letter-spacing:.12em;text-transform:uppercase}
.icon{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.024);color:var(--text2);font-size:13px}
.card h3{margin:0 0 10px;font-size:17px;letter-spacing:-.025em}
.card p{margin:0;color:var(--muted);font-size:13px;line-height:1.76}
.split{display:grid;grid-template-columns:minmax(0,.82fr) minmax(500px,1.18fr);gap:72px;align-items:center}
.copy h2{margin:13px 0 18px}
.copy p{margin:0;color:var(--muted);font-size:15px;line-height:1.86}
.list{list-style:none;margin:29px 0 0;padding:0;display:grid;gap:13px}
.list li{display:grid;grid-template-columns:18px 1fr;gap:10px;color:var(--text2);font-size:13px;line-height:1.65}
.list li:before{content:"";width:15px;height:15px;margin-top:2px;border-radius:50%;border:1px solid rgba(37,211,102,.32);background:radial-gradient(circle,var(--green) 0 2px,transparent 3px)}
.panel{min-height:420px;padding:28px;border:1px solid var(--line);border-radius:19px;background:#0d0f10;overflow:hidden}
.mini-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;color:var(--faint);font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.quote{padding:19px;border:1px solid var(--line);border-radius:13px;background:var(--surface);color:var(--text2);font-size:12px;line-height:1.72}
.quote+.quote{margin-top:12px}
.quote.green{margin-left:52px;border-color:rgba(37,211,102,.22);background:rgba(37,211,102,.055)}
.quote .subline{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);color:#dfe2e5}
.quote .subline b{margin-right:7px;color:var(--green2);font-size:8px;letter-spacing:.08em;text-transform:uppercase}
.rail-demo{display:grid;grid-template-columns:130px 1fr;height:458px}
.accounts{padding:13px 10px;border-right:1px solid var(--line);background:#0f1011}
.rail-head{display:flex;align-items:center;gap:7px;margin-bottom:15px;color:var(--text2);font-size:9px;font-weight:700}
.rail-g{width:21px;height:21px;display:grid;place-items:center;border-radius:7px;border:1px solid var(--line);color:var(--green);background:#191b1d;font-weight:800}
.acct{display:grid;grid-template-columns:26px 1fr 6px;align-items:center;gap:7px;padding:8px 7px;margin:4px 0;border-radius:8px;border:1px solid transparent}
.acct.active{border-color:rgba(37,211,102,.28);background:rgba(37,211,102,.08)}
.badge{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:#205f38;color:#fff;font-size:7px;font-weight:800}
.badge.tg{background:#286d96}
.badge.li{background:#276c35}
.acct span{min-width:0;color:#aeb4ba;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 7px rgba(37,211,102,.5)}
.workspace{position:relative;padding:18px}
.workspace-top{display:flex;gap:7px;margin-bottom:20px}
.chip{padding:6px 8px;border:1px solid var(--line);border-radius:7px;color:#777d84;font-size:7px}
.chip.on{color:#a9efc0;border-color:rgba(37,211,102,.22);background:rgba(37,211,102,.065)}
.chat{width:72%;padding:12px;border:1px solid var(--line);border-radius:11px;background:#151718;color:#bfc4c9;font-size:9px;line-height:1.55}
.chat.me{margin:14px 0 0 auto;border-color:rgba(37,211,102,.2);background:rgba(37,211,102,.07)}
.chat em{display:block;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);color:#e0e4e6;font-style:normal}
.chat em b{margin-right:5px;color:var(--green2);font-size:6px;text-transform:uppercase}
.job{position:absolute;right:15px;bottom:18px;width:210px;padding:13px;border:1px solid var(--line2);border-radius:12px;background:rgba(24,26,27,.97);box-shadow:0 18px 45px rgba(0,0,0,.4)}
.job-top{display:flex;justify-content:space-between;color:#d8dcdf;font-size:8px}
.job-top b{color:var(--amber);font-weight:700}
.bar{height:4px;margin-top:10px;border-radius:99px;background:#303336;overflow:hidden}
.bar:after{content:"";display:block;width:42%;height:100%;background:var(--green)}
.job-foot{display:flex;justify-content:space-between;margin-top:8px;color:#737980;font-size:7px}
.task{display:grid;grid-template-columns:35px 1fr auto;gap:11px;align-items:center;padding:14px;margin:10px 0;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.task.live{border-color:rgba(37,211,102,.21)}
.task-icon{width:35px;height:35px;display:grid;place-items:center;border-radius:10px;background:rgba(255,255,255,.05);font-size:8px;font-weight:800}
.task strong{display:block;color:var(--text2);font-size:10px}
.task small{display:block;margin-top:5px;color:var(--faint);font-size:8px}
.state{color:var(--green2);font-size:8px;font-weight:700;text-align:right}
.state.queue{color:var(--amber)}
.state span{display:block;margin-top:4px;color:var(--faint);font-size:7px;font-weight:500}
.layers{display:grid;gap:10px}
.layer{display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02)}
.lock{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:var(--greenSoft);color:var(--green2);font-size:15px}
.layer strong{display:block;font-size:10px}
.layer small{display:block;margin-top:4px;color:var(--faint);font-size:8px}
.layer code{color:var(--green2);font:700 7px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}
.cta{padding:68px;border:1px solid var(--line2);border-radius:23px;background:#0d0f10;position:relative;overflow:hidden}
.cta:after{content:"";position:absolute;right:-150px;top:-250px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(37,211,102,.14),transparent 66%);pointer-events:none}
.cta-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr .85fr;gap:64px;align-items:end}
.cta h2{margin:13px 0 16px}
.cta p{margin:0;color:var(--muted);font-size:14px;line-height:1.8}
.cta-actions{display:grid;gap:10px}
.cta-actions .btn{min-height:50px}
.use-cases .card{background:linear-gradient(180deg,rgba(37,211,102,.025),transparent 65%)}
.journey{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#0d0f10}
.journey-step{display:grid;grid-template-columns:48px 1fr;gap:18px;min-height:190px;padding:30px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.journey-step:nth-child(2n){border-right:0}
.journey-step:nth-last-child(-n+2){border-bottom:0}
.journey-num{width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(37,211,102,.25);border-radius:12px;background:var(--greenSoft);color:var(--green2);font:760 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}
.journey-step h3{margin:4px 0 10px;font-size:18px;letter-spacing:-.025em}
.journey-step p{margin:0;color:var(--muted);font-size:13px;line-height:1.78}
.journey-mini{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:26px 0 0}
.journey-mini span{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.018);color:var(--text2);font-size:11px}
.journey-mini b{color:var(--green2);font:760 8px ui-monospace,SFMono-Regular,Menlo,monospace}
.inline-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
.faq-list{display:grid;gap:10px;max-width:920px;margin:0 auto}
.faq-list details{border:1px solid var(--line);border-radius:14px;background:#0d0f10;overflow:hidden}
.faq-list details[open]{border-color:rgba(37,211,102,.24);background:linear-gradient(180deg,rgba(37,211,102,.035),#0d0f10 58%)}
.faq-list summary{position:relative;cursor:pointer;list-style:none;padding:22px 58px 22px 24px;color:var(--text2);font-size:15px;font-weight:680;letter-spacing:-.015em}
.faq-list summary::-webkit-details-marker{display:none}
.faq-list summary:after{content:"+";position:absolute;right:22px;top:50%;transform:translateY(-50%);color:var(--green2);font-size:20px;font-weight:400}
.faq-list details[open] summary:after{content:"−"}
.faq-list p{margin:0;padding:0 24px 22px;max-width:820px;color:var(--muted);font-size:13px;line-height:1.82}
.compat-note{margin:28px auto 0;max-width:920px;padding:20px 22px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.018)}
.compat-note.compact{margin:30px 0 0;max-width:none}
.compat-note strong{display:block;margin-bottom:7px;color:var(--text2);font-size:11px;letter-spacing:.02em}
.compat-note p{margin:0;color:var(--faint);font-size:11px;line-height:1.75}
.footer{padding:38px 0 44px;border-top:1px solid var(--line)}
.foot-stack{display:grid;gap:18px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:20px;color:var(--faint);font-size:10px}
.foot-brand{display:flex;align-items:center;gap:8px;color:var(--text2);font-weight:700}
.foot-brand .brand-mark{width:25px;height:25px}
.foot-links{display:flex;gap:18px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.foot-links a:hover{color:var(--text2)}
.footer-disclaimer{margin:0;max-width:980px;color:#565c62;font-size:9px;line-height:1.65}

@media(max-width:1040px){.nav-links{display:none}
.hero-grid,.split{grid-template-columns:1fr;gap:48px}
.stage{max-width:760px;width:100%;margin:0 auto}
.section-head{grid-template-columns:1fr;gap:20px}
.cta-grid{grid-template-columns:1fr;gap:30px}
}
@media(max-width:760px){.shell{width:min(100% - 32px,1180px)}
.nav{height:64px}
.brand small,.nav-login{display:none}
.nav-actions .btn{min-height:38px;padding:0 13px;font-size:12px}
.hero{padding:76px 0 58px}
h1{font-size:clamp(43px,13vw,62px)}
.lede{font-size:15px}
.hero-actions{display:grid}
.hero-actions .btn{width:100%}
.stage{min-height:430px;border-radius:15px}
.stage-body{height:388px}
.rail-demo{grid-template-columns:78px 1fr;height:388px}
.acct{grid-template-columns:26px 5px;justify-content:center}
.acct span{display:none}
.accounts{padding:10px 6px}
.job{width:172px;right:8px}
.metrics{grid-template-columns:repeat(2,1fr)}
.metric:nth-child(2){border-right:0}
.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}
.section{padding:86px 0}
.cards{grid-template-columns:1fr}
.card{min-height:210px;border-right:0;border-bottom:1px solid var(--line)}
.card:last-child{border-bottom:0}
.card-top{margin-bottom:40px}
.panel{min-height:380px;padding:19px}
.quote.green{margin-left:20px}
.task{grid-template-columns:32px 1fr}
.state{grid-column:2;text-align:left}
.journey{grid-template-columns:1fr}
.journey-step,.journey-step:nth-child(2n){border-right:0;border-bottom:1px solid var(--line)}
.journey-step:last-child{border-bottom:0}
.journey-mini{grid-template-columns:1fr}
.inline-actions{display:grid}
.inline-actions .btn{width:100%}
.faq-list summary{padding:20px 52px 20px 20px}
.faq-list p{padding:0 20px 20px}
.cta{padding:39px 25px}
.foot{flex-direction:column;align-items:flex-start}
.foot-links{justify-content:flex-start}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}
*,*:before,*:after{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}
}

`;

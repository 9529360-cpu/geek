if (!window.isScriptInjected) {
  window.isScriptInjected = !0;
  var inter2 = setInterval(() => {
    try {
      if ('object' == typeof window.require('WAWebABProps') && 'function' == typeof window.require('WAWebABProps').getABPropConfigValue && !window.getABPropConfigValueWraped) {
        window.getABPropConfigValueWraped = !0;
        clearInterval(inter2);
        localStorage.setItem('wa_calls_enabled', 'true');
        console.log('<!> getABPropConfigValue is loaded and nulled');
        const g = require('WAWebABProps').getABPropConfigValue;
        require('WAWebABProps').getABPropConfigValue = (function (f, d) {
          return function (...c) {
            return d(f, ...c);
          };
        })(g, (f, ...d) => {
          const [c] = d;
          switch (c) {
            case 'high_quality_link_preview_enabled':
              return !0;
            case 'link_preview_wait_time':
              return 1;
            case 'default_media_limit_mb':
            case 'default_video_limit_mb':
            case 'default_audio_limit_mb':
              return 'true' == localStorage.getItem('maxvideoupload') ? 200 : 16;
            case 'disable_status_to_non_sub':
              return !1;
            case 'message_edit_window_duration_seconds':
            case 'message_edit_client_entry_point_limit_seconds':
              return 1e30;
            case 'post_status_in_companion':
            case 'web_status_posting_enabled':
            case 'web_send_view_once_ptt_enabled':
            case 'web_status_psa':
            case 'web_status_psa_history_sync':
            case 'web_chatlist_toggle':
            case 'web_status_private_mentions_receive_enabled':
            case 'web_status_private_mentions_send_enabled':
            case 'web_status_likes_send_enabled':
            case 'parent_group_create_enabled_for_smb_on_web':
            case 'status_mentions_in_chat_receiver':
            case 'status_ranking_poster_side_gating_enabled':
            case 'status_future_proofing':
            case 'web_link_preview_nse_support':
            case 'bonsai_ptt_enabled':
            case 'lid_status_send_enabled':
              return !0;
            case 'smart_filters_enabled':
            case 'smart_filters_enabled_consumer':
            case 'inbox_filters_enabled':
            case 'inbox_filters_smb_enabled':
              !1;
            case 'web_status_drawer_enabled':
            case 'top_menu_redesign_enabled':
            case 'web_attach_menu_redesign':
            case 'wa_web_growth_empty_state_upsell_m1':
            case 'wa_web_growth_empty_state_upsell_variant_m1':
            case 'web_intern_dogfooding_upsell_enabled':
            case 'web_mac_beta_upsell':
            case 'wa_web_app_lock_upsell':
            case 'wa_web_smb_windows_hybrid_upsell':
            case 'enable_uwp_device_switch_banner':
            case 'message_capping_upsell_version':
            case 'inapp_banner_client_enabled':
            case 'quick_promotion_banner_client_enabled':
            case 'quick_promotion_settings_banner_client_enabled':
            case 'updates_quick_promotion_banner_enabled':
            case 'qp_campaign_client_enabled':
            case 'desktop_upsell_win_cta_intro_panel':
            case 'desktop_upsell_mac_cta_intro_panel':
              return !1;
            case 'wa_web_growth_empty_state_upsell_variant_m1':
              return 0;
            case 'enable_web_calling':
            case 'enable_web_group_calling':
            case 'web_voip_call_tab_new_call':
            case 'enable_web_calls_tab':
            case 'web_calling_screen_sharing':
              return !0;
            case 'calling_lid_version':
              return 1;
            case 'heartbeat_interval_s':
              return 5;
            default:
              return c && 'string' === typeof c && (c.includes('desktop_upsell') || c.includes('upsell') || c.includes('_banner') || c.includes('promotion') || c.includes('dogfooding'))
                ? (console.log('[ABProps] Bloqueando:', c), !1)
                : f(...d);
          }
        });
      }
    } catch (g) {}
  }, 100);
}
function init2() {
  function g() {
    var a = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xe93d63.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl');
    a && (a.style.display = 'none');
    if ((a = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.xeuugli.x2lwn1j.xozqiw3.x1oa3qoh.x12fk4p8.x78zum5.x1qughib'))) a.style.display = 'none';
  }
  function f() {
    let a = document.getElementById('wa-selector-container');
    if (!a) {
      a = document.createElement('div');
      a.id = 'wa-selector-container';
      a.style.cssText =
        '\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                padding: 40px;\n                text-align: center;\n                min-height: 400px;\n                width: 100%;\n            ';
      const b = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xe93d63.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl');
      b && b.parentNode && b.parentNode.insertBefore(a, b);
    }
    return a;
  }
  function d() {
    g();
    f().innerHTML =
      '\n            <div style="margin-bottom: 30px;">\n                <h2 style="font-size: 24px; font-weight: 600; color: #111b21; margin-bottom: 10px;">\n                    Qual tipo de conta?\n                </h2>\n                <p style="font-size: 14px; color: #667781;">\n                    Selecione o tipo de WhatsApp que voc\u00ea vai conectar\n                </p>\n            </div>\n            \n            <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: center;">\n                <button id="wa-btn-normal" class="wa-selector-btn" style="\n                    display: flex;\n                    flex-direction: column;\n                    align-items: center;\n                    padding: 30px 40px;\n                    border: 2px solid #e9edef;\n                    border-radius: 16px;\n                    background: #ffffff;\n                    cursor: pointer;\n                    transition: all 0.2s ease;\n                    min-width: 180px;\n                ">\n                    <div style="\n                        width: 80px;\n                        height: 80px;\n                        border-radius: 50%;\n                        background: #25D366;\n                        display: flex;\n                        align-items: center;\n                        justify-content: center;\n                        margin-bottom: 15px;\n                    ">\n                        <svg viewBox="0 0 40 40" height="48" width="48" fill="none">\n                            <path fill-rule="evenodd" clip-rule="evenodd" d="M20 4C11.163 4 4 11.163 4 20c0 2.987.82 5.78 2.246 8.17L4 36l8.168-2.14A15.93 15.93 0 0020 36c8.837 0 16-7.163 16-16S28.837 4 20 4zm0 29.2c-2.716 0-5.27-.72-7.47-1.98l-.536-.316-5.554 1.456 1.482-5.416-.348-.553A13.11 13.11 0 016.8 20c0-7.29 5.91-13.2 13.2-13.2S33.2 12.71 33.2 20 27.29 33.2 20 33.2z" fill="white"/>\n                            <path fill-rule="evenodd" clip-rule="evenodd" d="M27.36 23.04c-.36-.18-2.13-1.05-2.46-1.17-.33-.12-.57-.18-.81.18-.24.36-.93 1.17-1.14 1.41-.21.24-.42.27-.78.09-.36-.18-1.52-.56-2.9-1.79-1.07-.96-1.79-2.14-2-2.5-.21-.36-.02-.56.16-.74.16-.16.36-.42.54-.63.18-.21.24-.36.36-.6.12-.24.06-.45-.03-.63-.09-.18-.81-1.95-1.11-2.67-.29-.7-.59-.61-.81-.62-.21-.01-.45-.01-.69-.01-.24 0-.63.09-.96.45-.33.36-1.26 1.23-1.26 3s1.29 3.48 1.47 3.72c.18.24 2.54 3.87 6.15 5.43.86.37 1.53.59 2.05.76.86.27 1.65.23 2.27.14.69-.1 2.13-.87 2.43-1.71.3-.84.3-1.56.21-1.71-.09-.15-.33-.24-.69-.42z" fill="white"/>\n                        </svg>\n                    </div>\n                    <span style="font-size: 18px; font-weight: 600; color: #111b21;">WhatsApp</span>\n                    <span style="font-size: 13px; color: #667781; margin-top: 5px;">Conta pessoal</span>\n                </button>\n\n                <button id="wa-btn-business" class="wa-selector-btn" style="\n                    display: flex;\n                    flex-direction: column;\n                    align-items: center;\n                    padding: 30px 40px;\n                    border: 2px solid #e9edef;\n                    border-radius: 16px;\n                    background: #ffffff;\n                    cursor: pointer;\n                    transition: all 0.2s ease;\n                    min-width: 180px;\n                ">\n                    <div style="\n                        width: 80px;\n                        height: 80px;\n                        border-radius: 50%;\n                        background: #25D366;\n                        display: flex;\n                        align-items: center;\n                        justify-content: center;\n                        margin-bottom: 15px;\n                    ">\n                        <svg viewBox="0 0 40 40" height="48" width="48" fill="none">\n                            <path fill-rule="evenodd" clip-rule="evenodd" d="M20 4C11.163 4 4 11.163 4 20c0 2.987.82 5.78 2.246 8.17L4 36l8.168-2.14A15.93 15.93 0 0020 36c8.837 0 16-7.163 16-16S28.837 4 20 4zm0 29.2c-2.716 0-5.27-.72-7.47-1.98l-.536-.316-5.554 1.456 1.482-5.416-.348-.553A13.11 13.11 0 016.8 20c0-7.29 5.91-13.2 13.2-13.2S33.2 12.71 33.2 20 27.29 33.2 20 33.2z" fill="white"/>\n                            <rect x="13" y="13" width="14" height="10" rx="1" fill="white"/>\n                            <path d="M15 16h10M15 19h6" stroke="#25D366" stroke-width="1.5"/>\n                        </svg>\n                    </div>\n                    <span style="font-size: 18px; font-weight: 600; color: #111b21;">Business</span>\n                    <span style="font-size: 13px; color: #667781; margin-top: 5px;">Conta comercial</span>\n                </button>\n            </div>\n        ';
    l();
    document.getElementById('wa-btn-normal').addEventListener('click', function () {
      localStorage.setItem('wa_account_type', 'normal');
      localStorage.setItem('wa_platform', 'iphone');
      c();
    });
    document.getElementById('wa-btn-business').addEventListener('click', function () {
      localStorage.setItem('wa_account_type', 'business');
      localStorage.setItem('wa_platform', 'iphone_smb');
      c();
    });
  }
  function c() {
    const a = localStorage.getItem('wa_account_type'),
      b = localStorage.getItem('wa_platform');
    console.log('[WA Selector] Sele\u00e7\u00e3o finalizada:', { accountType: a, platform: b });
    var e = document.getElementById('wa-selector-container');
    e && e.remove();
    if ((e = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xe93d63.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl'))) e.style.display = '';
    if ((e = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.xeuugli.x2lwn1j.xozqiw3.x1oa3qoh.x12fk4p8.x78zum5.x1qughib'))) e.style.display = '';
    m(a, b);
  }
  function m(a, b) {
    !document.getElementById('wa-status-bar') &&
      ((b = 'business' === a ? 'Business' : 'Pessoal'),
      (a = document.createElement('div')),
      (a.id = 'wa-status-bar'),
      (a.style.cssText =
        '\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            padding: 12px 16px;\n            background: #e7f5e9;\n            border-radius: 10px;\n            border: 1px solid #25D366;\n            margin-bottom: 20px;\n        '),
      (a.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: #25D366;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg viewBox="0 0 24 24" height="16" width="16" fill="white">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                </div>
                <span style="font-size: 14px; font-weight: 600; color: #111b21;">
                    WhatsApp ${b}
                </span>
            </div>
            <button id="wa-change-btn" style="
                background: #ffffff;
                border: 1px solid #25D366;
                color: #008069;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                padding: 8px 16px;
                border-radius: 20px;
                transition: all 0.2s;
            ">
                Alterar
            </button>
        `),
      (b = document.querySelector('.x579bpy.xo1l8bm.xggjnk3'))
        ? (b = b.closest('.x1c4vz4f.xs83m0k')) && b.insertBefore(a, b.firstChild)
        : (b = document.querySelector('.x1c4vz4f.xs83m0k.xdl72j9.x1g77sc7.x78zum5.xozqiw3.x1oa3qoh.x12fk4p8.xe93d63.xeuugli.x2lwn1j.x1nhvcw1.xdt5ytf.x1cy8zhl')) && b.insertBefore(a, b.firstChild),
      (a = a.querySelector('#wa-change-btn'))) &&
      (a.addEventListener('mouseenter', function () {
        this.style.background = '#e7f5e9';
      }),
      a.addEventListener('mouseleave', function () {
        this.style.background = '#ffffff';
      }),
      a.addEventListener('click', function () {
        localStorage.removeItem('wa_account_type');
        localStorage.removeItem('wa_platform');
        window.location.reload();
      }));
  }
  function l() {
    document.querySelectorAll('.wa-selector-btn').forEach((a) => {
      a.addEventListener('mouseenter', function () {
        this.style.borderColor = '#25D366';
        this.style.transform = 'scale(1.02)';
      });
      a.addEventListener('mouseleave', function () {
        this.style.borderColor = '#e9edef';
        this.style.transform = 'scale(1)';
      });
    });
  }
  function k() {
    h || !document.querySelector('.x579bpy.xo1l8bm.xggjnk3') || document.getElementById('wa-selector-container') || ((h = !0), d(), console.log('[WA Selector] Inicializado'));
  }
  localStorage.removeItem('wa_account_type');
  localStorage.removeItem('wa_platform');
  let h = !1;
  new MutationObserver(function (a) {
    h || k();
  }).observe(document.documentElement, { childList: !0, subtree: !0 });
  k();
}

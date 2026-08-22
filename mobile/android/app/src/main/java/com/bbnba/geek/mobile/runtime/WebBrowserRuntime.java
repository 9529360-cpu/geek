package com.bbnba.geek.mobile.runtime;

import java.util.Locale;

public final class WebBrowserRuntime implements BrowserRuntime {
    @Override
    public boolean isAvailable() {
        return true;
    }

    @Override
    public String startUrl(String platform) {
        if ("telegram".equals(platform)) return "https://web.telegram.org/a/";
        if ("line".equals(platform)) return "https://access.line.me/";
        return "https://web.whatsapp.com/";
    }

    @Override
    public String displayName(String platform) {
        if ("telegram".equals(platform)) return "Telegram";
        if ("line".equals(platform)) return "LINE";
        return "WhatsApp";
    }

    @Override
    public boolean isAllowedOrigin(String platform, String scheme, String host) {
        if (!"https".equalsIgnoreCase(scheme) || host == null) return false;
        String normalized = host.toLowerCase(Locale.ROOT);
        if ("telegram".equals(platform)) return normalized.equals("web.telegram.org") || normalized.endsWith(".telegram.org");
        if ("line".equals(platform)) return normalized.equals("access.line.me") || normalized.endsWith(".line.me");
        return normalized.equals("web.whatsapp.com") || normalized.endsWith(".whatsapp.com");
    }
}

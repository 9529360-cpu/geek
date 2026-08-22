package com.bbnba.geek.mobile.runtime;

public interface BrowserRuntime {
    boolean isAvailable();
    String startUrl(String platform);
    String displayName(String platform);
    boolean isAllowedOrigin(String platform, String scheme, String host);
}

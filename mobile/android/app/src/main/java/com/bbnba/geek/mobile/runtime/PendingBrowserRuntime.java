package com.bbnba.geek.mobile.runtime;

public final class PendingBrowserRuntime implements BrowserRuntime {
    @Override
    public boolean isAvailable() {
        return false;
    }

    @Override
    public String unavailableReason() {
        return "单账号登录内核将在下一阶段接入";
    }
}

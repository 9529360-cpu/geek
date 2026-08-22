package com.bbnba.geek.mobile.runtime;

/** Boundary for the account web engine implemented in MOB-002. */
public interface BrowserRuntime {
    boolean isAvailable();
    String unavailableReason();
}

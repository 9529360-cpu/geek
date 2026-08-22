package com.bbnba.geek.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import com.bbnba.geek.mobile.runtime.WebBrowserRuntime;

public final class ShellStateTest {
    @Test
    public void startsOnAccountsAndCanNavigate() {
        ShellState state = new ShellState();
        assertEquals(ShellState.Section.ACCOUNTS, state.selected());

        state.select(ShellState.Section.TOOLS);
        assertEquals(ShellState.Section.TOOLS, state.selected());
        assertEquals("工具", state.selected().label());
    }

    @Test(expected = NullPointerException.class)
    public void rejectsMissingSection() {
        new ShellState().select(null);
    }

    @Test
    public void browserRuntimeAllowsOnlySelectedPlatformHttpsOrigins() {
        WebBrowserRuntime runtime = new WebBrowserRuntime();
        assertEquals(true, runtime.isAllowedOrigin("telegram", "https", "web.telegram.org"));
        assertEquals(true, runtime.isAllowedOrigin("telegram", "https", "cdn.telegram.org"));
        assertEquals(false, runtime.isAllowedOrigin("telegram", "http", "web.telegram.org"));
        assertEquals(false, runtime.isAllowedOrigin("telegram", "https", "example.com"));
        assertEquals("https://web.whatsapp.com/", runtime.startUrl("whatsapp"));
    }
}

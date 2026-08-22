package com.bbnba.geek.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

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
}

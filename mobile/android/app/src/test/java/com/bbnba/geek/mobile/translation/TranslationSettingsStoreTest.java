package com.bbnba.geek.mobile.translation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public final class TranslationSettingsStoreTest {
    @Test
    public void chatScopeIsStableAndDoesNotExposeTheConversationId() {
        String first = TranslationSettingsStore.chatScopeKey("-100123456789");
        String again = TranslationSettingsStore.chatScopeKey("-100123456789");
        String other = TranslationSettingsStore.chatScopeKey("-100987654321");

        assertEquals(first, again);
        assertEquals(24, first.length());
        assertFalse(first.contains("123456789"));
        assertFalse(first.equals(other));
    }
}

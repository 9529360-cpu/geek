package com.bbnba.geek.mobile.translation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class GeekTranslationClientContractTest {
    @Test
    public void mobileUsesTheSameProductionServicesAsDesktop() {
        assertEquals("https://geek-subscription.9529360.workers.dev", GeekTranslationClient.SUBSCRIPTION_ORIGIN);
        assertEquals("https://geek-translate.9529360.workers.dev", GeekTranslationClient.TRANSLATION_ORIGIN);
        assertTrue(GeekTranslationClient.SUBSCRIPTION_ORIGIN.startsWith("https://"));
        assertTrue(GeekTranslationClient.TRANSLATION_ORIGIN.startsWith("https://"));
    }
}

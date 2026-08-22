package com.bbnba.geek.mobile;

public final class AccountSlotAllocator {
    public static final int MAX_ISOLATED_SLOTS = 3;

    private AccountSlotAllocator() {}

    public static int firstAvailable(boolean[] used) {
        if (used == null || used.length < MAX_ISOLATED_SLOTS + 1) {
            throw new IllegalArgumentException("used must contain indexes 0 through 3");
        }
        for (int slot = 1; slot <= MAX_ISOLATED_SLOTS; slot++) {
            if (!used[slot]) return slot;
        }
        return -1;
    }
}

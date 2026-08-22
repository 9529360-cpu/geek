package com.bbnba.geek.mobile;

import java.util.Objects;

public final class ShellState {
    public enum Section {
        APPLICATIONS("应用中心"),
        ACCOUNTS("账户列表"),
        PROFILE("我的");

        private final String label;

        Section(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    private Section selected = Section.ACCOUNTS;

    public Section selected() {
        return selected;
    }

    public void select(Section section) {
        selected = Objects.requireNonNull(section, "section");
    }
}

package com.bbnba.geek.mobile;

import java.util.Objects;

public final class ShellState {
    public enum Section {
        ACCOUNTS("账号"),
        CONVERSATIONS("会话"),
        TOOLS("工具"),
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

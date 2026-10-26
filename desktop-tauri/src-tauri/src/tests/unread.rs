use crate::domain::unread::{
    apply_observations, combine_unread, monitors, parse_dom_count, title_unread, UnreadObservation,
};

fn row(id: &str, count: u32) -> UnreadObservation {
    UnreadObservation {
        id: id.to_string(),
        count,
    }
}

#[test]
fn title_and_dom_counts_stay_numeric() {
    assert_eq!(title_unread("(3) WhatsApp"), 3);
    assert_eq!(title_unread("[12] Telegram"), 12);
    assert_eq!(title_unread("（8） WhatsApp"), 8);
    assert_eq!(title_unread("( 4 ) x"), 4);
    assert_eq!(title_unread("WhatsApp"), 0);
    assert_eq!(title_unread("(1234567) too many"), 0);
    assert_eq!(title_unread(""), 0);
    assert_eq!(combine_unread(2, 9), 9);
    assert_eq!(combine_unread(20, 4), 20);
    assert_eq!(parse_dom_count("7"), Some(7));
    assert_eq!(parse_dom_count("\"11\""), Some(11));
    assert_eq!(parse_dom_count("聊天"), None);
    assert_eq!(parse_dom_count("10000"), None);
    assert!(monitors("whatsapp-pure"));
    assert!(monitors("telegram-z"));
    assert!(!monitors("messenger"));
    assert!(!monitors("line"));
}

#[test]
fn opening_an_account_clears_once_and_a_later_increase_notifies() {
    let observed = vec![row("a", 5), row("b", 2)];
    let first = apply_observations(&[], &observed, None, Some("a"));
    assert_eq!(first.counts, vec![row("a", 0), row("b", 2)]);
    assert_eq!(first.notices, vec![row("b", 2)]);
    let second = apply_observations(
        &first.counts,
        &observed,
        first.focused.as_deref(),
        Some("a"),
    );
    assert_eq!(second.notices, vec![row("a", 5)]);
    assert_eq!(second.counts, observed);
    let steady = apply_observations(
        &second.counts,
        &observed,
        second.focused.as_deref(),
        Some("a"),
    );
    assert!(steady.notices.is_empty());
    let quieter = apply_observations(
        &second.counts,
        &[row("a", 1), row("b", 2)],
        Some("a"),
        Some("a"),
    );
    assert!(quieter.notices.is_empty());
    assert_eq!(quieter.counts[0].count, 1);
}

#[test]
fn a_closed_account_drops_out_and_an_unrelated_focus_does_not_clear_whatsapp() {
    let previous = vec![row("a", 4)];
    let update = apply_observations(&previous, &[], Some("a"), Some("missing"));
    assert!(update.counts.is_empty());
    assert!(update.notices.is_empty());
    assert_eq!(update.focused, None);
}

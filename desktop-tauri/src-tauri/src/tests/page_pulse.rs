use crate::domain::page_pulse::PagePulse;

#[test]
fn two_misses_reload_twice_a_minute_and_a_live_probe_clears_the_streak() {
    let mut pulse = PagePulse::new();
    assert!(!pulse.observe("wa", false, 0));
    assert!(pulse.observe("wa", false, 1_000));
    assert!(!pulse.observe("wa", true, 2_000));
    assert!(!pulse.observe("wa", false, 3_000));
    assert!(pulse.observe("wa", false, 4_000));
    assert!(!pulse.observe("wa", false, 5_000));
    assert!(!pulse.observe("wa", false, 6_000));
    assert!(!pulse.observe("other", false, 6_000));
    assert!(pulse.observe("other", false, 7_000));
    assert!(pulse.observe("wa", false, 70_000));
}

#[test]
fn forgetting_an_account_drops_its_misses() {
    let mut pulse = PagePulse::new();
    assert!(!pulse.observe("wa", false, 0));
    pulse.forget("wa");
    assert!(!pulse.observe("wa", false, 10));
    assert!(pulse.observe("wa", false, 20));
}

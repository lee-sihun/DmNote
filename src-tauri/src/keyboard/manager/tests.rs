use std::collections::HashMap;

use crate::{
    ipc::InputDeviceKind,
    models::{KeySlot, SlotMatch},
};

use super::{KeyboardManager, MatchOutcome, SlotEvent};

fn single(key: &str) -> KeySlot {
    KeySlot::Single(key.to_string())
}

fn multi(keys: &[&str], match_mode: SlotMatch) -> KeySlot {
    KeySlot::Multi {
        keys: keys.iter().map(|key| (*key).to_string()).collect(),
        match_mode,
    }
}

fn input(
    manager: &KeyboardManager,
    physical_id: Option<&str>,
    device: InputDeviceKind,
    labels: &[&str],
    is_down: bool,
) -> Option<MatchOutcome> {
    manager.match_and_register(physical_id, device, labels.iter().copied(), is_down)
}

fn event(
    canonical: &str,
    slot_indices: Vec<usize>,
    transition: Option<bool>,
    press: bool,
) -> SlotEvent {
    SlotEvent {
        canonical: canonical.to_string(),
        slot_indices,
        transition,
        press,
        can_use_physical_hold_duration: false,
    }
}

fn event_with_physical_hold(
    canonical: &str,
    slot_indices: Vec<usize>,
    transition: Option<bool>,
    press: bool,
) -> SlotEvent {
    SlotEvent {
        can_use_physical_hold_duration: true,
        ..event(canonical, slot_indices, transition, press)
    }
}

#[test]
fn any_slot_counts_each_alternating_fresh_press_and_transitions_at_edges() {
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![multi(&["Z", "B"], SlotMatch::Any)])]),
        "mode",
    );

    let z_down = input(
        &manager,
        Some("keyboard:z"),
        InputDeviceKind::Keyboard,
        &["Z"],
        true,
    )
    .unwrap();
    assert_eq!(z_down.pressed_label.as_deref(), Some("Z"));
    assert_eq!(z_down.events, vec![event("Z|B", vec![0], Some(true), true)]);

    let b_down = input(
        &manager,
        Some("keyboard:b"),
        InputDeviceKind::Keyboard,
        &["B"],
        true,
    )
    .unwrap();
    assert_eq!(b_down.events, vec![event("Z|B", vec![0], None, true)]);
    assert_eq!(
        input(
            &manager,
            Some("keyboard:b"),
            InputDeviceKind::Keyboard,
            &["B"],
            false,
        )
        .unwrap()
        .events,
        vec![event("Z|B", vec![0], None, false)]
    );
    assert_eq!(
        input(
            &manager,
            Some("keyboard:b"),
            InputDeviceKind::Keyboard,
            &["B"],
            true,
        )
        .unwrap()
        .events,
        vec![event("Z|B", vec![0], None, true)]
    );
    input(
        &manager,
        Some("keyboard:z"),
        InputDeviceKind::Keyboard,
        &["Z"],
        false,
    );
    assert_eq!(
        input(
            &manager,
            Some("keyboard:b"),
            InputDeviceKind::Keyboard,
            &["B"],
            false,
        )
        .unwrap()
        .events,
        vec![event("Z|B", vec![0], Some(false), false)]
    );

    input(
        &manager,
        Some("keyboard:z"),
        InputDeviceKind::Keyboard,
        &["Z"],
        true,
    );
    input(
        &manager,
        Some("keyboard:b"),
        InputDeviceKind::Keyboard,
        &["B"],
        true,
    );
    input(
        &manager,
        Some("keyboard:b"),
        InputDeviceKind::Keyboard,
        &["B"],
        false,
    );
    assert_eq!(
        input(
            &manager,
            Some("keyboard:z"),
            InputDeviceKind::Keyboard,
            &["Z"],
            false,
        )
        .unwrap()
        .events,
        vec![event_with_physical_hold("Z|B", vec![0], Some(false), false,)]
    );
}

#[test]
fn all_slot_completes_and_recompletes_in_either_order() {
    let manager = KeyboardManager::new(
        HashMap::from([(
            "mode".to_string(),
            vec![multi(&["LEFT CTRL", "Z"], SlotMatch::All)],
        )]),
        "mode",
    );

    assert_eq!(
        input(&manager, Some("z"), InputDeviceKind::Keyboard, &["Z"], true,)
            .unwrap()
            .events,
        vec![event("LEFT CTRL+Z", vec![0], None, false)]
    );
    assert_eq!(
        input(
            &manager,
            Some("ctrl"),
            InputDeviceKind::Keyboard,
            &["LEFT CTRL"],
            true,
        )
        .unwrap()
        .events,
        vec![event("LEFT CTRL+Z", vec![0], Some(true), true)]
    );
    assert_eq!(
        input(
            &manager,
            Some("z"),
            InputDeviceKind::Keyboard,
            &["Z"],
            false,
        )
        .unwrap()
        .events,
        vec![event("LEFT CTRL+Z", vec![0], Some(false), false)]
    );
    assert_eq!(
        input(&manager, Some("z"), InputDeviceKind::Keyboard, &["Z"], true,)
            .unwrap()
            .events,
        vec![event("LEFT CTRL+Z", vec![0], Some(true), true)]
    );
    assert_eq!(
        input(
            &manager,
            Some("z"),
            InputDeviceKind::Keyboard,
            &["Z"],
            false,
        )
        .unwrap()
        .events,
        vec![event_with_physical_hold(
            "LEFT CTRL+Z",
            vec![0],
            Some(false),
            false,
        )]
    );
}

#[test]
fn repeat_down_and_ghost_up_are_suppressed_by_physical_identity() {
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![single("A")])]),
        "mode",
    );

    assert!(input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .is_some());
    assert!(input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .is_none());
    assert!(input(
        &manager,
        Some("physical:ghost"),
        InputDeviceKind::Keyboard,
        &["A"],
        false,
    )
    .is_none());
    assert!(input(
        &manager,
        Some("physical:empty"),
        InputDeviceKind::Keyboard,
        &[],
        true,
    )
    .is_some());
    assert!(input(
        &manager,
        Some("physical:empty"),
        InputDeviceKind::Keyboard,
        &[],
        false,
    )
    .is_some());
}

#[test]
fn overlapping_same_label_uses_physical_hold_only_when_transition_sources_match() {
    let mappings = HashMap::from([("mode".to_string(), vec![single("A")])]);

    let different_source = KeyboardManager::new(mappings.clone(), "mode");
    let first_down = input(
        &different_source,
        Some("keyboard-1:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .unwrap();
    assert_eq!(
        first_down.events,
        vec![event("A", vec![0], Some(true), true)]
    );
    assert_eq!(
        input(
            &different_source,
            Some("keyboard-2:a"),
            InputDeviceKind::Keyboard,
            &["A"],
            true,
        )
        .unwrap()
        .events,
        vec![event("A", vec![0], None, true)]
    );
    assert_eq!(
        input(
            &different_source,
            Some("keyboard-1:a"),
            InputDeviceKind::Keyboard,
            &["A"],
            false,
        )
        .unwrap()
        .events,
        vec![event("A", vec![0], None, false)]
    );
    assert_eq!(
        input(
            &different_source,
            Some("keyboard-2:a"),
            InputDeviceKind::Keyboard,
            &["A"],
            false,
        )
        .unwrap()
        .events,
        vec![event("A", vec![0], Some(false), false)]
    );

    let same_source = KeyboardManager::new(mappings, "mode");
    input(
        &same_source,
        Some("keyboard-1:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );
    input(
        &same_source,
        Some("keyboard-2:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );
    input(
        &same_source,
        Some("keyboard-2:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        false,
    );
    assert_eq!(
        input(
            &same_source,
            Some("keyboard-1:a"),
            InputDeviceKind::Keyboard,
            &["A"],
            false,
        )
        .unwrap()
        .events,
        vec![event_with_physical_hold("A", vec![0], Some(false), false,)]
    );
}

#[test]
fn mapping_rebuild_discards_unknown_activation_source() {
    let mappings = HashMap::from([("mode".to_string(), vec![single("A")])]);
    let manager = KeyboardManager::new(mappings.clone(), "mode");
    input(
        &manager,
        Some("keyboard:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );

    manager.update_mappings(mappings);

    assert_eq!(
        input(
            &manager,
            Some("keyboard:a"),
            InputDeviceKind::Keyboard,
            &["A"],
            false,
        )
        .unwrap()
        .events,
        vec![event("A", vec![0], Some(false), false)]
    );
}

#[test]
fn mode_switch_and_mapping_removal_do_not_lose_later_key_up() {
    let manager = KeyboardManager::new(
        HashMap::from([
            ("source".to_string(), vec![single("A")]),
            ("target".to_string(), vec![single("B")]),
        ]),
        "source",
    );
    input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );
    assert!(manager.set_mode("target"));
    assert!(input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["changed-up-label"],
        false,
    )
    .is_some());
    assert!(manager.set_mode("source"));
    assert!(manager.pressed_keys().is_empty());

    input(
        &manager,
        Some("physical:a2"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );
    manager.update_mappings(HashMap::from([("source".to_string(), Vec::new())]));
    assert!(input(
        &manager,
        Some("physical:a2"),
        InputDeviceKind::Keyboard,
        &["A"],
        false,
    )
    .is_some());
    manager.update_mappings(HashMap::from([("source".to_string(), vec![single("A")])]));
    assert!(manager.pressed_keys().is_empty());
}

#[test]
fn held_unmapped_key_activates_when_switching_to_a_matching_mode() {
    let manager = KeyboardManager::new(
        HashMap::from([
            ("source".to_string(), vec![single("B")]),
            ("target".to_string(), vec![single("A")]),
        ]),
        "source",
    );
    let down = input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .unwrap();
    assert!(down.pressed_label.is_none());

    assert!(manager.set_mode("target"));
    assert_eq!(manager.pressed_keys(), vec!["A"]);
}

#[test]
fn collect_sound_dispatch_merges_press_slots_into_single_dispatch() {
    let events = vec![
        SlotEvent {
            canonical: "A".to_string(),
            slot_indices: vec![1],
            transition: Some(true),
            press: true,
            can_use_physical_hold_duration: false,
        },
        SlotEvent {
            canonical: "A|B".to_string(),
            slot_indices: vec![0, 1],
            transition: None,
            press: true,
            can_use_physical_hold_duration: false,
        },
        SlotEvent {
            canonical: "C".to_string(),
            slot_indices: vec![2],
            transition: Some(false),
            press: false,
            can_use_physical_hold_duration: true,
        },
    ];

    let (canonical, indices) = super::collect_sound_dispatch(&events).unwrap();

    assert_eq!(canonical, "A");
    assert_eq!(indices, vec![0, 1]);

    // press 이벤트가 없으면 디스패치 자체가 없음
    assert!(super::collect_sound_dispatch(&events[2..]).is_none());
}

#[test]
fn shared_member_fans_out_slots_but_resolves_one_physical_press() {
    let manager = KeyboardManager::new(
        HashMap::from([(
            "mode".to_string(),
            vec![single("A"), multi(&["A", "B"], SlotMatch::Any)],
        )]),
        "mode",
    );

    let outcome = input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .unwrap();
    assert_eq!(outcome.pressed_label.as_deref(), Some("A"));
    assert_eq!(
        outcome.events,
        vec![
            event("A", vec![0], Some(true), true),
            event("A|B", vec![1], Some(true), true),
        ]
    );
}

#[test]
fn duplicate_canonical_slots_deduplicate_event_and_collect_indices() {
    let slot = multi(&["A", "B"], SlotMatch::Any);
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![slot.clone(), slot])]),
        "mode",
    );

    let outcome = input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .unwrap();
    assert_eq!(
        outcome.events,
        vec![event("A|B", vec![0, 1], Some(true), true)]
    );
}

#[test]
fn alias_candidates_resolve_only_the_first_matching_label() {
    let manager = KeyboardManager::new(
        HashMap::from([(
            "mode".to_string(),
            vec![multi(&["21", "RIGHT ALT"], SlotMatch::All)],
        )]),
        "mode",
    );

    let alias = input(
        &manager,
        Some("physical:altgr"),
        InputDeviceKind::Keyboard,
        &["21", "RIGHT ALT"],
        true,
    )
    .unwrap();
    assert_eq!(alias.pressed_label.as_deref(), Some("21"));
    assert_eq!(alias.events[0].transition, None);

    let second = input(
        &manager,
        Some("physical:right-alt-2"),
        InputDeviceKind::Keyboard,
        &["RIGHT ALT"],
        true,
    )
    .unwrap();
    assert_eq!(second.events[0].transition, Some(true));
}

#[test]
fn key_up_uses_resolved_label_saved_on_key_down() {
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![single("RIGHT ALT")])]),
        "mode",
    );
    input(
        &manager,
        Some("physical:altgr"),
        InputDeviceKind::Keyboard,
        &["21", "RIGHT ALT"],
        true,
    );

    let up = input(
        &manager,
        Some("physical:altgr"),
        InputDeviceKind::Keyboard,
        &["21"],
        false,
    )
    .unwrap();
    assert_eq!(
        up.events,
        vec![event_with_physical_hold(
            "RIGHT ALT",
            vec![0],
            Some(false),
            false,
        )]
    );
}

#[test]
fn missing_physical_id_falls_back_to_device_kind_and_primary_label() {
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![single("A")])]),
        "mode",
    );

    assert!(input(&manager, None, InputDeviceKind::Keyboard, &["A"], true,).is_some());
    assert!(input(&manager, None, InputDeviceKind::Keyboard, &["A"], true,).is_none());
    assert!(input(&manager, None, InputDeviceKind::Mouse, &["A"], true,).is_some());
}

#[test]
fn inert_single_canonical_collision_is_not_a_contributing_slot() {
    let manager = KeyboardManager::new(
        HashMap::from([(
            "mode".to_string(),
            vec![single("A+B"), multi(&["A", "B"], SlotMatch::All)],
        )]),
        "mode",
    );

    let first = input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .unwrap();
    assert_eq!(first.events, vec![event("A+B", vec![1], None, false)]);
    let completed = input(
        &manager,
        Some("physical:b"),
        InputDeviceKind::Keyboard,
        &["B"],
        true,
    )
    .unwrap();
    assert_eq!(
        completed.events,
        vec![event("A+B", vec![1], Some(true), true)]
    );
}

#[test]
fn clear_active_keys_clears_physical_and_canonical_state() {
    let manager = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec![single("A")])]),
        "mode",
    );
    input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    );
    manager.clear_active_keys();

    assert!(manager.pressed_keys().is_empty());
    assert!(manager.register_key_down("mode", "A"));
    assert!(manager.register_key_up("mode", "A"));
    assert!(input(
        &manager,
        Some("physical:a"),
        InputDeviceKind::Keyboard,
        &["A"],
        true,
    )
    .is_some());
}

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use parking_lot::RwLock;

use crate::{
    ipc::InputDeviceKind,
    models::{normalize_key_mappings, KeyMappings, KeySlot, SlotMatch},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchOutcome {
    pub mode: String,
    pub pressed_label: Option<String>,
    pub events: Vec<SlotEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotEvent {
    pub canonical: String,
    pub slot_indices: Vec<usize>,
    pub transition: Option<bool>,
    pub press: bool,
}

// 키음 디스패치용: press 이벤트들의 기여 슬롯 인덱스를 병합
// 한 물리 다운이 여러 슬롯을 트리거해도 사운드는 1회만 재생 (오디오 중첩 방지)
pub fn collect_sound_dispatch(events: &[SlotEvent]) -> Option<(&str, Vec<usize>)> {
    let mut canonical: Option<&str> = None;
    let mut indices: Vec<usize> = Vec::new();
    for event in events.iter().filter(|event| event.press) {
        canonical.get_or_insert(event.canonical.as_str());
        indices.extend_from_slice(&event.slot_indices);
    }
    let canonical = canonical?;
    indices.sort_unstable();
    indices.dedup();
    Some((canonical, indices))
}

#[derive(Debug, Clone)]
struct SlotSpec {
    members: Vec<String>,
    match_mode: SlotMatch,
    canonical: String,
}

impl SlotSpec {
    fn from_slot(slot: &KeySlot) -> Self {
        match slot {
            KeySlot::Single(key) => Self {
                members: (!slot.is_unassigned())
                    .then(|| key.clone())
                    .into_iter()
                    .collect(),
                match_mode: SlotMatch::All,
                canonical: slot.canonical(),
            },
            KeySlot::Multi { keys, match_mode } => Self {
                members: keys.clone(),
                match_mode: *match_mode,
                canonical: slot.canonical(),
            },
        }
    }

    fn is_active(&self, held_labels: &HashMap<String, u32>) -> bool {
        if self.members.is_empty() {
            return false;
        }
        match self.match_mode {
            SlotMatch::All => self
                .members
                .iter()
                .all(|member| held_labels.get(member).is_some_and(|count| *count > 0)),
            SlotMatch::Any => self
                .members
                .iter()
                .any(|member| held_labels.get(member).is_some_and(|count| *count > 0)),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct CompiledMode {
    slots: Vec<SlotSpec>,
    member_to_slots: HashMap<String, Vec<usize>>,
    canonical_to_slots: HashMap<String, Vec<usize>>,
}

impl CompiledMode {
    fn from_slots(slots: Option<&Vec<KeySlot>>) -> Self {
        let slots = slots
            .into_iter()
            .flatten()
            .map(SlotSpec::from_slot)
            .collect::<Vec<_>>();
        let mut member_to_slots: HashMap<String, Vec<usize>> = HashMap::new();
        let mut canonical_to_slots: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, slot) in slots.iter().enumerate() {
            for member in &slot.members {
                member_to_slots
                    .entry(member.clone())
                    .or_default()
                    .push(index);
            }
            canonical_to_slots
                .entry(slot.canonical.clone())
                .or_default()
                .push(index);
        }
        Self {
            slots,
            member_to_slots,
            canonical_to_slots,
        }
    }

    fn resolve(&self, candidates: &[String]) -> Option<String> {
        candidates
            .iter()
            .find(|candidate| self.member_to_slots.contains_key(*candidate))
            .cloned()
    }

    fn canonical_is_active(&self, canonical: &str, held_labels: &HashMap<String, u32>) -> bool {
        self.canonical_to_slots
            .get(canonical)
            .into_iter()
            .flatten()
            .any(|index| self.slots[*index].is_active(held_labels))
    }
}

#[derive(Debug, Clone)]
struct HeldEntry {
    candidates: Vec<String>,
    resolved: Option<String>,
}

#[derive(Debug)]
struct KeyboardState {
    mappings: KeyMappings,
    current_mode: String,
    compiled: CompiledMode,
    held: HashMap<String, HeldEntry>,
    held_labels: HashMap<String, u32>,
    active: HashSet<String>,
}

impl KeyboardState {
    fn rebuild_compiled_state(&mut self) {
        self.compiled = CompiledMode::from_slots(self.mappings.get(&self.current_mode));
        self.held_labels.clear();
        for entry in self.held.values_mut() {
            entry.resolved = self.compiled.resolve(&entry.candidates);
            if let Some(label) = entry.resolved.as_ref() {
                *self.held_labels.entry(label.clone()).or_default() += 1;
            }
        }
        self.active.clear();
        for slot in &self.compiled.slots {
            if slot.is_active(&self.held_labels) {
                self.active
                    .insert(compose_active_key(&self.current_mode, &slot.canonical));
            }
        }
    }

    fn reevaluate_slots(&mut self, resolved: &str, is_down: bool) -> Vec<SlotEvent> {
        let Some(affected_indices) = self.compiled.member_to_slots.get(resolved).cloned() else {
            return Vec::new();
        };

        struct PendingEvent {
            canonical: String,
            slot_indices: Vec<usize>,
            press_on_fresh_down: bool,
        }

        let mut pending = Vec::<PendingEvent>::new();
        let mut event_by_canonical = HashMap::<String, usize>::new();
        for index in affected_indices {
            let slot = &self.compiled.slots[index];
            let event_index = if let Some(index) = event_by_canonical.get(&slot.canonical) {
                *index
            } else {
                let index = pending.len();
                event_by_canonical.insert(slot.canonical.clone(), index);
                pending.push(PendingEvent {
                    canonical: slot.canonical.clone(),
                    slot_indices: Vec::new(),
                    press_on_fresh_down: false,
                });
                index
            };
            let event = &mut pending[event_index];
            event.slot_indices.push(index);
            event.press_on_fresh_down |=
                slot.match_mode == SlotMatch::Any || slot.members.len() == 1;
        }

        pending
            .into_iter()
            .map(|pending| {
                let active_key = compose_active_key(&self.current_mode, &pending.canonical);
                let was_active = self.active.contains(&active_key);
                let is_active = self
                    .compiled
                    .canonical_is_active(&pending.canonical, &self.held_labels);
                let transition = (was_active != is_active).then_some(is_active);
                if is_active {
                    self.active.insert(active_key);
                } else {
                    self.active.remove(&active_key);
                }
                SlotEvent {
                    canonical: pending.canonical,
                    slot_indices: pending.slot_indices,
                    transition,
                    press: is_down && (pending.press_on_fresh_down || transition == Some(true)),
                }
            })
            .collect()
    }
}

#[derive(Clone)]
pub struct KeyboardManager {
    state: Arc<RwLock<KeyboardState>>,
}

impl KeyboardManager {
    pub fn new(mut initial: KeyMappings, default_mode: impl Into<String>) -> Self {
        normalize_key_mappings(&mut initial);
        let current_mode = default_mode.into();
        let compiled = CompiledMode::from_slots(initial.get(&current_mode));
        Self {
            state: Arc::new(RwLock::new(KeyboardState {
                mappings: initial,
                current_mode,
                compiled,
                held: HashMap::new(),
                held_labels: HashMap::new(),
                active: HashSet::new(),
            })),
        }
    }

    pub fn set_mode(&self, mode: impl Into<String>) -> bool {
        let mode = mode.into();
        let mut state = self.state.write();
        if !state.mappings.contains_key(&mode) {
            return false;
        }
        state.current_mode = mode;
        state.rebuild_compiled_state();
        true
    }

    pub fn update_mappings_and_set_mode(
        &self,
        mut mappings: KeyMappings,
        mode: impl Into<String>,
    ) -> bool {
        normalize_key_mappings(&mut mappings);
        let mode = mode.into();
        let mode_exists = mappings.contains_key(&mode);
        let mut state = self.state.write();
        state.mappings = mappings;
        if mode_exists {
            state.current_mode = mode;
        }
        state.rebuild_compiled_state();
        mode_exists
    }

    pub fn update_mappings(&self, mut mappings: KeyMappings) {
        normalize_key_mappings(&mut mappings);
        let mut state = self.state.write();
        state.mappings = mappings;
        state.rebuild_compiled_state();
    }

    pub fn current_mode(&self) -> String {
        self.state.read().current_mode.clone()
    }

    pub fn match_and_register<'a>(
        &self,
        physical_id: Option<&str>,
        device: InputDeviceKind,
        candidates: impl IntoIterator<Item = &'a str>,
        is_down: bool,
    ) -> Option<MatchOutcome> {
        let candidates = candidates
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let physical_key =
            physical_key(physical_id, device, candidates.first().map(String::as_str))?;
        let mut state = self.state.write();
        let mode = state.current_mode.clone();

        if is_down {
            if state.held.contains_key(&physical_key) {
                return None;
            }
            let resolved = state.compiled.resolve(&candidates);
            state.held.insert(
                physical_key,
                HeldEntry {
                    candidates,
                    resolved: resolved.clone(),
                },
            );
            if let Some(label) = resolved.as_ref() {
                *state.held_labels.entry(label.clone()).or_default() += 1;
            }
            let events = resolved
                .as_deref()
                .map(|label| state.reevaluate_slots(label, true))
                .unwrap_or_default();
            return Some(MatchOutcome {
                mode,
                pressed_label: resolved,
                events,
            });
        }

        let held = state.held.remove(&physical_key)?;
        if let Some(label) = held.resolved.as_ref() {
            let remove_label = if let Some(count) = state.held_labels.get_mut(label) {
                *count = count.saturating_sub(1);
                *count == 0
            } else {
                false
            };
            if remove_label {
                state.held_labels.remove(label);
            }
        }
        let events = held
            .resolved
            .as_deref()
            .map(|label| state.reevaluate_slots(label, false))
            .unwrap_or_default();
        Some(MatchOutcome {
            mode,
            pressed_label: None,
            events,
        })
    }

    #[cfg(test)]
    pub fn register_key_down(&self, mode: &str, key: &str) -> bool {
        if self.current_mode() != mode {
            return false;
        }
        let physical_id = format!("test:key:{key}");
        self.match_and_register(Some(&physical_id), InputDeviceKind::Keyboard, [key], true)
            .is_some_and(|outcome| {
                outcome.pressed_label.is_some()
                    && outcome
                        .events
                        .iter()
                        .any(|event| event.transition == Some(true))
            })
    }

    #[cfg(test)]
    pub fn register_key_up(&self, mode: &str, key: &str) -> bool {
        if self.current_mode() != mode {
            return false;
        }
        let physical_id = format!("test:key:{key}");
        self.match_and_register(Some(&physical_id), InputDeviceKind::Keyboard, [key], false)
            .is_some_and(|outcome| {
                outcome
                    .events
                    .iter()
                    .any(|event| event.transition == Some(false))
            })
    }

    pub fn clear_active_keys(&self) {
        let mut state = self.state.write();
        state.held.clear();
        state.held_labels.clear();
        state.active.clear();
    }

    #[cfg(test)]
    pub fn pressed_keys(&self) -> Vec<String> {
        self.current_mode_and_pressed_keys().1
    }

    pub fn current_mode_and_pressed_keys(&self) -> (String, Vec<String>) {
        let state = self.state.read();
        let prefix = format!("{}::", state.current_mode);
        let mut keys = state
            .active
            .iter()
            .filter_map(|entry| entry.strip_prefix(&prefix).map(str::to_string))
            .collect::<Vec<_>>();
        keys.sort();
        (state.current_mode.clone(), keys)
    }
}

fn physical_key(
    physical_id: Option<&str>,
    device: InputDeviceKind,
    primary_label: Option<&str>,
) -> Option<String> {
    if let Some(physical_id) = physical_id {
        return Some(physical_id.to_string());
    }
    let primary_label = primary_label?;
    let device = match device {
        InputDeviceKind::Keyboard => "keyboard",
        InputDeviceKind::Mouse => "mouse",
        InputDeviceKind::Gamepad => "gamepad",
        InputDeviceKind::Unknown => "unknown",
    };
    Some(format!("fallback:{device}:{primary_label}"))
}

fn compose_active_key(mode: &str, canonical: &str) -> String {
    format!("{mode}::{canonical}")
}

#[cfg(test)]
mod tests {
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
            },
            SlotEvent {
                canonical: "A|B".to_string(),
                slot_indices: vec![0, 1],
                transition: None,
                press: true,
            },
            SlotEvent {
                canonical: "C".to_string(),
                slot_indices: vec![2],
                transition: Some(false),
                press: false,
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
            vec![event("RIGHT ALT", vec![0], Some(false), false)]
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
}

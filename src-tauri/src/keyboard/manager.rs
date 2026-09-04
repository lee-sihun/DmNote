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
    pub can_use_physical_hold_duration: bool,
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
    activation_sources: HashMap<String, String>,
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
        // 재구성 시 canonical DOWN을 만든 물리 입력을 확정할 수 없으므로 source 폐기
        self.activation_sources.clear();
        for slot in &self.compiled.slots {
            if slot.is_active(&self.held_labels) {
                self.active
                    .insert(compose_active_key(&self.current_mode, &slot.canonical));
            }
        }
    }

    fn reevaluate_slots(
        &mut self,
        resolved: &str,
        physical_key: &str,
        is_down: bool,
    ) -> Vec<SlotEvent> {
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
                let can_use_physical_hold_duration = match transition {
                    Some(true) => {
                        self.activation_sources
                            .insert(active_key.clone(), physical_key.to_string());
                        false
                    }
                    Some(false) => self
                        .activation_sources
                        .remove(&active_key)
                        .is_some_and(|source| source == physical_key),
                    None => false,
                };
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
                    can_use_physical_hold_duration,
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
                activation_sources: HashMap::new(),
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
                physical_key.clone(),
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
                .map(|label| state.reevaluate_slots(label, &physical_key, true))
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
            .map(|label| state.reevaluate_slots(label, &physical_key, false))
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
        state.activation_sources.clear();
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
mod tests;

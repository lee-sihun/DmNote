use std::collections::HashMap;

use crate::models::{
    CanonicalInputState, CanonicalInputTimelineAction, CanonicalInputTimelineBaseline,
    CanonicalInputTimelineBatch, CANONICAL_INPUT_TIMELINE_VERSION,
};

#[derive(Debug, Clone)]
struct ActivePress {
    press_id: String,
}

fn baseline_press_id(stream_id: &str, key: &str) -> String {
    format!("{stream_id}/0/{key}")
}

#[derive(Debug, Default)]
pub(crate) struct CanonicalInputTimelineBuilder {
    stream_id: Option<String>,
    batch_revision: u64,
    baseline: Option<CanonicalInputTimelineBaseline>,
    actions: Vec<CanonicalInputTimelineAction>,
    active: HashMap<(String, String), ActivePress>,
}

impl CanonicalInputTimelineBuilder {
    pub(crate) fn begin_stream(
        &mut self,
        stream_id: &str,
        baseline: CanonicalInputTimelineBaseline,
    ) {
        if self.stream_id.as_deref() == Some(stream_id) {
            return;
        }
        self.stream_id = Some(stream_id.to_string());
        self.batch_revision = 0;
        self.actions.clear();
        self.active.clear();
        for key in &baseline.active_keys {
            self.active.insert(
                (baseline.mode.clone(), key.clone()),
                ActivePress {
                    press_id: baseline_press_id(stream_id, key),
                },
            );
        }
        self.baseline = Some(baseline);
    }

    pub(crate) fn push_state(
        &mut self,
        source_revision: u64,
        event_time_us: u64,
        mode: &str,
        key: &str,
        is_down: bool,
    ) -> Result<(), String> {
        let stream_id = self
            .stream_id
            .as_deref()
            .ok_or_else(|| String::from("canonical timeline stream is not initialized"))?;
        let active_key = (mode.to_string(), key.to_string());
        let press_id = if is_down {
            if self.active.contains_key(&active_key) {
                return Err(format!(
                    "duplicate canonical DOWN in timeline: mode={mode}, key={key}"
                ));
            }
            let press_id = format!("{stream_id}/{source_revision}/{key}");
            self.active.insert(
                active_key,
                ActivePress {
                    press_id: press_id.clone(),
                },
            );
            press_id
        } else {
            self.active
                .remove(&active_key)
                .ok_or_else(|| {
                    format!("unmatched canonical UP in timeline: mode={mode}, key={key}")
                })?
                .press_id
        };

        self.actions.push(CanonicalInputTimelineAction::State {
            press_id,
            mode: mode.to_string(),
            key: key.to_string(),
            state: if is_down {
                CanonicalInputState::Down
            } else {
                CanonicalInputState::Up
            },
            event_time_us: event_time_us.to_string(),
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn push_counter(
        &mut self,
        event_time_us: u64,
        mode: &str,
        key: &str,
        count: u32,
        counter_session_id: &str,
        counter_revision: u64,
    ) -> Result<(), String> {
        if self.stream_id.is_none() {
            return Err(String::from("canonical timeline stream is not initialized"));
        }
        self.actions.push(CanonicalInputTimelineAction::Counter {
            mode: mode.to_string(),
            key: key.to_string(),
            count,
            counter_session_id: counter_session_id.to_string(),
            counter_revision: counter_revision.to_string(),
            event_time_us: event_time_us.to_string(),
        });
        Ok(())
    }

    pub(crate) fn watermark(
        &mut self,
        source_revision: u64,
        safe_through_us: u64,
    ) -> Result<CanonicalInputTimelineBatch, String> {
        let stream_id = self
            .stream_id
            .clone()
            .ok_or_else(|| String::from("canonical timeline stream is not initialized"))?;
        self.batch_revision = self.batch_revision.wrapping_add(1);
        if self.batch_revision == 0 {
            return Err(String::from("canonical timeline batch revision overflow"));
        }
        Ok(CanonicalInputTimelineBatch {
            version: CANONICAL_INPUT_TIMELINE_VERSION,
            stream_id,
            revision: self.batch_revision.to_string(),
            source_revision: source_revision.to_string(),
            safe_through_us: safe_through_us.to_string(),
            baseline: self.baseline.take(),
            actions: std::mem::take(&mut self.actions),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::CanonicalInputTimelineBuilder;
    use crate::models::{
        CanonicalInputState, CanonicalInputTimelineAction, CanonicalInputTimelineBaseline,
    };

    fn baseline() -> CanonicalInputTimelineBaseline {
        CanonicalInputTimelineBaseline {
            mode: "4key".to_string(),
            active_keys: Vec::new(),
            counters: Default::default(),
            counter_session_id: "counter-session".to_string(),
            counter_revision: "0".to_string(),
        }
    }

    #[test]
    fn press_id_connects_down_and_up_across_watermarks() {
        let mut builder = CanonicalInputTimelineBuilder::default();
        builder.begin_stream("stream-a", baseline());
        builder.push_state(1, 10, "4key", "A", true).unwrap();

        let first = builder.watermark(2, 20).unwrap();
        assert!(first.baseline.is_some());
        let down_id = match &first.actions[0] {
            CanonicalInputTimelineAction::State {
                press_id, state, ..
            } => {
                assert_eq!(*state, CanonicalInputState::Down);
                press_id.clone()
            }
            _ => panic!("expected state action"),
        };

        builder.push_state(3, 30, "4key", "A", false).unwrap();
        let second = builder.watermark(4, 40).unwrap();
        assert!(second.baseline.is_none());
        let up_id = match &second.actions[0] {
            CanonicalInputTimelineAction::State {
                press_id, state, ..
            } => {
                assert_eq!(*state, CanonicalInputState::Up);
                press_id.clone()
            }
            _ => panic!("expected state action"),
        };

        assert_eq!(down_id, up_id);
    }

    #[test]
    fn new_stream_discards_pending_actions_and_active_presses() {
        let mut builder = CanonicalInputTimelineBuilder::default();
        builder.begin_stream("stream-a", baseline());
        builder.push_state(1, 10, "4key", "A", true).unwrap();

        builder.begin_stream("stream-b", baseline());
        let batch = builder.watermark(1, 0).unwrap();
        assert!(batch.actions.is_empty());
        assert!(builder.push_state(2, 5, "4key", "A", false).is_err());
    }

    #[test]
    fn baseline_key_can_be_released_without_synthesizing_a_down_action() {
        let mut builder = CanonicalInputTimelineBuilder::default();
        let mut initial = baseline();
        initial.active_keys.push("A".to_string());
        builder.begin_stream("stream-a", initial);

        builder.push_state(2, 20, "4key", "A", false).unwrap();
        let batch = builder.watermark(3, 30).unwrap();

        assert!(matches!(
            &batch.actions[0],
            CanonicalInputTimelineAction::State {
                press_id,
                state: CanonicalInputState::Up,
                ..
            } if press_id == "stream-a/0/A"
        ));
    }

    #[test]
    fn any_mapping_counter_can_exist_without_state_transition() {
        let mut builder = CanonicalInputTimelineBuilder::default();
        builder.begin_stream("stream-a", baseline());
        builder
            .push_counter(20, "4key", "A|B", 7, "counter-session", 11)
            .unwrap();

        let batch = builder.watermark(3, 30).unwrap();
        assert!(matches!(
            &batch.actions[0],
            CanonicalInputTimelineAction::Counter { count: 7, .. }
        ));
    }
}

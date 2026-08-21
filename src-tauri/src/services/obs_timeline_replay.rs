use std::collections::{HashMap, HashSet, VecDeque};

use serde_json::{json, Map, Value};

const MAX_REPLAY_BATCHES: usize = 512;
const MAX_REPLAY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
struct ReplayEntry {
    revision: u64,
    bytes: usize,
    batch: Value,
}

#[derive(Debug, Clone)]
struct ActivePress {
    press_id: String,
    mode: String,
    key: String,
    down_time_us: Option<String>,
}

#[derive(Debug, Default)]
pub(super) struct ObsTimelineReplayStore {
    stream_id: Option<String>,
    revision: u64,
    source_revision: String,
    safe_through_us: String,
    mode: String,
    active_presses: HashMap<String, ActivePress>,
    active_keys: HashMap<String, HashSet<String>>,
    counters: Map<String, Value>,
    counter_session_id: String,
    counter_revision: String,
    entries: VecDeque<ReplayEntry>,
    total_bytes: usize,
    valid: bool,
}

pub(super) enum TimelineReplayResponse {
    Replay(Value),
    Rebase(Value),
    Unavailable,
}

fn parse_decimal(value: Option<&Value>) -> Option<u64> {
    value?.as_str()?.parse().ok()
}

fn baseline_press_id(stream_id: &str, key: &str) -> String {
    format!("{stream_id}/0/{key}")
}

impl ObsTimelineReplayStore {
    pub(super) fn ingest(&mut self, batch: &Value) {
        let Some(stream_id) = batch.get("streamId").and_then(Value::as_str) else {
            self.valid = false;
            return;
        };
        let Some(revision) = parse_decimal(batch.get("revision")) else {
            self.valid = false;
            return;
        };
        let Some(source_revision) = batch.get("sourceRevision").and_then(Value::as_str) else {
            self.valid = false;
            return;
        };
        let Some(safe_through_us) = batch.get("safeThroughUs").and_then(Value::as_str) else {
            self.valid = false;
            return;
        };
        let Some(actions) = batch.get("actions").and_then(Value::as_array) else {
            self.valid = false;
            return;
        };

        if self.stream_id.as_deref() != Some(stream_id) {
            let Some(baseline) = batch.get("baseline").and_then(Value::as_object) else {
                self.clear_invalid();
                return;
            };
            if revision != 1 || !self.adopt_baseline(stream_id, baseline) {
                self.clear_invalid();
                return;
            }
        } else if !self.valid || revision != self.revision.saturating_add(1) {
            self.clear_invalid();
            return;
        }

        if !self.apply_actions(actions) {
            self.clear_invalid();
            return;
        }

        self.revision = revision;
        self.source_revision = source_revision.to_string();
        self.safe_through_us = safe_through_us.to_string();
        self.valid = true;

        let bytes = serde_json::to_vec(batch).map_or(0, |encoded| encoded.len());
        self.entries.push_back(ReplayEntry {
            revision,
            bytes,
            batch: batch.clone(),
        });
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        while self.entries.len() > MAX_REPLAY_BATCHES || self.total_bytes > MAX_REPLAY_BYTES {
            if let Some(removed) = self.entries.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
            } else {
                break;
            }
        }
    }

    pub(super) fn replay_after(
        &self,
        requested_stream_id: Option<&str>,
        after_revision: u64,
    ) -> TimelineReplayResponse {
        if !self.valid {
            return TimelineReplayResponse::Unavailable;
        }
        let Some(stream_id) = self.stream_id.as_deref() else {
            return TimelineReplayResponse::Unavailable;
        };

        if requested_stream_id != Some(stream_id) || after_revision > self.revision {
            return self.rebase_response();
        }
        if after_revision == self.revision {
            return TimelineReplayResponse::Replay(json!({
                "streamId": stream_id,
                "afterRevision": after_revision.to_string(),
                "latestRevision": self.revision.to_string(),
                "batches": [],
            }));
        }

        let expected = after_revision.saturating_add(1);
        if self
            .entries
            .front()
            .is_none_or(|entry| entry.revision > expected)
        {
            return self.rebase_response();
        }
        let batches: Vec<Value> = self
            .entries
            .iter()
            .filter(|entry| entry.revision > after_revision)
            .map(|entry| entry.batch.clone())
            .collect();
        if batches
            .first()
            .and_then(|batch| parse_decimal(batch.get("revision")))
            != Some(expected)
        {
            return self.rebase_response();
        }
        TimelineReplayResponse::Replay(json!({
            "streamId": stream_id,
            "afterRevision": after_revision.to_string(),
            "latestRevision": self.revision.to_string(),
            "batches": batches,
        }))
    }

    fn adopt_baseline(&mut self, stream_id: &str, baseline: &Map<String, Value>) -> bool {
        let Some(mode) = baseline.get("mode").and_then(Value::as_str) else {
            return false;
        };
        let Some(active_keys) = baseline.get("activeKeys").and_then(Value::as_array) else {
            return false;
        };
        let Some(counters) = baseline.get("counters").and_then(Value::as_object) else {
            return false;
        };
        let Some(counter_session_id) = baseline.get("counterSessionId").and_then(Value::as_str)
        else {
            return false;
        };
        let Some(counter_revision) = baseline.get("counterRevision").and_then(Value::as_str) else {
            return false;
        };

        self.stream_id = Some(stream_id.to_string());
        self.revision = 0;
        self.mode = mode.to_string();
        self.active_presses.clear();
        self.active_keys.clear();
        let mode_keys = self.active_keys.entry(mode.to_string()).or_default();
        for key in active_keys {
            let Some(key) = key.as_str() else {
                return false;
            };
            if !mode_keys.insert(key.to_string()) {
                return false;
            }
            let press_id = baseline_press_id(stream_id, key);
            self.active_presses.insert(
                press_id.clone(),
                ActivePress {
                    press_id,
                    mode: mode.to_string(),
                    key: key.to_string(),
                    down_time_us: None,
                },
            );
        }
        self.counters = counters.clone();
        self.counter_session_id = counter_session_id.to_string();
        self.counter_revision = counter_revision.to_string();
        self.entries.clear();
        self.total_bytes = 0;
        true
    }

    fn apply_actions(&mut self, actions: &[Value]) -> bool {
        for action in actions {
            let Some(kind) = action.get("kind").and_then(Value::as_str) else {
                return false;
            };
            let Some(mode) = action.get("mode").and_then(Value::as_str) else {
                return false;
            };
            let Some(key) = action.get("key").and_then(Value::as_str) else {
                return false;
            };
            match kind {
                "state" => {
                    let Some(press_id) = action.get("pressId").and_then(Value::as_str) else {
                        return false;
                    };
                    let Some(state) = action.get("state").and_then(Value::as_str) else {
                        return false;
                    };
                    if state == "DOWN" {
                        let Some(down_time_us) = action.get("eventTimeUs").and_then(Value::as_str)
                        else {
                            return false;
                        };
                        if self.active_presses.contains_key(press_id)
                            || self
                                .active_keys
                                .get(mode)
                                .is_some_and(|keys| keys.contains(key))
                        {
                            return false;
                        }
                        self.active_presses.insert(
                            press_id.to_string(),
                            ActivePress {
                                press_id: press_id.to_string(),
                                mode: mode.to_string(),
                                key: key.to_string(),
                                down_time_us: Some(down_time_us.to_string()),
                            },
                        );
                        self.active_keys
                            .entry(mode.to_string())
                            .or_default()
                            .insert(key.to_string());
                    } else if state == "UP" {
                        let Some(active) = self.active_presses.remove(press_id) else {
                            return false;
                        };
                        if active.mode != mode || active.key != key {
                            return false;
                        }
                        self.active_keys
                            .entry(mode.to_string())
                            .or_default()
                            .remove(key);
                    } else {
                        return false;
                    }
                }
                "counter" => {
                    let Some(count) = action.get("count").and_then(Value::as_u64) else {
                        return false;
                    };
                    let Some(session_id) = action.get("counterSessionId").and_then(Value::as_str)
                    else {
                        return false;
                    };
                    let Some(revision) = action.get("counterRevision").and_then(Value::as_str)
                    else {
                        return false;
                    };
                    let mode_counters = self
                        .counters
                        .entry(mode.to_string())
                        .or_insert_with(|| Value::Object(Map::new()));
                    let Some(mode_counters) = mode_counters.as_object_mut() else {
                        return false;
                    };
                    mode_counters.insert(key.to_string(), Value::from(count));
                    self.counter_session_id = session_id.to_string();
                    self.counter_revision = revision.to_string();
                }
                _ => return false,
            }
        }
        true
    }

    fn rebase_response(&self) -> TimelineReplayResponse {
        let Some(stream_id) = self.stream_id.as_deref() else {
            return TimelineReplayResponse::Unavailable;
        };
        let active_keys = self
            .active_keys
            .get(&self.mode)
            .map_or_else(Vec::new, |keys| keys.iter().cloned().collect());
        let active_presses: Vec<Value> = self
            .active_presses
            .values()
            .filter_map(|press| {
                let down_time_us = press.down_time_us.as_deref()?;
                Some(json!({
                    "pressId": press.press_id,
                    "mode": press.mode,
                    "key": press.key,
                    "downTimeUs": down_time_us,
                }))
            })
            .collect();
        TimelineReplayResponse::Rebase(json!({
            "version": 1,
            "streamId": stream_id,
            "revision": self.revision.to_string(),
            "sourceRevision": self.source_revision,
            "safeThroughUs": self.safe_through_us,
            "baseline": {
                "mode": self.mode,
                "activeKeys": active_keys,
                "counters": self.counters,
                "counterSessionId": self.counter_session_id,
                "counterRevision": self.counter_revision,
            },
            "activePresses": active_presses,
        }))
    }

    fn clear_invalid(&mut self) {
        self.stream_id = None;
        self.entries.clear();
        self.total_bytes = 0;
        self.active_presses.clear();
        self.active_keys.clear();
        self.valid = false;
    }
}

#[cfg(test)]
mod tests {
    use super::{ObsTimelineReplayStore, TimelineReplayResponse, MAX_REPLAY_BATCHES};
    use serde_json::{json, Value};

    fn batch(revision: usize, actions: Value) -> Value {
        json!({
            "version": 1,
            "streamId": "stream-a",
            "revision": revision.to_string(),
            "sourceRevision": (revision * 2).to_string(),
            "safeThroughUs": (revision * 16_000).to_string(),
            "baseline": (revision == 1).then(|| json!({
                "mode": "4key",
                "activeKeys": [],
                "counters": {"4key": {"A": 0}},
                "counterSessionId": "counter-a",
                "counterRevision": "0"
            })),
            "actions": actions,
        })
    }

    #[test]
    fn replays_contiguous_batches_inside_bounds() {
        let mut store = ObsTimelineReplayStore::default();
        store.ingest(&batch(1, json!([])));
        store.ingest(&batch(2, json!([])));

        let TimelineReplayResponse::Replay(payload) = store.replay_after(Some("stream-a"), 1)
        else {
            panic!("expected replay");
        };
        assert_eq!(payload["batches"].as_array().map(Vec::len), Some(1));
        assert_eq!(payload["latestRevision"], "2");
    }

    #[test]
    fn falls_back_to_checkpoint_after_ring_eviction() {
        let mut store = ObsTimelineReplayStore::default();
        for revision in 1..=MAX_REPLAY_BATCHES + 2 {
            store.ingest(&batch(revision, json!([])));
        }

        assert!(matches!(
            store.replay_after(Some("stream-a"), 0),
            TimelineReplayResponse::Rebase(_)
        ));
    }

    #[test]
    fn checkpoint_keeps_active_press_identity_and_counter_state() {
        let mut store = ObsTimelineReplayStore::default();
        store.ingest(&batch(
            1,
            json!([
                {
                    "kind": "state", "pressId": "press-a", "mode": "4key",
                    "key": "A", "state": "DOWN", "eventTimeUs": "1000"
                },
                {
                    "kind": "counter", "mode": "4key", "key": "A", "count": 3,
                    "counterSessionId": "counter-a", "counterRevision": "1",
                    "eventTimeUs": "1000"
                }
            ]),
        ));

        let TimelineReplayResponse::Rebase(payload) = store.replay_after(None, 0) else {
            panic!("expected rebase");
        };
        assert_eq!(payload["activePresses"][0]["pressId"], "press-a");
        assert_eq!(payload["baseline"]["activeKeys"], json!(["A"]));
        assert_eq!(payload["baseline"]["counters"]["4key"]["A"], 3);
    }

    #[test]
    fn checkpoint_keeps_unknown_baseline_key_without_synthesizing_a_press() {
        let mut store = ObsTimelineReplayStore::default();
        let mut first = batch(1, json!([]));
        first["baseline"]["activeKeys"] = json!(["A"]);
        store.ingest(&first);

        let TimelineReplayResponse::Rebase(payload) = store.replay_after(None, 0) else {
            panic!("expected rebase");
        };
        assert_eq!(payload["baseline"]["activeKeys"], json!(["A"]));
        assert_eq!(payload["activePresses"], json!([]));

        store.ingest(&batch(
            2,
            json!([{
                "kind": "state", "pressId": "stream-a/0/A", "mode": "4key",
                "key": "A", "state": "UP", "eventTimeUs": "20000"
            }]),
        ));
        assert!(matches!(
            store.replay_after(Some("stream-a"), 2),
            TimelineReplayResponse::Replay(_)
        ));
    }
}

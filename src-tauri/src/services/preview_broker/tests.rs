use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use tauri::ipc::InvokeResponseBody;

use super::*;

fn session_id() -> String {
    Uuid::new_v4().to_string()
}

fn request(session_id: &str, seq: u64) -> PreviewPublishRequest {
    request_for_domain(session_id, seq, PreviewDomain::KeyPosition)
}

fn request_for_domain(session_id: &str, seq: u64, domain: PreviewDomain) -> PreviewPublishRequest {
    PreviewPublishRequest {
        schema_version: PREVIEW_SCHEMA_VERSION,
        session_id: session_id.to_string(),
        seq,
        kind: PreviewKind::Patch,
        domain,
        mode: "default".to_string(),
        targets: vec![0],
        patch: Map::from_iter([("width".to_string(), Value::from(80))]),
    }
}

fn envelope(label: &str, request: PreviewPublishRequest) -> PreviewEnvelope {
    PreviewEnvelope {
        schema_version: request.schema_version,
        session_id: request.session_id,
        seq: request.seq,
        kind: request.kind,
        source_label: label.to_string(),
        domain: request.domain,
        mode: request.mode,
        targets: request.targets,
        patch: request.patch,
    }
}

fn channel(counter: Arc<AtomicUsize>) -> Channel<PreviewEnvelope> {
    Channel::new(move |_| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    })
}

fn recording_channel(messages: Arc<Mutex<Vec<PreviewEnvelope>>>) -> Channel<PreviewEnvelope> {
    Channel::new(move |body| {
        let InvokeResponseBody::Json(json) = body else {
            panic!("preview envelope must use a JSON channel body");
        };
        messages
            .lock()
            .push(serde_json::from_str(&json).expect("preview envelope is valid JSON"));
        Ok(())
    })
}

fn subscribe(broker: &PreviewBroker, label: &str) -> Arc<AtomicUsize> {
    let counter = Arc::new(AtomicUsize::new(0));
    broker
        .subscribe(label, channel(counter.clone()))
        .expect("subscribe succeeds");
    counter
}

#[test]
fn rejects_publish_from_non_owner() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    subscribe(&broker, "intruder");
    let session_id = session_id();

    broker
        .publish("owner", request(&session_id, 1))
        .expect("owner claims session");

    assert!(broker
        .publish("intruder", request(&session_id, 2))
        .unwrap_err()
        .contains("another window"));
}

#[test]
fn publish_injects_source_label_and_defaults_to_patch() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let messages = Arc::new(Mutex::new(Vec::new()));
    broker
        .subscribe("observer", recording_channel(messages.clone()))
        .expect("observer subscribes");
    let session_id = session_id();
    let request: PreviewPublishRequest = serde_json::from_value(serde_json::json!({
        "schemaVersion": PREVIEW_SCHEMA_VERSION,
        "sessionId": session_id,
        "seq": 1,
        "domain": "keyPosition",
        "mode": "default",
        "targets": [0],
        "patch": { "width": 80 }
    }))
    .expect("frontend request shape is accepted");

    broker.publish("owner", request).expect("publish succeeds");

    let messages = messages.lock();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].source_label, "owner");
    assert_eq!(messages[0].kind, PreviewKind::Patch);
}

#[test]
fn element_rotation_preview_round_trips_for_native_position_domains() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let messages = Arc::new(Mutex::new(Vec::new()));
    broker
        .subscribe("observer", recording_channel(messages.clone()))
        .unwrap();
    for domain in [
        PreviewDomain::KeyPosition,
        PreviewDomain::StatPosition,
        PreviewDomain::GraphPosition,
        PreviewDomain::KnobPosition,
        PreviewDomain::SpritePosition,
    ] {
        let mut request = request_for_domain(&session_id(), 1, domain);
        request.patch = Map::from_iter([("rotation".to_string(), Value::from(45.5))]);
        broker.publish("owner", request).unwrap();
        let messages = messages.lock();
        let message = messages.last().unwrap();
        assert_eq!(message.domain, domain);
        assert_eq!(message.patch["rotation"], 45.5);
    }
    assert_eq!(messages.lock().len(), 5);
}

#[test]
fn image_transform_preview_fields_round_trip_through_channel() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let messages = Arc::new(Mutex::new(Vec::new()));
    broker
        .subscribe("observer", recording_channel(messages.clone()))
        .expect("observer subscribes");
    let session_id = session_id();
    let expected_patch = serde_json::json!({
        "idleImageTransform": {
            "offsetX": 12.5,
            "offsetY": -4.0,
            "rotation": 25.0,
            "scale": 1.35
        },
        "activeImageTransform": {
            "offsetX": -8.0,
            "offsetY": 6.25,
            "rotation": -15.0,
            "scale": 0.75
        }
    });
    let request: PreviewPublishRequest = serde_json::from_value(serde_json::json!({
        "schemaVersion": PREVIEW_SCHEMA_VERSION,
        "sessionId": session_id,
        "seq": 1,
        "domain": "keyPosition",
        "mode": "default",
        "targets": [0],
        "patch": expected_patch
    }))
    .expect("nested image transform request is valid JSON");

    broker
        .publish("owner", request)
        .expect("image transform preview publishes");

    let messages = messages.lock();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0].patch,
        expected_patch.as_object().unwrap().clone()
    );
}

#[test]
fn font_gradient_preview_fields_are_allowed_without_widening_the_allowlist() {
    let session_id = session_id();
    let mut allowed = request(&session_id, 1);
    allowed.patch = Map::from_iter([
        (
            "fontGradient".to_string(),
            serde_json::json!({
                "angle": 45,
                "stops": [
                    { "color": "#112233", "pos": 0 },
                    { "color": "#445566", "pos": 1 }
                ]
            }),
        ),
        ("activeFontGradient".to_string(), Value::Null),
    ]);
    validate_publish_request(&allowed).expect("font gradient preview fields are allowed");

    let mut rejected = request(&session_id, 2);
    rejected.patch = Map::from_iter([("fontPaint".to_string(), Value::Null)]);
    assert_eq!(
        validate_publish_request(&rejected).unwrap_err(),
        "preview patch field 'fontPaint' is not allowed"
    );
}

#[test]
fn note_glow_sync_paint_preview_field_is_allowed() {
    let session_id = session_id();
    let mut allowed = request(&session_id, 1);
    allowed.patch = Map::from_iter([("noteGlowSyncPaint".to_string(), Value::Bool(true))]);

    validate_publish_request(&allowed).expect("note glow paint sync preview field is allowed");
}

#[test]
fn malformed_gradient_preview_values_are_rejected_before_broadcast() {
    let session_id = session_id();
    let cases: [(&str, Value); 6] = [
        // 객체 아님
        ("fontGradient", serde_json::json!("broken")),
        // stops 누락
        ("activeFontGradient", serde_json::json!({ "angle": 45 })),
        // angle이 숫자가 아님
        (
            "backgroundGradient",
            serde_json::json!({
                "angle": "45",
                "stops": [
                    { "color": "#112233", "pos": 0 },
                    { "color": "#445566", "pos": 1 }
                ]
            }),
        ),
        // stop 1개
        (
            "borderGradient",
            serde_json::json!({
                "angle": 45,
                "stops": [{ "color": "#112233", "pos": 0 }]
            }),
        ),
        // 빈 stop 색
        (
            "fontGradient",
            serde_json::json!({
                "angle": 45,
                "stops": [
                    { "color": " ", "pos": 0 },
                    { "color": "#445566", "pos": 1 }
                ]
            }),
        ),
        // pos 범위 밖
        (
            "activeBorderGradient",
            serde_json::json!({
                "angle": 45,
                "stops": [
                    { "color": "#112233", "pos": 2 },
                    { "color": "#445566", "pos": 1 }
                ]
            }),
        ),
    ];
    for (seq, (field, value)) in cases.into_iter().enumerate() {
        let mut rejected = request(&session_id, seq as u64 + 1);
        rejected.patch = Map::from_iter([(field.to_string(), value)]);
        let error = validate_publish_request(&rejected)
            .expect_err("malformed gradient preview must be rejected");
        assert!(
            error.contains(&format!("preview field '{field}'")),
            "unexpected error for {field}: {error}"
        );
    }
}

#[test]
fn forwards_every_position_preview_domain() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let messages = Arc::new(Mutex::new(Vec::new()));
    broker
        .subscribe("observer", recording_channel(messages.clone()))
        .expect("observer subscribes");
    let session_id = session_id();
    let domains = [
        PreviewDomain::KeyPosition,
        PreviewDomain::StatPosition,
        PreviewDomain::GraphPosition,
        PreviewDomain::KnobPosition,
        PreviewDomain::SpritePosition,
    ];

    for (index, domain) in domains.iter().copied().enumerate() {
        broker
            .publish(
                "owner",
                request_for_domain(&session_id, index as u64 + 1, domain),
            )
            .expect("supported domain publishes");
    }

    let forwarded = messages
        .lock()
        .iter()
        .map(|message| message.domain)
        .collect::<Vec<_>>();
    assert_eq!(forwarded, domains);
}

#[test]
fn sprite_position_domain_validates_and_round_trips_through_subscribers() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let messages = Arc::new(Mutex::new(Vec::new()));
    broker
        .subscribe("observer", recording_channel(messages.clone()))
        .expect("observer subscribes");
    let session_id = session_id();
    let patch = serde_json::json!({
        "dx": 24,
        "dy": -8,
        "width": 320,
        "height": 180,
        "rotation": -45.5,
        "pivot": { "x": 0.5, "y": 0.75 },
        "idleTransform": { "x": 0, "y": 0, "rotation": 0, "scale": 1 },
        "poses": [{ "poseId": "pose-id", "triggers": [] }],
        "pressDurationMs": 300,
        "transitionMs": 120,
        "transitionEasing": "ease-out",
        "baseImage": "/images/base.png",
        "referenceNaturalSize": {
            "source": "/images/base.png",
            "width": 640,
            "height": 360
        }
    });
    let request: PreviewPublishRequest = serde_json::from_value(serde_json::json!({
        "schemaVersion": PREVIEW_SCHEMA_VERSION,
        "sessionId": session_id,
        "seq": 1,
        "domain": "spritePosition",
        "mode": "4key",
        "targets": [0],
        "patch": patch
    }))
    .expect("spritePosition domain is accepted");

    broker
        .publish("owner", request)
        .expect("sprite preview publishes");

    let messages = messages.lock();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].domain, PreviewDomain::SpritePosition);
    assert_eq!(messages[0].mode, "4key");
    assert_eq!(Value::Object(messages[0].patch.clone()), patch);
}

#[test]
fn sprite_position_preview_allowlist_matches_supported_contract() {
    assert_eq!(
        SPRITE_POSITION_PATCH_FIELDS,
        [
            "dx",
            "dy",
            "width",
            "height",
            "rotation",
            "pivot",
            "idleTransform",
            "poses",
            "pressDurationMs",
            "transitionMs",
            "transitionEasing",
            "baseImage",
            "referenceNaturalSize",
        ]
    );
}

#[test]
fn preview_patch_allowlist_rejects_unknown_and_cross_domain_fields() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let session_id = session_id();
    let mut unknown_sprite = request_for_domain(&session_id, 1, PreviewDomain::SpritePosition);
    unknown_sprite.patch = Map::from_iter([("unknownSpriteField".to_string(), Value::Bool(true))]);

    let unknown_error = broker.publish("owner", unknown_sprite).unwrap_err();

    assert!(unknown_error.contains("unknownSpriteField"));

    for (seq, field) in ["x", "y", "scale"].into_iter().enumerate() {
        let mut removed_field =
            request_for_domain(&session_id, seq as u64 + 2, PreviewDomain::SpritePosition);
        removed_field.patch = Map::from_iter([(field.to_string(), serde_json::json!(1.0))]);

        let removed_error = broker.publish("owner", removed_field).unwrap_err();

        assert!(removed_error.contains(field));
    }

    let mut sprite_field_on_key = request_for_domain(&session_id, 6, PreviewDomain::KeyPosition);
    sprite_field_on_key.patch = Map::from_iter([(
        "pivot".to_string(),
        serde_json::json!({ "x": 0.5, "y": 0.5 }),
    )]);

    let cross_domain_error = broker.publish("owner", sprite_field_on_key).unwrap_err();

    assert!(cross_domain_error.contains("pivot"));
}

#[test]
fn unknown_preview_domain_is_rejected_during_wire_validation() {
    let error = serde_json::from_value::<PreviewPublishRequest>(serde_json::json!({
        "schemaVersion": PREVIEW_SCHEMA_VERSION,
        "sessionId": session_id(),
        "seq": 1,
        "domain": "spritePose",
        "mode": "4key",
        "targets": [0],
        "patch": { "dx": 24 }
    }))
    .expect_err("unknown preview domains stay closed");

    assert!(error.to_string().contains("unknown variant"));
}

#[test]
fn rejects_non_monotonic_sequence() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let session_id = session_id();
    broker
        .publish("owner", request(&session_id, 2))
        .expect("first publish succeeds");

    assert!(broker
        .publish("owner", request(&session_id, 2))
        .unwrap_err()
        .contains("monotonically"));
    assert!(broker
        .publish("owner", request(&session_id, 1))
        .unwrap_err()
        .contains("monotonically"));
}

#[test]
fn rejects_oversized_payload() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let session_id = session_id();
    let mut oversized = request(&session_id, 1);
    oversized.patch.insert(
        "displayText".to_string(),
        Value::String("x".repeat(MAX_PREVIEW_BYTES)),
    );

    assert!(broker
        .publish("owner", oversized)
        .unwrap_err()
        .contains("byte limit"));
}

#[test]
fn rejects_patch_field_outside_allowlist() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let session_id = session_id();
    let mut invalid = request(&session_id, 1);
    invalid
        .patch
        .insert("groupId".to_string(), Value::from("g1"));

    assert!(broker
        .publish("owner", invalid)
        .unwrap_err()
        .contains("not allowed"));
}

#[test]
fn resubscribe_cancels_previous_generation_sessions() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let observer_messages = subscribe(&broker, "observer");
    let session_id = session_id();
    broker
        .publish("owner", request(&session_id, 1))
        .expect("publish succeeds");
    assert_eq!(observer_messages.load(Ordering::SeqCst), 1);

    subscribe(&broker, "owner");

    assert_eq!(observer_messages.load(Ordering::SeqCst), 2);
    assert!(broker
        .publish("owner", request(&session_id, 2))
        .unwrap_err()
        .contains("already ended"));
}

#[test]
fn committed_sessions_are_tombstoned_without_auxiliary_broadcast() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let observer_messages = subscribe(&broker, "observer");
    let session_ids = vec![session_id(), session_id()];
    for session_id in &session_ids {
        broker
            .publish("owner", request(session_id, 1))
            .expect("publish succeeds");
    }

    for session_id in &session_ids {
        assert!(broker
            .finish_committed_session("owner", session_id, false)
            .expect("commit cleanup succeeds"));
    }
    assert_eq!(observer_messages.load(Ordering::SeqCst), 2);
    for session_id in &session_ids {
        assert!(broker
            .publish("owner", request(session_id, 2))
            .unwrap_err()
            .contains("already ended"));
    }
}

#[test]
fn no_op_commit_broadcasts_cancel_and_rejects_late_patch() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let observer_messages = subscribe(&broker, "observer");
    let session_id = session_id();

    assert!(broker
        .finish_committed_session("owner", &session_id, true)
        .expect("commit cleanup succeeds"));
    assert_eq!(observer_messages.load(Ordering::SeqCst), 1);

    assert!(broker
        .publish("owner", request(&session_id, 1))
        .unwrap_err()
        .contains("already ended"));
}

#[test]
fn cancel_before_first_publish_rejects_late_patch() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let session_id = session_id();

    broker
        .cancel("owner", &session_id)
        .expect("early cancel succeeds");

    assert!(broker
        .publish("owner", request(&session_id, 1))
        .unwrap_err()
        .contains("already ended"));
}

#[test]
fn destroyed_window_cancels_owned_sessions() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let observer_messages = subscribe(&broker, "observer");
    let session_id = session_id();
    broker
        .publish("owner", request(&session_id, 1))
        .expect("publish succeeds");

    broker.remove_label("owner");

    assert_eq!(observer_messages.load(Ordering::SeqCst), 2);
    assert!(broker
        .publish("owner", request(&session_id, 2))
        .unwrap_err()
        .contains("already ended"));
}

#[test]
fn history_gate_rejects_busy_preview_admission() {
    let broker = PreviewBroker::default();
    let gate = Arc::clone(&broker.history_gate);
    let operation_id = Uuid::new_v4().to_string();
    let barrier = gate.close(&operation_id).unwrap();

    let subscribe_error = broker
        .subscribe("owner", channel(Arc::new(AtomicUsize::new(0))))
        .unwrap_err();
    assert_eq!(subscribe_error, "HISTORY_IN_PROGRESS");
    let publish_error = broker
        .publish("owner", request(&session_id(), 1))
        .unwrap_err();
    assert_eq!(publish_error, "HISTORY_IN_PROGRESS");
    drop(barrier);
}

#[test]
fn preview_revalidates_admission_generation_after_broker_wait() {
    let broker = PreviewBroker::default();
    subscribe(&broker, "owner");
    let gate = Arc::clone(&broker.history_gate);

    let subscribe_admission = gate.try_admit().unwrap();
    let first_barrier = gate.close(&Uuid::new_v4().to_string()).unwrap();
    drop(first_barrier);
    let subscribe_error = broker
        .subscribe_after_admission(
            "observer",
            channel(Arc::new(AtomicUsize::new(0))),
            subscribe_admission,
        )
        .unwrap_err();
    assert_eq!(subscribe_error, "HISTORY_IN_PROGRESS");

    let publish_admission = gate.try_admit().unwrap();
    let second_barrier = gate.close(&Uuid::new_v4().to_string()).unwrap();
    drop(second_barrier);
    let session_id = session_id();
    let publish_error = broker
        .publish_after_admission(
            "owner",
            envelope("owner", request(&session_id, 1)),
            publish_admission,
        )
        .unwrap_err();
    assert_eq!(publish_error, "HISTORY_IN_PROGRESS");
}

#[test]
fn cancel_all_tombstones_every_active_session() {
    let broker = PreviewBroker::default();
    let owner_messages = subscribe(&broker, "owner");
    let observer_messages = subscribe(&broker, "observer");
    let session_id = session_id();
    broker
        .publish("owner", request(&session_id, 1))
        .expect("publish succeeds");
    assert_eq!(observer_messages.load(Ordering::SeqCst), 1);

    assert_eq!(broker.cancel_all(), 1);
    assert_eq!(owner_messages.load(Ordering::SeqCst), 1);
    assert_eq!(observer_messages.load(Ordering::SeqCst), 2);
    assert!(broker.state.lock().sessions.is_empty());
    assert!(broker.state.lock().tombstones.contains(&session_id));
    assert!(broker
        .publish("owner", request(&session_id, 2))
        .unwrap_err()
        .contains("already ended"));
}

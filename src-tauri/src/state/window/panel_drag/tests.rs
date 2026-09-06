use super::*;

fn geometry(origin: PanelDragOrigin) -> PanelDragGeometry {
    PanelDragGeometry {
        gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        origin,
        grab_offset_css: PanelDragPoint { x: 24.0, y: 18.0 },
        dock_area_css: Some(PanelDragRect {
            x: 620.0,
            y: 40.0,
            width: 288.0,
            height: 420.0,
        }),
        press_client_css: PanelDragPoint { x: 700.0, y: 60.0 },
        main_device_pixel_ratio: 1.5,
        panel_device_pixel_ratio: Some(1.5),
    }
}

#[test]
fn geometry_rejects_non_uuid_and_non_finite_values() {
    let mut invalid_id = geometry(PanelDragOrigin::Docked);
    invalid_id.gesture_id = "gesture-1".to_string();
    assert_eq!(
        invalid_id.validate().unwrap_err().error_code,
        PanelDragErrorCode::InvalidGeometry
    );

    let mut invalid_rect = geometry(PanelDragOrigin::Detached);
    invalid_rect.dock_area_css.as_mut().unwrap().width = f64::NAN;
    assert_eq!(
        invalid_rect.validate().unwrap_err().error_code,
        PanelDragErrorCode::InvalidGeometry
    );
}

#[test]
fn gesture_machine_allows_only_one_active_gesture() {
    let mut machine = GestureMachine::default();
    let first = geometry(PanelDragOrigin::Docked);
    machine.begin(&first).unwrap();

    let mut second = geometry(PanelDragOrigin::Detached);
    second.gesture_id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string();
    assert_eq!(
        machine.begin(&second).unwrap_err().error_code,
        PanelDragErrorCode::DragStartFailed
    );
}

#[test]
fn cleared_presenting_gesture_rejects_delayed_owner_start() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Docked);
    machine.begin(&geometry).unwrap();
    assert!(machine.is_presenting(&geometry.gesture_id));

    machine.clear();
    assert!(!machine.is_presenting(&geometry.gesture_id));
    let (sender, _receiver) = oneshot::channel();
    assert_eq!(
        machine
            .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
            .unwrap_err()
            .error_code,
        PanelDragErrorCode::DragStartFailed
    );
}

#[test]
fn cleared_starting_gesture_rejects_late_native_enter() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Detached);
    machine.begin(&geometry).unwrap();
    let (sender, _receiver) = oneshot::channel();
    machine
        .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
        .unwrap();
    machine.clear();

    assert!(machine.observe_enter().is_none());
    assert!(machine.finish_native_exit().is_none());
}

#[test]
fn gesture_machine_requires_presenting_starting_dragging_order() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Docked);
    machine.begin(&geometry).unwrap();
    let (sender, mut receiver) = oneshot::channel();
    machine
        .prepare_starting(
            &geometry.gesture_id,
            Some(NativePoint { x: 300.0, y: 200.0 }),
            Some(1.5),
            1.0,
            sender,
        )
        .unwrap();
    let (_, _, sender) = machine.observe_enter().unwrap();
    sender.send(()).unwrap();
    assert!(matches!(receiver.try_recv(), Ok(())));

    let ended = machine.finish_native_exit().unwrap();
    assert_eq!(ended.outcome, PanelDragOutcome::Released);
    assert_eq!(ended.would_snap_back, None);
    assert!(machine.active.is_none());
    assert!(machine
        .take_released(&geometry.gesture_id, PanelDragOrigin::Docked)
        .is_some());
    assert!(machine
        .take_released(&geometry.gesture_id, PanelDragOrigin::Docked)
        .is_none());
}

#[test]
fn disarm_stops_dock_area_evaluation_without_a_synthetic_hint() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Detached);
    machine.begin(&geometry).unwrap();
    let (sender, _receiver) = oneshot::channel();
    machine
        .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
        .unwrap();
    let _ = machine.observe_enter().unwrap();
    assert!(machine.update_hint(&geometry.gesture_id, true).is_some());
    assert!(machine.disarm_dock_zone(&geometry.gesture_id));
    let (_, dock_area, _) = machine.dock_snapshot().unwrap();
    assert_eq!(dock_area, None);
    assert_eq!(machine.active.as_ref().unwrap().last_hint, Some(true));
    assert!(!machine.disarm_dock_zone(&geometry.gesture_id));
}

#[test]
fn start_timeout_clears_the_active_gesture() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Detached);
    machine.begin(&geometry).unwrap();
    let (sender, _receiver) = oneshot::channel();
    machine
        .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
        .unwrap();

    let TimeoutResolution::Failed(payload) = machine.resolve_timeout(&geometry.gesture_id) else {
        panic!("starting gesture must fail on timeout");
    };
    assert_eq!(payload.outcome, PanelDragOutcome::StartFailed);
    assert_eq!(payload.would_snap_back, None);
    assert!(machine.active.is_none());
}

#[test]
fn escaped_exit_does_not_leave_a_hit_test_receipt() {
    let mut machine = GestureMachine::default();
    let geometry = geometry(PanelDragOrigin::Docked);
    machine.begin(&geometry).unwrap();
    let (sender, _receiver) = oneshot::channel();
    machine
        .prepare_starting(
            &geometry.gesture_id,
            Some(NativePoint { x: 100.0, y: 80.0 }),
            Some(2.0),
            1.0,
            sender,
        )
        .unwrap();
    let _ = machine.observe_enter().unwrap();
    machine.latch_escape();

    let payload = machine.finish_native_exit().unwrap();
    assert_eq!(payload.outcome, PanelDragOutcome::Escaped);
    assert!(machine
        .take_released(&geometry.gesture_id, geometry.origin)
        .is_none());
}

#[test]
fn dock_area_uses_main_inner_origin_and_main_scale() {
    let rect = dock_rect_native(
        NativePoint {
            x: 1920.0,
            y: -180.0,
        },
        1.5,
        1.0,
        PanelDragRect {
            x: 600.0,
            y: 20.0,
            width: 240.0,
            height: 400.0,
        },
    )
    .unwrap();
    assert_eq!(rect.x, 2820.0);
    assert_eq!(rect.y, -150.0);
    assert_eq!(rect.width, 360.0);
    assert_eq!(rect.height, 600.0);
    assert!(point_in_rect(
        NativePoint {
            x: 3180.0,
            y: 450.0,
        },
        rect
    ));
}

#[test]
fn main_zoom_residual_applies_to_dock_css_lengths() {
    assert_eq!(calculate_zoom_residual(1.8, 1.5), Some(1.2));
    assert_eq!(calculate_zoom_residual(0.1, 1.0), None);
    assert_eq!(calculate_zoom_residual(5.0, 1.0), None);
    assert_eq!(calculate_zoom_residual(f64::NAN, 1.0), None);
    assert_eq!(calculate_zoom_residual(1.0, 0.0), None);

    let rect = dock_rect_native(
        NativePoint { x: 100.0, y: 50.0 },
        1.5,
        1.2,
        PanelDragRect {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
        },
    )
    .unwrap();
    assert_eq!((rect.x, rect.y), (118.0, 86.0));
    assert!((rect.width - 54.0).abs() < 1e-9);
    assert_eq!(rect.height, 72.0);
}

#[test]
fn panel_seed_follows_panel_residual_when_zoom_failures_are_asymmetric() {
    let cursor = NativePoint {
        x: 1_000.0,
        y: 800.0,
    };
    let grab_offset_css = PanelDragPoint { x: 24.0, y: 18.0 };
    let inset = NativePoint { x: 8.0, y: 2.0 };
    let main_residual = calculate_zoom_residual(1.2, 1.5).unwrap();
    let panel_residual = resolve_panel_seed_residual(Some(1.8), Some(1.5), main_residual);

    let seeded = seed_panel_position_native(cursor, grab_offset_css, 2.0, panel_residual, inset);
    let seeded_with_main =
        seed_panel_position_native(cursor, grab_offset_css, 2.0, main_residual, inset);

    assert!((seeded.x - 934.4).abs() < 1e-9);
    assert!((seeded.y - 754.8).abs() < 1e-9);
    assert_ne!(seeded, seeded_with_main);
}

#[test]
fn panel_seed_matches_main_result_when_zoom_failures_are_symmetric() {
    let cursor = NativePoint {
        x: 1_000.0,
        y: 800.0,
    };
    let grab_offset_css = PanelDragPoint { x: 24.0, y: 18.0 };
    let inset = NativePoint { x: 8.0, y: 2.0 };
    let main_residual = calculate_zoom_residual(1.8, 1.5).unwrap();
    let panel_residual = resolve_panel_seed_residual(Some(2.4), Some(2.0), main_residual);

    let panel_seed =
        seed_panel_position_native(cursor, grab_offset_css, 2.0, panel_residual, inset);
    let main_seed = seed_panel_position_native(cursor, grab_offset_css, 2.0, main_residual, inset);
    assert!((panel_residual - main_residual).abs() < 1e-9);
    assert!((panel_seed.x - main_seed.x).abs() < 1e-9);
    assert!((panel_seed.y - main_seed.y).abs() < 1e-9);
}

#[test]
fn missing_panel_dpr_uses_main_residual_without_reinterpreting_main_dpr() {
    let geometry: PanelDragGeometry = serde_json::from_value(serde_json::json!({
        "gestureId": "550e8400-e29b-41d4-a716-446655440000",
        "origin": "docked",
        "grabOffsetCss": { "x": 24.0, "y": 18.0 },
        "dockAreaCss": null,
        "pressClientCss": { "x": 700.0, "y": 60.0 },
        "mainDevicePixelRatio": 1.0,
        "panelDevicePixelRatio": null
    }))
    .unwrap();
    let main_residual = calculate_zoom_residual(geometry.main_device_pixel_ratio, 1.0).unwrap();

    assert_eq!(geometry.panel_device_pixel_ratio, None);
    assert_eq!(
        resolve_panel_seed_residual(geometry.panel_device_pixel_ratio, Some(2.0), main_residual,),
        main_residual
    );
    assert_eq!(
        resolve_panel_seed_residual(
            Some(geometry.main_device_pixel_ratio),
            Some(2.0),
            main_residual,
        ),
        0.5
    );
}

#[test]
fn tao_0353_undecorated_shadow_insets_match_common_dpi_metrics() {
    assert_eq!(target_monitor_dpi(1.0), Some(96));
    assert_eq!(target_monitor_dpi(1.5), Some(144));
    assert_eq!(target_monitor_dpi(2.0), Some(192));
    assert_eq!(target_monitor_dpi(0.0), None);
    assert_eq!(target_monitor_dpi(f64::NAN), None);

    for (scale, resize_frame, padding, side, top) in
        [(1.0, 4, 4, 8, 1), (1.5, 6, 6, 12, 2), (2.0, 8, 8, 16, 2)]
    {
        let dpi = target_monitor_dpi(scale).unwrap();
        assert_eq!(
            tao_undecorated_shadow_insets(dpi, resize_frame, padding, 22_000),
            UndecoratedShadowInsets {
                left: side,
                top,
                right: side,
                bottom: side,
            }
        );
        assert_eq!(side as f64 / scale, 8.0);
    }

    assert_eq!(
        tao_undecorated_shadow_insets(96, 4, 4, 19_045),
        UndecoratedShadowInsets {
            left: 8,
            top: 0,
            right: 8,
            bottom: 8,
        }
    );
}

#[test]
fn snap_back_distance_uses_the_starting_main_scale() {
    let start = NativePoint { x: 100.0, y: 50.0 };
    assert!(within_snap_back(
        start,
        NativePoint { x: 145.0, y: 50.0 },
        1.5
    ));
    assert!(!within_snap_back(
        start,
        NativePoint { x: 145.1, y: 50.0 },
        1.5
    ));
}

#[test]
fn released_before_start_reports_snap_back_distance() {
    let start = Some(NativePoint { x: 100.0, y: 50.0 });
    assert_eq!(
        released_before_start_snap_back(start, NativePoint { x: 145.0, y: 50.0 }, Some(1.5),),
        Some(true)
    );
    assert_eq!(
        released_before_start_snap_back(start, NativePoint { x: 145.1, y: 50.0 }, Some(1.5),),
        Some(false)
    );
}

#[test]
fn escape_latch_classifies_native_exit() {
    assert_eq!(classify_native_outcome(false), PanelDragOutcome::Released);
    assert_eq!(classify_native_outcome(true), PanelDragOutcome::Escaped);
}

#[test]
fn event_payloads_use_the_frontend_serde_names() {
    assert_eq!(
        serde_json::to_value(PanelDragEndedPayload {
            gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            outcome: PanelDragOutcome::ReleasedBeforeStart,
            would_snap_back: Some(true),
        })
        .unwrap(),
        serde_json::json!({
            "gestureId": "550e8400-e29b-41d4-a716-446655440000",
            "outcome": "releasedBeforeStart",
            "wouldSnapBack": true
        })
    );
    assert_eq!(
        serde_json::to_value(PanelDragEndedPayload {
            gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            outcome: PanelDragOutcome::Released,
            would_snap_back: None,
        })
        .unwrap(),
        serde_json::json!({
            "gestureId": "550e8400-e29b-41d4-a716-446655440000",
            "outcome": "released"
        })
    );
    assert_eq!(
        serde_json::to_value(PanelDragHintPayload {
            gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            would_dock: true,
        })
        .unwrap(),
        serde_json::json!({
            "gestureId": "550e8400-e29b-41d4-a716-446655440000",
            "wouldDock": true
        })
    );
}
